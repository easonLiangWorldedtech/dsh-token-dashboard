// InitRecoveryCoordinator — background initialization and crash-tail recovery.
//
// It uses only the DSH persistence seam (listSnapshots/readFrom) plus the
// collector and Worker client. It never touches physical JSONL/Zstd paths and
// never runs on the panel request path.

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionBatch, LifecycleIdentity } from './contracts'
import { normalizeEventDeltas } from './projector'
import type { SqliteUsageStore } from './sqlite-store'
import type { UsageCollector } from './collector'
import type { UsageWorkerClient } from './worker-client'

/** Minimal persistence seam shape sufficient for init/recovery. */
export interface PersistenceLike {
  listSnapshots(signal?: AbortSignal): Promise<Array<{ header: { id: string; createdAt?: number; cwd?: string }; revision: unknown }>>
  readFrom(id: string, fromSeq: number, signal?: AbortSignal): Promise<{ meta: { id: string; createdAt?: number; cwd?: string }; events: SessionEvent[] }>
}

export interface CoordinatorStore {
  getLastRunEpoch(): Promise<{ epochId: number; state: 'arming' | 'active' | 'clean'; startedAtMs: number; cleanAtMs: number | null } | null>
  beginRunEpoch(startedAtMs?: number): Promise<number>
  activateRunEpoch(epochId: number, baselines: ReadonlyArray<{ lifecyclePk: number; sourceRevision: string }>): Promise<void>
  upsertLifecycle(identity: LifecycleIdentity, discoveredAtMs?: number): Promise<number>
  getLifecycle(identity: LifecycleIdentity): Promise<number | undefined>
  getCheckpoint(lifecyclePk: number): Promise<{
    lifecyclePk: number
    lastSeq: number
    routeProvider: string | null
    routeModel: string | null
    bootstrapComplete: boolean
    sourceRevision: string | null
  }>
  getProjectionProgress(): Promise<{
    phase: 'initializing' | 'recovering' | 'ready' | 'degraded' | 'rebuild_required' | 'error'
    discoveredSessions: number
    completedSessions: number
    scanningSessions: number
    retryingSessions: number
    failedSessions: number
    startedAtMs: number | null
    completedAtMs: number | null
    lastErrorCode: string | null
    lastErrorMessage: string | null
  }>
  updateProjectionProgress(update: Record<string, unknown>, now?: number): Promise<void>
  setProjectionReady(now?: number): Promise<void>
  getBaselines(epochId: number): Promise<Array<{ lifecyclePk: number; sourceRevision: string }>>
  projectBatch(batch: ProjectionBatch, now?: number): Promise<unknown>
}

/** Async adapter for the Worker client: all SQLite operations stay in the Worker. */
export class WorkerCoordinatorStore implements CoordinatorStore {
  constructor(private readonly client: UsageWorkerClient) {}

  async getLastRunEpoch() { return this.client.getLastRunEpoch() }
  async beginRunEpoch(startedAtMs?: number) { return this.client.beginRunEpoch(startedAtMs) }
  async activateRunEpoch(epochId: number, baselines: ReadonlyArray<{ lifecyclePk: number; sourceRevision: string }>) { await this.client.activateRunEpoch(epochId, baselines) }
  async upsertLifecycle(identity: LifecycleIdentity, discoveredAtMs?: number) { return this.client.upsertLifecycle(identity, discoveredAtMs) }
  async getLifecycle(identity: LifecycleIdentity) { return (await this.client.getLifecycle(identity)) ?? undefined }
  async getCheckpoint(lifecyclePk: number) { return this.client.getCheckpoint(lifecyclePk) }
  async getProjectionProgress() { return this.client.getProjectionProgress() }
  async updateProjectionProgress(update: Record<string, unknown>, now?: number) { await this.client.updateProjectionProgress(update, now) }
  async setProjectionReady(now?: number) { await this.client.setProjectionReady(now) }
  async getBaselines(epochId: number) { return this.client.getBaselines(epochId) }
  async projectBatch(batch: ProjectionBatch, _now?: number) { return this.client.project(batch) }
}

