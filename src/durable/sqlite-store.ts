// SqliteUsageStore — the single SQLite repository for the durable projection.
//
// The Worker owns the only DatabaseSync connection. This module is also used
// by the maintenance CLI in read-only/owner mode. All writes are serialized
// through explicit transactions; facts and checkpoint always commit together.

import { chmodSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type {
  IngestionErrorRecord,
  LifecycleIdentity,
  ModelBucket,
  ProjectionBatch,
  ProjectionState,
  ProjectionPhase,
  SnapshotDay,
  SnapshotV1,
  StoredProjectionPhase,
} from './contracts'
import {
  DB_APPLICATION_ID,
  PROJECTION_VERSION,
  SCHEMA_VERSION,
  SNAPSHOT_CONTRACT_VERSION,
} from './contracts'
import { createProjectionState, factKey, projectBatch } from './projector'
import { dayKeyOf, shiftDateKey } from '../host/day-buckets'

const DDL = `
CREATE TABLE IF NOT EXISTS session_lifecycle (
  lifecycle_pk          INTEGER PRIMARY KEY,
  session_id            TEXT NOT NULL,
  session_created_at_ms INTEGER NOT NULL CHECK (session_created_at_ms >= 0),
  cwd                    TEXT NOT NULL,
  discovered_at_ms       INTEGER NOT NULL CHECK (discovered_at_ms >= 0),
  UNIQUE (session_id, session_created_at_ms, cwd)
);

CREATE TABLE IF NOT EXISTS usage_fact (
  lifecycle_pk       INTEGER NOT NULL
                       REFERENCES session_lifecycle(lifecycle_pk) ON DELETE RESTRICT,
  turn               INTEGER NOT NULL CHECK (turn >= 0),
  step               INTEGER NOT NULL CHECK (step >= 0),
  source_seq         INTEGER NOT NULL CHECK (source_seq >= 0),
  occurred_at_ms     INTEGER NOT NULL CHECK (occurred_at_ms >= 0),
  provider           TEXT,
  model              TEXT,
  input_tokens       INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens      INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0 CHECK (cache_read_tokens >= 0),
  cache_write_tokens INTEGER NOT NULL DEFAULT 0 CHECK (cache_write_tokens >= 0),
  PRIMARY KEY (lifecycle_pk, turn, step)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS usage_fact_occurred_at_idx ON usage_fact(occurred_at_ms);

CREATE TABLE IF NOT EXISTS session_checkpoint (
  lifecycle_pk       INTEGER PRIMARY KEY
                       REFERENCES session_lifecycle(lifecycle_pk) ON DELETE RESTRICT,
  last_seq           INTEGER NOT NULL DEFAULT -1 CHECK (last_seq >= -1),
  route_provider     TEXT,
  route_model        TEXT,
  bootstrap_complete INTEGER NOT NULL DEFAULT 0 CHECK (bootstrap_complete IN (0, 1)),
  source_revision    TEXT,
  updated_at_ms      INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  CHECK (bootstrap_complete = 0 OR source_revision IS NOT NULL)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS ingestion_error (
  lifecycle_pk     INTEGER NOT NULL
                     REFERENCES session_lifecycle(lifecycle_pk) ON DELETE RESTRICT,
  source_seq       INTEGER NOT NULL CHECK (source_seq >= 0),
  event_type       TEXT,
  reason_code      TEXT NOT NULL,
  detail           TEXT NOT NULL,
  first_seen_at_ms INTEGER NOT NULL CHECK (first_seen_at_ms >= 0),
  PRIMARY KEY (lifecycle_pk, source_seq)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS projection_state (
  singleton_id        INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  projection_version  INTEGER NOT NULL,
  phase               TEXT NOT NULL CHECK (
                        phase IN ('initializing','recovering','ready','degraded',
                                  'rebuild_required','error')
                      ),
  discovered_sessions INTEGER NOT NULL DEFAULT 0 CHECK (discovered_sessions >= 0),
  completed_sessions  INTEGER NOT NULL DEFAULT 0 CHECK (completed_sessions >= 0),
  scanning_sessions   INTEGER NOT NULL DEFAULT 0 CHECK (scanning_sessions >= 0),
  retrying_sessions   INTEGER NOT NULL DEFAULT 0 CHECK (retrying_sessions >= 0),
  failed_sessions     INTEGER NOT NULL DEFAULT 0 CHECK (failed_sessions >= 0),
  started_at_ms       INTEGER,
  completed_at_ms     INTEGER,
  last_error_code     TEXT,
  last_error_message  TEXT,
  updated_at_ms       INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  CHECK (completed_sessions + failed_sessions <= discovered_sessions)
);

CREATE TABLE IF NOT EXISTS run_epoch (
  epoch_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
  state         TEXT NOT NULL CHECK (state IN ('arming','active','clean')),
  clean_at_ms   INTEGER
);

CREATE TABLE IF NOT EXISTS run_baseline (
  epoch_id        INTEGER NOT NULL REFERENCES run_epoch(epoch_id) ON DELETE CASCADE,
  lifecycle_pk    INTEGER NOT NULL REFERENCES session_lifecycle(lifecycle_pk) ON DELETE RESTRICT,
  source_revision TEXT NOT NULL,
  PRIMARY KEY (epoch_id, lifecycle_pk)
) WITHOUT ROWID;
`

export interface ProjectionProgress {
  phase: StoredProjectionPhase
  discoveredSessions: number
  completedSessions: number
  scanningSessions: number
  retryingSessions: number
  failedSessions: number
  startedAtMs: number | null
  completedAtMs: number | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
}

export interface RunEpochInfo {
  epochId: number
  state: 'arming' | 'active' | 'clean'
  startedAtMs: number
  cleanAtMs: number | null
}

export interface CheckpointRow {
  lifecyclePk: number
  lastSeq: number
  routeProvider: string | null
  routeModel: string | null
  bootstrapComplete: boolean
  sourceRevision: string | null
}

export class ProjectionGapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectionGapError'
  }
}

