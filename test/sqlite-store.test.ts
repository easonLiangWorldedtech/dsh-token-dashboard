// Commit 2 gate: SQLite schema/repository/query.
// Uses temporary DSH_HOME databases only; never touches ~/.dsh.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ProjectionBatch } from '../src/durable/contracts'
import { ProjectionGapError, SqliteUsageStore } from '../src/durable/sqlite-store'

let dir: string
let store: SqliteUsageStore

function lifecycle(sessionId = 's1', createdAtMs = 1000, cwd = '/tmp/project') {
  return { sessionId, createdAtMs, cwd }
}

function batch(seq: number, turn = 1, step = 1, input = 10, output = 5, cacheRead = 0, overrides: Partial<ProjectionBatch> = {}): ProjectionBatch {
  return {
    batchId: 'b' + seq,
    hostGeneration: 'gen-1',
    lifecycle: lifecycle(),
    fromSeq: 0,
    toSeq: seq,
    deltas: [
      { kind: 'route', seq: 0, time: 0, provider: 'opencode', model: 'deepseek-v4-pro' },
      { kind: 'usage', seq, time: Date.now(), turn, step, usage: { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead }, final: true },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-token-dashboard-store-'))
  store = new SqliteUsageStore(join(dir, 'usage-v1.sqlite'))
})

afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('SqliteUsageStore schema', () => {
  it('creates the contract schema and identity pragmas', () => {
    const app = (store as unknown as { db: { prepare(sql: string): { get(): { application_id: number } } } }).db.prepare('PRAGMA application_id').get().application_id
    const user = (store as unknown as { db: { prepare(sql: string): { get(): { user_version: number } } } }).db.prepare('PRAGMA user_version').get().user_version
    expect(app).toBe(0x44544f4b)
    expect(user).toBe(1)
    expect(store.getProjectionProgress().phase).toBe('initializing')
  })

  it('enforces lifecycle unique identity and fact PK', () => {
    store.upsertLifecycle(lifecycle())
    store.upsertLifecycle(lifecycle())
    const pk = store.getLifecycle(lifecycle())
    expect(pk).toBeTypeOf('number')
  })
})

describe('SqliteUsageStore projection', () => {
  it('projects a batch and returns a consistent snapshot', () => {
    store.projectBatch(batch(2, 1, 1, 100, 50, 9000))
    store.projectBatch(batch(4, 1, 2, 30, 20, 0))
    const snap = store.snapshot({ weeks: 1, offsetWeeks: 0 }, 0)
    expect(snap.summary.all).toBe(9200)
    expect(snap.summary.cacheReadAll).toBe(9000)
    expect(snap.summary.sessionCount).toBe(1)
    expect(snap.days).toHaveLength(7)
    const today = snap.days[snap.days.length - 1]
    expect(today.totalTokens).toBe(9200)
    expect(today.byModel[0]).toMatchObject({ provider: 'opencode', model: 'deepseek-v4-pro', tokens: 9200 })
  })

  it('replaying the same batch is idempotent and does not double count', () => {
    store.projectBatch(batch(2))
    store.projectBatch(batch(2))
    const snap = store.snapshot({ weeks: 1, offsetWeeks: 0 }, 0)
    expect(snap.summary.all).toBe(15)
    expect(snap.summary.sessionCount).toBe(1)
  })

  it('rejects a gap and leaves checkpoint unchanged', () => {
    store.projectBatch(batch(2))
    const before = store.getCheckpoint(store.getLifecycle(lifecycle())!)
    expect(() => store.projectBatch({ ...batch(5), fromSeq: 4, toSeq: 5 })).toThrow(ProjectionGapError)
    const after = store.getCheckpoint(store.getLifecycle(lifecycle())!)
    expect(after.lastSeq).toBe(before.lastSeq)
  })

  it('isolates bad token values into ingestion_error and advances checkpoint', () => {
    store.projectBatch({
      ...batch(2, 1, 1, -1, 0),
      deltas: [
        { kind: 'usage', seq: 2, time: 2000, turn: 1, step: 1, usage: { inputTokens: -1, outputTokens: 0 }, final: true },
      ],
    })
    const snap = store.snapshot({ weeks: 1, offsetWeeks: 0 }, 0)
    expect(snap.summary.all).toBe(0)
    expect(snap.warnings.count).toBe(1)
    expect(snap.warnings.byCode[0]?.code).toBe('bad_token_value')
    expect(store.getCheckpoint(store.getLifecycle(lifecycle())!).lastSeq).toBe(2)
  })

  it('commits facts and checkpoint in one transaction; rollback keeps both absent', () => {
    expect(() => store.transaction(() => {
      store.projectBatch(batch(2))
      throw new Error('boom')
    })).toThrow('boom')
    const pk = store.getLifecycle(lifecycle())
    expect(pk).toBeUndefined()
    const snap = store.snapshot({ weeks: 1, offsetWeeks: 0 }, 0)
    expect(snap.summary.all).toBe(0)
  })
})

describe('SqliteUsageStore run epoch', () => {
  it('arms, activates with baseline and cleans only after drain', () => {
    const pk = store.upsertLifecycle(lifecycle())
    const epochId = store.beginRunEpoch()
    store.activateRunEpoch(epochId, [{ lifecyclePk: pk, sourceRevision: 'r1' }])
    expect(store.getLastRunEpoch()?.state).toBe('active')
    expect(store.getBaselines(epochId)).toHaveLength(1)
    store.markRunClean(epochId)
    expect(store.getLastRunEpoch()?.state).toBe('clean')
    expect(store.getBaselines(epochId)).toHaveLength(0)
  })
})
