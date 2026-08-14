// Fold semantics (research 02, §3): last sample per (turn, step) wins;
// chunk-only samples (failed request) still count; unrelated events ignored.
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { foldUsage, mergeUsage } from '../src/host/usage-fold'

function chunk(turn: number, step: number, seq: number, time: number, input: number, output: number, cacheRead = 0): SessionEvent {
  return { type: 'assistant/chunk', seq, time, data: { turn, step, chunk: { type: 'usage', usage: { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead } } } } as SessionEvent
}
function message(turn: number, step: number, seq: number, time: number, input: number, output: number, cacheRead = 0): SessionEvent {
  return { type: 'assistant/message', seq, time, data: { turn, step, message: {}, usage: { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead } } } as unknown as SessionEvent
}
function noise(seq: number, time: number): SessionEvent {
  return { type: 'turn/start', seq, time, data: { turn: 1 } } as SessionEvent
}

describe('foldUsage', () => {
  it('counts a chunk + message pair exactly once (message wins)', () => {
    const events = [noise(0, 0), chunk(1, 1, 1, 10, 100, 50, 9000), message(1, 1, 2, 11, 100, 50, 9000)]
    const samples = foldUsage(events)
    expect(samples).toHaveLength(1)
    expect(samples[0].usage).toEqual({ inputTokens: 100, outputTokens:50, cacheReadTokens: 9000 })
  })

  it('keeps the chunk sample when no final message arrives (failed request)', () => {
    const events = [chunk(1, 1, 1, 10, 120, 80)]
    const samples = foldUsage(events)
    expect(samples).toHaveLength(1)
    expect(samples[0].usage.inputTokens).toBe(120)
  })

  it('replaces an earlier sample when a later one reports for the same (turn, step)', () => {
    const events = [chunk(1, 2, 1, 10, 5, 5), message(1, 2, 2, 11, 5, 5), message(1, 2, 9, 99, 7, 7)]
    const samples = foldUsage(events)
    expect(samples).toHaveLength(1)
    expect(samples[0].usage.inputTokens).toBe(7)
    expect(samples[0].time).toBe(99)
  })

  it('ignores events without usage and separates different (turn, step)', () => {
    const events = [noise(0, 0), chunk(1, 1, 1, 10, 10, 2), message(1, 1, 2, 11, 10, 2), chunk(2, 1, 3, 20, 30, 4)]
    const samples = foldUsage(events)
    expect(samples).toHaveLength(2)
    expect(samples.map((s) => s.usage.inputTokens).sort()).toEqual([10, 30])
  })

  it('returns samples sorted by event time', () => {
    const events = [chunk(2, 1, 5, 200, 1, 1), chunk(1, 1, 1, 100, 1, 1)]
    const times = foldUsage(events).map((s) => s.time)
    expect(times).toEqual([100, 200])
  })
})

describe('mergeUsage', () => {
  it('overwrites same-key samples and adds new keys', () => {
    const existing = new Map([['1:1', { turn: 1, step: 1, time: 10, usage: { inputTokens: 100, outputTokens: 50 } }]])
    mergeUsage(existing, [{ turn: 1, step: 1, time: 11, usage: { inputTokens: 100, outputTokens: 50 } }, { turn: 1, step: 2, time: 12, usage: { inputTokens: 7, outputTokens: 3 } }])
    expect(existing.size).toBe(2)
    expect(existing.get('1:1')?.time).toBe(11)
    expect(existing.get('1:2')?.usage.inputTokens).toBe(7)
  })
})
describe('provider/model tracking', () => {
  it('attaches the provider/model from the preceding request events', () => {
    const header = { type: 'request/header', seq: 0, time: 0, data: { header: { config: { provider: 'opencode', model: 'deepseek-v4-pro' } }, reason: 'initial' } } as SessionEvent
    const context = { type: 'request/context', seq: 1, time: 1, data: { provider: 'opencode', model: 'deepseek-v4-flash', contextWindow: 1000000 } } as SessionEvent
    const events = [header, context, chunk(1, 1, 2, 10, 10, 5)]
    const samples = foldUsage(events)
    expect(samples[0].provider).toBe('opencode')
    expect(samples[0].model).toBe('deepseek-v4-flash') // context wins (later in seq)
  })

  it('follows a later request/header change and leaves pre-request samples untyped', () => {
    const headerA = { type: 'request/header', seq: 0, time: 0, data: { header: { config: { provider: 'opencode', model: 'deepseek-v4-pro' } }, reason: 'initial' } } as SessionEvent
    const headerB = { type: 'request/header', seq: 3, time: 3, data: { header: { config: { provider: 'opencode', model: 'deepseek-v4-flash' } }, reason: 'retry' } } as SessionEvent
    const events = [chunk(1, 1, 1, 1, 5, 5), headerA, message(1, 1, 2, 2, 5, 5), headerB, chunk(2, 1, 4, 4, 7, 7)]
    const samples = foldUsage(events)
    expect(samples.find((s) => s.turn === 1)?.provider).toBe('opencode')
    expect(samples.find((s) => s.turn === 1)?.model).toBe('deepseek-v4-pro')
    expect(samples.find((s) => s.turn === 2)?.model).toBe('deepseek-v4-flash')
  })
})