export class ProjectionTooNewError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectionTooNewError'
  }
}

export class ForeignDatabaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ForeignDatabaseError'
  }
}

export class DatabaseInUseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseInUseError'
  }
}

interface FactRow {
  lifecycle_pk: number
  turn: number
  step: number
  source_seq: number
  occurred_at_ms: number
  provider: string | null
  model: string | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
}

interface WarningRow {
  reason_code: string
  count: number
}

export class SqliteUsageStore {
  private readonly db: DatabaseSync
  private commitGeneration = 0
  private stateGeneration = 0
  private closed = false

  constructor(dbPath: string, options: { readonly createIfMissing?: boolean; readonly readOnly?: boolean } = {}) {
    try {
      this.db = new DatabaseSync(dbPath, {
        readOnly: options.readOnly ?? false,
        timeout: 5000,
        enableForeignKeyConstraints: true,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/locked|database is locked/i.test(message)) throw new DatabaseInUseError('database_in_use: ' + message)
      throw error
    }
    this.db.exec('PRAGMA busy_timeout = 5000')
    this.db.exec('PRAGMA synchronous = FULL')
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    if (!options.readOnly) {
      try {
        chmodSync(dbPath, 0o600)
      } catch {
        // Best effort; some filesystems ignore mode.
      }
    }
    this.probe()
    if (!options.readOnly) {
      this.db.exec('PRAGMA application_id = ' + DB_APPLICATION_ID)
      this.db.exec('PRAGMA user_version = ' + SCHEMA_VERSION)
    }
  }

  private probe(): void {
    const appId = (this.db.prepare('PRAGMA application_id').get() as { application_id: number }).application_id
    const userVersion = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    if (userVersion > SCHEMA_VERSION) {
      this.db.close()
      throw new ProjectionTooNewError(`database schema too new: user_version=${userVersion}, plugin supports ${SCHEMA_VERSION}`)
    }
    if (appId !== 0 && appId !== DB_APPLICATION_ID) {
      this.db.close()
      throw new ForeignDatabaseError(`foreign sqlite database application_id=${appId.toString(16)}`)
    }
    if (userVersion === 0) {
      this.db.exec(DDL)
      this.db.exec('PRAGMA user_version = ' + SCHEMA_VERSION)
      const now = Date.now()
      this.db.prepare(
        `INSERT INTO projection_state (
           singleton_id, projection_version, phase, discovered_sessions, completed_sessions,
           scanning_sessions, retrying_sessions, failed_sessions, started_at_ms, completed_at_ms,
           updated_at_ms
         ) VALUES (1, ?, 'initializing', 0, 0, 0, 0, 0, NULL, NULL, ?)`,
      ).run(PROJECTION_VERSION, now)
    }
  }

  private txDepth = 0

  /** Run a function inside an immediate transaction; rolls back on throw. */
  transaction<T>(fn: () => T): T {
    if (this.txDepth > 0) return fn()
    this.txDepth += 1
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const value = fn()
      this.db.exec('COMMIT')
      return value
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    } finally {
      this.txDepth -= 1
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.db.close()
  }

  get isClosed(): boolean {
    return this.closed
  }

  get commitGenerationValue(): number {
    return this.commitGeneration
  }

  get stateGenerationValue(): number {
    return this.stateGeneration
  }

  private bumpState(): void {
    this.stateGeneration += 1
  }

  private bumpCommit(): void {
    this.commitGeneration += 1
  }

  // --- lifecycle / checkpoint ---

  upsertLifecycle(identity: LifecycleIdentity, discoveredAtMs = Date.now()): number {
    const row = this.db.prepare(
      `INSERT INTO session_lifecycle (session_id, session_created_at_ms, cwd, discovered_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(session_id, session_created_at_ms, cwd) DO UPDATE SET discovered_at_ms = excluded.discovered_at_ms
       RETURNING lifecycle_pk`,
    ).get(identity.sessionId, identity.createdAtMs, identity.cwd, discoveredAtMs) as { lifecycle_pk: number }
    return row.lifecycle_pk
  }

  getLifecycle(identity: LifecycleIdentity): number | undefined {
    const row = this.db.prepare(
      `SELECT lifecycle_pk FROM session_lifecycle WHERE session_id = ? AND session_created_at_ms = ? AND cwd = ?`,
    ).get(identity.sessionId, identity.createdAtMs, identity.cwd) as { lifecycle_pk: number } | undefined
    return row?.lifecycle_pk
  }

  getCheckpoint(lifecyclePk: number): CheckpointRow {
    const row = this.db.prepare(
      `SELECT lifecycle_pk, last_seq, route_provider, route_model, bootstrap_complete, source_revision
       FROM session_checkpoint WHERE lifecycle_pk = ?`,
    ).get(lifecyclePk) as
      | { lifecycle_pk: number; last_seq: number; route_provider: string | null; route_model: string | null; bootstrap_complete: number; source_revision: string | null }
      | undefined
    if (row === undefined) {
      return { lifecyclePk, lastSeq: -1, routeProvider: null, routeModel: null, bootstrapComplete: false, sourceRevision: null }
    }
    return {
      lifecyclePk: row.lifecycle_pk,
      lastSeq: row.last_seq,
      routeProvider: row.route_provider,
      routeModel: row.route_model,
      bootstrapComplete: row.bootstrap_complete === 1,
      sourceRevision: row.source_revision,
    }
  }

  /** Project one source-confirmed batch; facts/errors/checkpoint are atomic. */
  projectBatch(batch: ProjectionBatch, now = Date.now()): { committed: boolean; checkpoint: number; commitGeneration: number } {
    return this.transaction(() => {
      const lifecyclePk = this.upsertLifecycle(batch.lifecycle)
      const current = this.getCheckpoint(lifecyclePk)
      const seed: ProjectionState = {
        checkpoint: current.lastSeq,
        routeProvider: current.routeProvider ?? undefined,
        routeModel: current.routeModel ?? undefined,
        facts: new Map(),
        errors: new Map(),
      }
      const result = projectBatch(seed, batch, now)
      if (result.status === 'gap') throw new ProjectionGapError(result.reason ?? 'projection gap')
      if (result.status === 'noop') {
        if (batch.bootstrapComplete === true && batch.sourceRevision !== undefined) {
          this.db.prepare(
            `INSERT INTO session_checkpoint (
               lifecycle_pk, last_seq, route_provider, route_model, bootstrap_complete, source_revision, updated_at_ms
             ) VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(lifecycle_pk) DO UPDATE SET
               bootstrap_complete = excluded.bootstrap_complete,
               source_revision = excluded.source_revision,
               updated_at_ms = excluded.updated_at_ms`,
          ).run(lifecyclePk, current.lastSeq, current.routeProvider, current.routeModel, 1, batch.sourceRevision, now)
          this.bumpState()
        }
        return { committed: false, checkpoint: current.lastSeq, commitGeneration: this.commitGeneration }
      }

      const upsertFact = this.db.prepare(
        `INSERT INTO usage_fact (
           lifecycle_pk, turn, step, source_seq, occurred_at_ms, provider, model,
           input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(lifecycle_pk, turn, step) DO UPDATE SET
           source_seq         = excluded.source_seq,
           occurred_at_ms     = excluded.occurred_at_ms,
           provider           = COALESCE(excluded.provider, usage_fact.provider),
           model              = COALESCE(excluded.model, usage_fact.model),
           input_tokens       = excluded.input_tokens,
           output_tokens      = excluded.output_tokens,
           cache_read_tokens  = excluded.cache_read_tokens,
           cache_write_tokens = excluded.cache_write_tokens
         WHERE excluded.source_seq >= usage_fact.source_seq`,
      )
      for (const fact of result.state.facts.values()) {
        upsertFact.run(
          lifecyclePk, fact.turn, fact.step, fact.sourceSeq, fact.occurredAtMs,
          fact.provider ?? null, fact.model ?? null,
          fact.inputTokens, fact.outputTokens, fact.cacheReadTokens, fact.cacheWriteTokens,
        )
      }
      const upsertError = this.db.prepare(
        `INSERT INTO ingestion_error (lifecycle_pk, source_seq, event_type, reason_code, detail, first_seen_at_ms)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(lifecycle_pk, source_seq) DO UPDATE SET
           event_type = excluded.event_type,
           reason_code = excluded.reason_code,
           detail = excluded.detail`,
      )
      for (const error of result.state.errors.values()) {
        upsertError.run(lifecyclePk, error.sourceSeq, error.eventType ?? null, error.reasonCode, error.detail.slice(0, 500), error.firstSeenAtMs)
      }

      const bootstrapComplete = batch.bootstrapComplete === true ? 1 : (current.bootstrapComplete ? 1 : 0)
      const sourceRevision = batch.bootstrapComplete === true ? (batch.sourceRevision ?? current.sourceRevision) : current.sourceRevision
      this.db.prepare(
        `INSERT INTO session_checkpoint (
           lifecycle_pk, last_seq, route_provider, route_model, bootstrap_complete, source_revision, updated_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(lifecycle_pk) DO UPDATE SET
           last_seq = excluded.last_seq,
           route_provider = excluded.route_provider,
           route_model = excluded.route_model,
           bootstrap_complete = excluded.bootstrap_complete,
           source_revision = excluded.source_revision,
           updated_at_ms = excluded.updated_at_ms`,
      ).run(
        lifecyclePk,
        result.state.checkpoint,
        result.state.routeProvider ?? null,
        result.state.routeModel ?? null,
        bootstrapComplete,
        sourceRevision,
        now,
      )
      this.bumpCommit()
      return { committed: true, checkpoint: result.state.checkpoint, commitGeneration: this.commitGeneration }
    })
  }

  // --- run epoch ---

  beginRunEpoch(startedAtMs = Date.now()): number {
    const row = this.db.prepare(
      `INSERT INTO run_epoch (started_at_ms, state) VALUES (?, 'arming') RETURNING epoch_id`,
    ).get(startedAtMs) as { epoch_id: number }
    return row.epoch_id
  }

  activateRunEpoch(epochId: number, baselines: ReadonlyArray<{ lifecyclePk: number; sourceRevision: string }>, now = Date.now()): void {
    this.transaction(() => {
      this.db.prepare(`UPDATE run_epoch SET state = 'active', clean_at_ms = NULL WHERE epoch_id = ?`).run(epochId)
      const insert = this.db.prepare(
        `INSERT INTO run_baseline (epoch_id, lifecycle_pk, source_revision) VALUES (?, ?, ?)
         ON CONFLICT(epoch_id, lifecycle_pk) DO UPDATE SET source_revision = excluded.source_revision`,
      )
      for (const baseline of baselines) insert.run(epochId, baseline.lifecyclePk, baseline.sourceRevision)
    })
    this.bumpState()
  }

  markRunClean(epochId: number, cleanAtMs = Date.now()): void {
    this.transaction(() => {
      this.db.prepare(`UPDATE run_epoch SET state = 'clean', clean_at_ms = ? WHERE epoch_id = ?`).run(cleanAtMs, epochId)
      this.db.prepare(`DELETE FROM run_baseline WHERE epoch_id = ?`).run(epochId)
    })
    this.bumpState()
  }

  getLastRunEpoch(): RunEpochInfo | undefined {
    const row = this.db.prepare(
      `SELECT epoch_id, started_at_ms, state, clean_at_ms FROM run_epoch ORDER BY epoch_id DESC LIMIT 1`,
    ).get() as { epoch_id: number; started_at_ms: number; state: 'arming' | 'active' | 'clean'; clean_at_ms: number | null } | undefined
    if (row === undefined) return undefined
    return { epochId: row.epoch_id, state: row.state, startedAtMs: row.started_at_ms, cleanAtMs: row.clean_at_ms }
  }

  getBaselines(epochId: number): Array<{ lifecyclePk: number; sourceRevision: string }> {
    const rows = this.db.prepare(
      `SELECT lifecycle_pk, source_revision FROM run_baseline WHERE epoch_id = ?`,
    ).all(epochId) as unknown as Array<{ lifecycle_pk: number; source_revision: string }>
    return rows.map((row) => ({ lifecyclePk: row.lifecycle_pk, sourceRevision: row.source_revision }))
  }

  // --- projection state ---

  getProjectionProgress(): ProjectionProgress {
    const row = this.db.prepare(
      `SELECT projection_version, phase, discovered_sessions, completed_sessions, scanning_sessions,
              retrying_sessions, failed_sessions, started_at_ms, completed_at_ms, last_error_code, last_error_message
       FROM projection_state WHERE singleton_id = 1`,
    ).get() as {
      projection_version: number
      phase: StoredProjectionPhase
      discovered_sessions: number
      completed_sessions: number
      scanning_sessions: number
      retrying_sessions: number
      failed_sessions: number
      started_at_ms: number | null
      completed_at_ms: number | null
      last_error_code: string | null
      last_error_message: string | null
    } | undefined
    if (row === undefined) {
      return {
        phase: 'initializing',
        discoveredSessions: 0,
        completedSessions: 0,
        scanningSessions: 0,
        retryingSessions: 0,
        failedSessions: 0,
        startedAtMs: null,
        completedAtMs: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      }
    }
    if (row.projection_version > PROJECTION_VERSION) throw new ProjectionTooNewError(`projection too new: ${row.projection_version}`)
    return {
      phase: row.phase,
      discoveredSessions: row.discovered_sessions,
      completedSessions: row.completed_sessions,
      scanningSessions: row.scanning_sessions,
      retryingSessions: row.retrying_sessions,
      failedSessions: row.failed_sessions,
      startedAtMs: row.started_at_ms,
      completedAtMs: row.completed_at_ms,
      lastErrorCode: row.last_error_code,
      lastErrorMessage: row.last_error_message,
    }
  }

  updateProjectionProgress(update: Partial<Omit<ProjectionProgress, 'phase'>> & { phase?: StoredProjectionPhase }, now = Date.now()): void {
    this.transaction(() => {
      const current = this.getProjectionProgress()
      const next = { ...current, ...update, updatedAtMs: now }
      this.db.prepare(
        `UPDATE projection_state SET
           projection_version = ?,
           phase = ?,
           discovered_sessions = ?,
           completed_sessions = ?,
           scanning_sessions = ?,
           retrying_sessions = ?,
           failed_sessions = ?,
           started_at_ms = ?,
           completed_at_ms = ?,
           last_error_code = ?,
           last_error_message = ?,
           updated_at_ms = ?
         WHERE singleton_id = 1`,
      ).run(
        PROJECTION_VERSION,
        next.phase,
        next.discoveredSessions,
        next.completedSessions,
        next.scanningSessions,
        next.retryingSessions,
        next.failedSessions,
        next.startedAtMs,
        next.completedAtMs,
        next.lastErrorCode,
        next.lastErrorMessage,
        next.updatedAtMs,
      )
    })
    this.bumpState()
  }

  setProjectionReady(now = Date.now()): void {
    this.updateProjectionProgress({ phase: 'ready', completedAtMs: now, scanningSessions: 0, retryingSessions: 0 })
  }

  // --- warnings / snapshot ---

  private warnings(): Array<{ code: string; count: number }> {
    const rows = this.db.prepare(
      `SELECT reason_code, COUNT(*) AS count FROM ingestion_error GROUP BY reason_code ORDER BY reason_code`,
    ).all() as unknown as WarningRow[]
    return rows.map((row) => ({ code: row.reason_code, count: row.count }))
  }

  snapshot(query: { weeks: number; offsetWeeks: number }, pendingBatches: number, now = Date.now()): SnapshotV1 {
    const progress = this.getProjectionProgress()
    const facts = this.db.prepare(
      `SELECT lifecycle_pk, turn, step, source_seq, occurred_at_ms, provider, model,
              input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
       FROM usage_fact`,
    ).all() as unknown as FactRow[]

    const todayKey = dayKeyOf(now, 'local')
    const fromDate = shiftDateKey(todayKey, -((query.offsetWeeks + query.weeks) * 7) + 1)
    const toDate = shiftDateKey(todayKey, -query.offsetWeeks * 7)

    const dayAgg = new Map<string, {
      totalTokens: number
      inputTokens: number
      outputTokens: number
      cacheReadTokens: number
      requests: number
      modelTotals: Map<string, ModelBucket>
    }>()
    const windowModelTotals = new Map<string, ModelBucket>()
    const sessions = new Set<number>()
    let today = 0
    let week = 0
    let month30 = 0
    let all = 0
    let cacheReadAll = 0

    for (const fact of facts) {
      const tokens = fact.input_tokens + fact.output_tokens + fact.cache_read_tokens
      all += tokens
      cacheReadAll += fact.cache_read_tokens
      sessions.add(fact.lifecycle_pk)
      const date = dayKeyOf(fact.occurred_at_ms, 'local')
      if (date === todayKey) today += tokens
      if (date > shiftDateKey(todayKey, -7) && date <= todayKey) week += tokens
      if (date > shiftDateKey(todayKey, -30) && date <= todayKey) month30 += tokens
      if (date >= fromDate && date <= toDate) {
        let day = dayAgg.get(date)
        if (day === undefined) {
          day = { totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, requests: 0, modelTotals: new Map() }
          dayAgg.set(date, day)
        }
        day.totalTokens += tokens
        day.inputTokens += fact.input_tokens
        day.outputTokens += fact.output_tokens
        day.cacheReadTokens += fact.cache_read_tokens
        day.requests += 1
        const provider = fact.provider ?? 'unknown'
        const model = fact.model ?? 'unknown'
        const key = provider + '::' + model
        const modelKey = provider + '\u0000' + model
        const dayEntry = day.modelTotals.get(modelKey)
        if (dayEntry === undefined) day.modelTotals.set(modelKey, { provider, model, tokens })
        else day.modelTotals.set(modelKey, { provider: dayEntry.provider, model: dayEntry.model, tokens: dayEntry.tokens + tokens })
        const windowEntry = windowModelTotals.get(modelKey)
        if (windowEntry === undefined) windowModelTotals.set(modelKey, { provider, model, tokens })
        else windowModelTotals.set(modelKey, { provider: windowEntry.provider, model: windowEntry.model, tokens: windowEntry.tokens + tokens })
      }
    }

    const days: SnapshotDay[] = []
    for (let date = fromDate; date <= toDate; date = shiftDateKey(date, 1)) {
      const agg = dayAgg.get(date)
      if (agg === undefined) {
        days.push({ date, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, requests: 0, byModel: [], otherModelCount: 0, otherModelTokens: 0 })
        continue
      }
      const models = [...agg.modelTotals.values()].sort(modelSort)
      const top = models.slice(0, 3)
      const otherModelCount = Math.max(0, models.length - 3)
      const otherModelTokens = models.slice(3).reduce((sum, entry) => sum + entry.tokens, 0)
      days.push({
        date,
        totalTokens: agg.totalTokens,
        inputTokens: agg.inputTokens,
        outputTokens: agg.outputTokens,
        cacheReadTokens: agg.cacheReadTokens,
        requests: agg.requests,
        byModel: top,
        otherModelCount,
        otherModelTokens,
      })
    }

    const windowModels = [...windowModelTotals.values()].sort(modelSort)
    const topModels = windowModels.slice(0, 100)
    const otherModelCount = Math.max(0, windowModels.length - 100)
    const otherModelTokens = windowModels.slice(100).reduce((sum, entry) => sum + entry.tokens, 0)

    const browserPhase: ProjectionPhase = progress.phase === 'rebuild_required' || progress.phase === 'error' ? 'degraded' : progress.phase
    const warnings = this.warnings()
    const totalWarnings = warnings.reduce((sum, entry) => sum + entry.count, 0)
    return {
      contractVersion: SNAPSHOT_CONTRACT_VERSION,
      asOf: {
        committedAtMs: Date.now(),
        commitGeneration: this.commitGeneration,
        stateGeneration: this.stateGeneration,
      },
      query: { weeks: query.weeks, offsetWeeks: query.offsetWeeks, timezone: 'local', fromDate, toDate },
      projection: {
        phase: browserPhase,
        complete: progress.phase === 'ready',
        pendingBatches,
        progress: {
          discoveredSessions: progress.discoveredSessions,
          completedSessions: progress.completedSessions,
          scanningSessions: progress.scanningSessions,
          retryingSessions: progress.retryingSessions,
          failedSessions: progress.failedSessions,
          startedAtMs: progress.startedAtMs,
          completedAtMs: progress.completedAtMs,
        },
      },
      summary: {
        today,
        week,
        month30,
        all,
        cacheReadAll,
        sessionCount: sessions.size,
      },
      days,
      byModel: { items: topModels, otherModelCount, otherModelTokens },
      warnings: { count: totalWarnings, byCode: warnings },
    }
  }
}

function modelSort(a: ModelBucket, b: ModelBucket): number {
  if (a.tokens !== b.tokens) return b.tokens - a.tokens
  if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
  return a.model.localeCompare(b.model)
}
