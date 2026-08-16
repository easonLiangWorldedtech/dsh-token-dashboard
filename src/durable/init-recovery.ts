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

export interface InitRecoveryOptions {
  readonly store: SqliteUsageStore
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
  private readonly store: SqliteUsageStore
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

  /** Start the coordinator: arm run, activate with baseline, then schedule init/recovery. */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    const previous = this.store.getLastRunEpoch()
    const previousState = previous?.state
    const previousEpochId = previous?.epochId
    const startedAtMs = this.now()
    const epochId = this.store.beginRunEpoch(startedAtMs)
    const snapshots = await this.persistence.listSnapshots(this.signal)
    const baselines = snapshots.map((snapshot) => ({
      lifecyclePk: this.store.upsertLifecycle(identityFromSnapshot(snapshot), startedAtMs),
      sourceRevision: String(snapshot.revision),
    }))
    this.store.activateRunEpoch(epochId, baselines, this.now())
    if (this.signal?.aborted) {
      this.aborted = true
      return
    }
    const phase = this.store.getProjectionProgress().phase
    if (phase === 'initializing') {
      await this.runInitialization(snapshots)
    } else if (previousState === 'active' || previousState === 'arming') {
      await this.runRecovery(previousState, previousEpochId, snapshots, baselines)
    } else {
      // Clean/ready startup: nothing to do.
      this.store.updateProjectionProgress({ phase: 'ready' }, this.now())
    }
  }

  /** Abort background scan/recovery; committed work is preserved. */
  abort(): void {
    this.aborted = true
  }

  private async runInitialization(snapshots: ReadonlyArray<{ header: { id: string; createdAt?: number; cwd?: string }; revision: unknown }>): Promise<void> {
    if (this.aborted) return
    this.store.updateProjectionProgress({
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
      this.store.updateProjectionProgress({ scanningSessions: 1 }, this.now())
      try {
        const completed = await this.scanLifecycle(snapshot, 0, true)
        if (!completed) {
          failed += 1
          failedIds.add(snapshot.header.id)
        } else {
          const progress = this.store.getProjectionProgress()
          this.store.updateProjectionProgress({
            completedSessions: progress.completedSessions + 1,
            scanningSessions: 0,
          }, this.now())
        }
      } catch {
        failed += 1
        failedIds.add(snapshot.header.id)
        this.store.updateProjectionProgress({ scanningSessions: 0, failedSessions: failed }, this.now())
      }
    }

    // Final sweep: discover sessions created after the initial enumeration.
    const finalSnapshots = await this.persistence.listSnapshots(this.signal)
    for (const snapshot of finalSnapshots) {
      if (this.aborted) return
      if (failedIds.has(snapshot.header.id)) continue
      const pk = this.store.getLifecycle(identityFromSnapshot(snapshot))
      if (pk !== undefined && this.store.getCheckpoint(pk).bootstrapComplete) continue
      try {
        await this.scanLifecycle(snapshot, 0, true)
        const progress = this.store.getProjectionProgress()
        this.store.updateProjectionProgress({
          discoveredSessions: Math.max(progress.discoveredSessions, finalSnapshots.length),
          completedSessions: progress.completedSessions + 1,
        }, this.now())
      } catch {
        failed += 1
        failedIds.add(snapshot.header.id)
      }
    }

    const progress = this.store.getProjectionProgress()
    if (failed === 0 && !this.aborted) {
      this.store.setProjectionReady(this.now())
    } else {
      this.store.updateProjectionProgress({
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
    this.store.updateProjectionProgress({
      phase: 'recovering',
      discoveredSessions: currentSnapshots.length,
      startedAtMs: this.now(),
    }, this.now())

    const previousBaselines = previousState === 'active' && previousEpochId !== undefined ? this.store.getBaselines(previousEpochId) : []
    const candidates = currentSnapshots.filter((snapshot) => {
      if (previousState === 'arming') return true
      const identity = identityFromSnapshot(snapshot)
      const pk = this.store.getLifecycle(identity)
      const baseline = previousBaselines.find((entry) => entry.lifecyclePk === pk)
      return baseline === undefined || baseline.sourceRevision !== String(snapshot.revision)
    })

    let failed = 0
    const queue = [...candidates]
    const workers: Promise<void>[] = []
    const runOne = async (): Promise<void> => {
      while (queue.length > 0 && !this.aborted) {
        const snapshot = queue.shift()!
        try {
          const checkpoint = this.store.getCheckpoint(this.store.upsertLifecycle(identityFromSnapshot(snapshot)))
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

    const progress = this.store.getProjectionProgress()
    if (failed === 0 && !this.aborted) {
      this.store.setProjectionReady(this.now())
    } else {
      this.store.updateProjectionProgress({ phase: 'degraded', failedSessions: failed, scanningSessions: 0 }, this.now())
    }
  }

  private async scanLifecycle(
    snapshot: { header: { id: string; createdAt?: number; cwd?: string }; revision: unknown },
    fromSeq: number,
    bootstrap: boolean,
  ): Promise<boolean> {
    const identity = identityFromSnapshot(snapshot)
    const lifecyclePk = this.store.upsertLifecycle(identity)
    let cursor = fromSeq
    let index = 0
    while (!this.aborted) {
      const read = await this.persistence.readFrom(identity.sessionId, cursor, this.signal)
      if (read.events.length === 0) {
        if (bootstrap) {
          this.store.projectBatch({
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
        this.store.projectBatch({
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

  private currentEpochId(): number {
    return this.store.getLastRunEpoch()?.epochId ?? -1
  }
}

function identityFromSnapshot(snapshot: { header: { id: string; createdAt?: number; cwd?: string }; revision: unknown }): LifecycleIdentity {
  return {
    sessionId: snapshot.header.id,
    createdAtMs: snapshot.header.createdAt ?? 0,
    cwd: snapshot.header.cwd ?? '',
  }
}
