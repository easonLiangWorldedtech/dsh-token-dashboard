// Commit 1 gate: shared contract + pure projector.
// Covers route cursor, chunk/message last-wins, invalid event isolation,
// continuous seq/gap and Token safe integers.
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { IngestionCodes } from '../src/durable/contracts'
import {
  createProjectionState,
  factKey,
  normalizeEventDelta,
  normalizeEventDeltas,
  normalizeTokenUsage,
  projectBatch,
  projectDeltas,
} from '../src/durable/projector'

function chunk(turn: number, step: number, seq: number, time: number, input: number, output: number, cacheRead = 0): SessionEvent {
  return { type: 'assistant/chunk', seq, time, data: { turn, step, chunk: { type: 'usage', usage: { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead } } } } as SessionEvent
}
function message(turn: number, step: number, seq: number, time: number, input: number, output: number, cacheRead = 0): SessionEvent {
  return { type: 'assistant/message', seq, time, data: { turn, step, message: {}, usage: { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead } } } as unknown as SessionEvent
}
function header(seq: number, time: number, provider: string, model: string): SessionEvent {
  return { type: 'request/header', seq, time, data: { header: { config: { provider, model } }, reason: 'initial' } } as SessionEvent
}
function context(seq: number, time: number, provider: string, model: string): SessionEvent {
  return { type: 'request/context', seq, time, data: { provider, model, contextWindow: 1000000 } } as SessionEvent
}
function noise(seq: number, time: number): SessionEvent {
  return { type: 'turn/start', seq, time, data: { turn: 1 } } as SessionEvent
}

describe('normalizeTokenUsage', () => {
  it('normalizes missing buckets to zero and keeps cacheWrite', () => {
    expect(normalizeTokenUsage({ inputTokens: 10, outputTokens: 5 })).toEqual({
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 },
    })
  })

  it('rejects negative, fractional and unsafe integers', () => {
    expect(normalizeTokenUsage({ inputTokens: -1, outputTokens: 0 }).reasonCode).toBe(IngestionCodes.BadTokenValue)
    expect(normalizeTokenUsage({ inputTokens: 1.5, outputTokens: 0 }).reasonCode).toBe(IngestionCodes.BadTokenValue)
    expect(normalizeTokenUsage({ inputTokens: Number.MAX_SAFE_INTEGER + 1, outputTokens: 0 }).reasonCode).toBe(IngestionCodes.BadTokenValue)
    expect(normalizeTokenUsage({ inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 0 }).usage?.inputTokens).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('normalizeEventDelta', () => {
  it('extracts only route and usage deltas, never message bodies', () => {
    const events = [
      noise(0, 0),
      header(1, 1, 'opencode', 'deepseek-v4-pro'),
      chunk(2, 2, 2, 10, 10, 5),
      message(2, 2, 3, 11, 10, 5),
    ]
    const deltas = normalizeEventDeltas(events)
    expect(deltas).toHaveLength(3)
    expect(deltas[0]).toMatchObject({ kind: 'route', provider: 'opencode', model: 'deepseek-v4-pro' })
    expect(deltas[1]).toMatchObject({ kind: 'usage', turn: 2, step: 2, final: false })
    expect(deltas[2]).toMatchObject({ kind: 'usage', turn: 2, step: 2, final: true })
    expect(JSON.stringify(deltas)).not.toContain('message')
  })
})

describe('projectBatch', () => {
  it('tracks route cursor across restart boundaries', () => {
    const events = [
      header(0, 0, 'opencode', 'deepseek-v4-pro'),
      chunk(1, 1, 1, 10, 10, 5),
      context(2, 2, 'opencode', 'deepseek-v4-flash'),
      message(2, 1, 3, 11, 10, 5),
    ]
    let state = createProjectionState()
    state = projectBatch(state, { fromSeq: 0, toSeq: 1, deltas: normalizeEventDeltas(events.slice(0, 2)) }).state
    expect(state.routeProvider).toBe('opencode')
    expect(state.routeModel).toBe('deepseek-v4-pro')
    expect(state.checkpoint).toBe(1)
    state = projectBatch(state, { fromSeq: 2, toSeq: 3, deltas: normalizeEventDeltas(events.slice(2)) }).state
    expect(state.routeModel).toBe('deepseek-v4-flash')
    expect(state.checkpoint).toBe(3)
    expect(state.facts.get(factKey(2, 1))?.model).toBe('deepseek-v4-flash')
  })

  it('chunk + final message counts once; message replaces chunk by larger seq', () => {
    const state = projectDeltas([
      { kind: 'usage', seq: 1, time: 10, turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 9000 }, final: false },
      { kind: 'usage', seq: 2, time: 11, turn: 1, step: 1, usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 9000 }, final: true },
    ], 0, 2)
    expect(state.facts.size).toBe(1)
    expect(state.facts.get(factKey(1, 1))?.sourceSeq).toBe(2)
  })

  it('keeps chunk-only fact when no final message arrives', () => {
    const state = projectDeltas([
      { kind: 'usage', seq: 1, time: 10, turn: 1, step: 1, usage: { inputTokens: 120, outputTokens: 80 }, final: false },
    ], 0, 1)
    expect(state.facts.get(factKey(1, 1))?.inputTokens).toBe(120)
  })

  it('isolates invalid events and advances checkpoint', () => {
    const state = projectDeltas([
      { kind: 'usage', seq: 1, time: 10, turn: 1, step: 1, usage: { inputTokens: -1, outputTokens: 0 }, final: false },
      { kind: 'usage', seq: 2, time: 11, turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 5 }, final: true },
    ], 0, 2)
    expect(state.facts.size).toBe(1)
    expect(state.errors.size).toBe(1)
    expect(state.errors.get(1)?.reasonCode).toBe(IngestionCodes.BadTokenValue)
    expect(state.checkpoint).toBe(2)
  })

  it('rejects gaps and no-ops entirely old batches', () => {
    const state = createProjectionState()
    const gap = projectBatch(state, { fromSeq: 2, toSeq: 3, deltas: [] })
    expect(gap.status).toBe('gap')
    const noop = projectBatch({ ...state, checkpoint: 5 }, { fromSeq: 4, toSeq: 4, deltas: [] })
    expect(noop.status).toBe('noop')
  })

  it('does not overwrite a fact with an older source_seq', () => {
    const state = projectDeltas([
      { kind: 'usage', seq: 2, time: 11, turn: 1, step: 1, usage: { inputTokens: 10, outputTokens: 5 }, final: true },
      { kind: 'usage', seq: 1, time: 10, turn: 1, step: 1, usage: { inputTokens: 99, outputTokens: 99 }, final: false },
    ], 0, 2)
    expect(state.facts.get(factKey(1, 1))?.inputTokens).toBe(10)
  })

  it('non-null route fields overwrite, absent fields preserve prior route', () => {
    const state = projectDeltas([
      { kind: 'route', seq: 0, time: 0, provider: 'opencode', model: 'pro' },
      { kind: 'route', seq: 1, time: 1, model: 'flash' },
      { kind: 'usage', seq: 2, time: 2, turn: 1, step: 1, usage: { inputTokens: 1, outputTokens: 2 }, final: true },
    ], 0, 2)
    const fact = state.facts.get(factKey(1, 1))
    expect(fact?.provider).toBe('opencode')
    expect(fact?.model).toBe('flash')
  })
})