/** Async adapter so the coordinator can run against either direct SQLite (tests) or the Worker client. */
export class SqliteCoordinatorStore implements CoordinatorStore {
  constructor(private readonly store: SqliteUsageStore) {}

  async getLastRunEpoch() { return await this.store.getLastRunEpoch() ?? null }
  async beginRunEpoch(startedAtMs?: number) { return await this.store.beginRunEpoch(startedAtMs) }
  async activateRunEpoch(epochId: number, baselines: ReadonlyArray<{ lifecyclePk: number; sourceRevision: string }>) { await this.store.activateRunEpoch(epochId, baselines as never) }
  async upsertLifecycle(identity: LifecycleIdentity, discoveredAtMs?: number) { return await this.store.upsertLifecycle(identity, discoveredAtMs) }
  async getLifecycle(identity: LifecycleIdentity) { return await this.store.getLifecycle(identity) }
  async getCheckpoint(lifecyclePk: number) { return await this.store.getCheckpoint(lifecyclePk) }
  async getProjectionProgress() { return await this.store.getProjectionProgress() }
  async updateProjectionProgress(update: Record<string, unknown>, now?: number) { await this.store.updateProjectionProgress(update as never, now) }
  async setProjectionReady(now?: number) { await this.store.setProjectionReady(now) }
  async getBaselines(epochId: number) { return await this.store.getBaselines(epochId) }
  async projectBatch(batch: ProjectionBatch, now?: number) { return await this.store.projectBatch(batch, now) }
}

export interface InitRecoveryOptions {
  readonly store: CoordinatorStore
  readonly persistence: PersistenceLike
  readonly collector: UsageCollector
  readonly worker: UsageWorkerClient
  readonly generation: string
  readonly now?: () => number
  readonly yieldEvery?: number
  readonly maxRecoveryParallel?: number
  readonly signal?: AbortSignal
}

const DEFAULT_YIELD_EVERY = 500
const DEFAULT_MAX_RECOVERY_PARALLEL = 2

export class InitRecoveryCoordinator {
  private readonly store: CoordinatorStore
  private readonly persistence: PersistenceLike
  private readonly collector: UsageCollector
  private readonly worker: UsageWorkerClient
  private readonly generation: string
  private readonly now: () => number
  private readonly yieldEvery: number
  private readonly maxRecoveryParallel: number
  private readonly signal?: AbortSignal
  private aborted = false
  private started = false
  private armed = false
  private snapshots: Array<{ header: { id: string; createdAt?: number; cwd?: string }; revision: unknown }> = []
  private previousState: 'arming' | 'active' | 'clean' | undefined
  private previousEpochId: number | undefined

  constructor(options: InitRecoveryOptions) {
    this.store = options.store
    this.persistence = options.persistence
    this.collector = options.collector
    this.worker = options.worker
    this.generation = options.generation
    this.now = options.now ?? Date.now
    this.yieldEvery = options.yieldEvery ?? DEFAULT_YIELD_EVERY
    this.maxRecoveryParallel = options.maxRecoveryParallel ?? DEFAULT_MAX_RECOVERY_PARALLEL
    this.signal = options.signal
  }

  get isAborted(): boolean {
    return this.aborted
  }

  /** Start the coordinator: arm run, activate with baseline, then run scan. */
  async start(): Promise<void> {
    await this.arm()
    await this.scan()
  }

  /** Arm the run epoch and activate with a revision baseline; no scan yet. */
  async arm(): Promise<void> {
    if (this.armed) return
    this.armed = true
    this.started = true
    const previous = await this.store.getLastRunEpoch()
    this.previousState = previous?.state
    this.previousEpochId = previous?.epochId
    const startedAtMs = this.now()
    const epochId = await this.store.beginRunEpoch(startedAtMs)
    const snapshots = await this.persistence.listSnapshots(this.signal)
    this.snapshots = snapshots
    const baselines: Array<{ lifecyclePk: number; sourceRevision: string }> = []
    for (const snapshot of snapshots) {
      baselines.push({
        lifecyclePk: await this.store.upsertLifecycle(identityFromSnapshot(snapshot), startedAtMs),
        sourceRevision: String(snapshot.revision),
      })
    }
    await this.store.activateRunEpoch(epochId, baselines)
    if (this.signal?.aborted) this.aborted = true
  }

  /** Run initialization/recovery/ready transition after arm(). */
  async scan(): Promise<void> {
    if (!this.armed) throw new Error('coordinator not armed')
    if (this.aborted || this.signal?.aborted) return
    const progress = await this.store.getProjectionProgress()
    const phase = progress.phase
    if (phase === 'initializing') {
      await this.runInitialization(this.snapshots)
    } else if (this.previousState === 'active' || this.previousState === 'arming') {
      await this.runRecovery(this.previousState, this.previousEpochId, this.snapshots, [])
    } else {
      // Clean/ready startup: nothing to do.
      await this.store.updateProjectionProgress({ phase: 'ready' }, this.now())
    }
  }

  /** Abort background scan/recovery; committed work is preserved. */
  abort(): void {
    this.aborted = true
  }

  private async runInitialization(snapshots: ReadonlyArray<{ header: { id: string; createdAt?: number; cwd?: string }; revision: unknown }>): Promise<void> {
    if (this.aborted) return
    await this.store.updateProjectionProgress({
      phase: 'initializing',
      discoveredSessions: snapshots.length,
      startedAtMs: this.now(),
      scanningSessions: 0,
      retryingSessions: 0,
      failedSessions: 0,
      completedSessions: 0,
    }, this.now())

    let failed = 0
    const failedIds = new Set<string>()
    for (let index = 0; index < snapshots.length; index += 1) {
      if (this.aborted) return
      const snapshot = snapshots[index]!
      await this.store.updateProjectionProgress({ scanningSessions: 1 }, this.now())
      try {
        const completed = await this.scanLifecycle(snapshot, 0, true)
        if (!completed) {
          failed += 1
          failedIds.add(snapshot.header.id)
        } else {
          const progress = await this.store.getProjectionProgress()
          await this.store.updateProjectionProgress({
            completedSessions: progress.completedSessions + 1,
            scanningSessions: 0,
          }, this.now())
        }
      } catch {
        failed += 1
        failedIds.add(snapshot.header.id)
        await this.store.updateProjectionProgress({ scanningSessions: 0, failedSessions: failed }, this.now())
      }
    }

    // Final sweep: discover sessions created after the initial enumeration.
    const finalSnapshots = await this.persistence.listSnapshots(this.signal)
    for (const snapshot of finalSnapshots) {
      if (this.aborted) return
      if (failedIds.has(snapshot.header.id)) continue
      const pk = await this.store.getLifecycle(identityFromSnapshot(snapshot))
      if (pk !== undefined) {
        const checkpoint = await this.store.getCheckpoint(pk)
        if (checkpoint.bootstrapComplete) continue
      }
      try {
        await this.scanLifecycle(snapshot, 0, true)
        const progress = await this.store.getProjectionProgress()
        await this.store.updateProjectionProgress({
          discoveredSessions: Math.max(progress.discoveredSessions, finalSnapshots.length),
          completedSessions: progress.completedSessions + 1,
        }, this.now())
      } catch {
        failed += 1
        failedIds.add(snapshot.header.id)
      }
    }

    const progress = await this.store.getProjectionProgress()
    if (failed === 0 && !this.aborted) {
      await this.store.setProjectionReady(this.now())
    } else {
      await this.store.updateProjectionProgress({
        phase: 'degraded',
        failedSessions: failed,
        scanningSessions: 0,
        retryingSessions: 0,
      }, this.now())
    }
  }

  private async runRecovery(
    previousState: 'arming' | 'active',
    previousEpochId: number | undefined,
    currentSnapshots: ReadonlyArray<{ header: { id: string; createdAt?: number; cwd?: string }; revision: unknown }>,
    baselines: ReadonlyArray<{ lifecyclePk: number; sourceRevision: string }>,
  ): Promise<void> {
    if (this.aborted) return
    await this.store.updateProjectionProgress({
      phase: 'recovering',
      discoveredSessions: currentSnapshots.length,
      startedAtMs: this.now(),
    }, this.now())

    const previousBaselines = previousState === 'active' && previousEpochId !== undefined ? await this.store.getBaselines(previousEpochId) : []
    const candidates: Array<{ header: { id: string; createdAt?: number; cwd?: string }; revision: unknown }> = []
    for (const snapshot of currentSnapshots) {
      if (previousState === 'arming') {
        candidates.push(snapshot)
        continue
      }
      const identity = identityFromSnapshot(snapshot)
      const pk = await this.store.getLifecycle(identity)
      const baseline = previousBaselines.find((entry) => entry.lifecyclePk === pk)
      if (baseline === undefined || baseline.sourceRevision !== String(snapshot.revision)) candidates.push(snapshot)
    }

    let failed = 0
    const queue = [...candidates]
    const workers: Promise<void>[] = []
    const runOne = async (): Promise<void> => {
      while (queue.length > 0 && !this.aborted) {
        const snapshot = queue.shift()!
        try {
          const checkpoint = await this.store.getCheckpoint(await this.store.upsertLifecycle(identityFromSnapshot(snapshot)))
          await this.scanLifecycle(snapshot, checkpoint.lastSeq + 1, false)
        } catch {
          failed += 1
        }
      }
    }
    for (let i = 0; i < Math.min(this.maxRecoveryParallel, Math.max(1, candidates.length)); i += 1) {
      workers.push(runOne())
    }
    await Promise.all(workers)

    const progress = await this.store.getProjectionProgress()
    if (failed === 0 && !this.aborted) {
      await this.store.setProjectionReady(this.now())
    } else {
      await this.store.updateProjectionProgress({ phase: 'degraded', failedSessions: failed, scanningSessions: 0 }, this.now())
    }
  }

  private async scanLifecycle(
    snapshot: { header: { id: string; createdAt?: number; cwd?: string }; revision: unknown },
    fromSeq: number,
    bootstrap: boolean,
  ): Promise<boolean> {
    const identity = identityFromSnapshot(snapshot)
    const lifecyclePk = await this.store.upsertLifecycle(identity)
    let cursor = fromSeq
    let index = 0
    while (!this.aborted) {
      const read = await this.persistence.readFrom(identity.sessionId, cursor, this.signal)
      if (read.events.length === 0) {
        if (bootstrap) {
          await this.store.projectBatch({
            batchId: this.generation + ':bootstrap:' + identity.sessionId + ':' + cursor,
            hostGeneration: this.generation,
            lifecycle: identity,
            fromSeq: cursor,
            toSeq: cursor - 1,
            deltas: [],
            sourceRevision: String(snapshot.revision),
            bootstrapComplete: true,
          })
        }
        return true
      }
      for (let offset = 0; offset < read.events.length; offset += this.yieldEvery) {
        if (this.aborted) return false
        const chunk = read.events.slice(offset, offset + this.yieldEvery)
        const first = chunk[0]!
        const last = chunk[chunk.length - 1]!
        const isLastChunk = offset + chunk.length >= read.events.length
        await this.store.projectBatch({
          batchId: this.generation + ':scan:' + identity.sessionId + ':' + first.seq + '-' + last.seq,
          hostGeneration: this.generation,
          lifecycle: identity,
          fromSeq: first.seq,
          toSeq: last.seq,
          deltas: normalizeEventDeltas(chunk),
          sourceRevision: isLastChunk && bootstrap ? String(snapshot.revision) : undefined,
          bootstrapComplete: isLastChunk && bootstrap,
        })
        cursor = last.seq + 1
        await new Promise((resolve) => setImmediate(resolve))
      }
    }
    return false
  }

}

function identityFromSnapshot(snapshot: { header: { id: string; createdAt?: number; cwd?: string }; revision: unknown }): LifecycleIdentity {
  return {
    sessionId: snapshot.header.id,
    createdAtMs: snapshot.header.createdAt ?? 0,
    cwd: snapshot.header.cwd ?? '',
  }
}
