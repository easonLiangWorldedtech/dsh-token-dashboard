// Incremental cache behavior over the persistence seam contract: cold fold,
// unchanged-revision skip, tail-only refold, and pruning of removed sessions.
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { TokenAggregator } from '../src/host/aggregator'
import { dayKeyOf } from '../src/host/day-buckets'

function usageMessage(turn: number, step: number, seq: number, time: number, input: number, output: number): SessionEvent {
  return { type: 'assistant/message', seq, time, data: { turn, step, message: {}, usage: { inputTokens: input, outputTokens: output } } } as unknown as SessionEvent
}

function fakePersistence() {
  const sessions = new Map<string, { revision: number; events: SessionEvent[] }>()
  let listCalls = 0
  let inspectCalls = 0
  let readFromCalls = 0
  const reads: Array<{ id: string; fromSeq: number }> = []
  return {
    sessions,
    stats: () => ({ listCalls, inspectCalls, readFromCalls, reads }),
    persistence: {
      async listSnapshots() {
        listCalls += 1
        return [...sessions.entries()].map(([id, s]) => ({ header: { id }, revision: 'r' + s.revision }))
      },
      async inspect(id: string) {
        inspectCalls += 1
        return { events: sessions.get(id)?.events ?? [] }
      },
      async readFrom(id: string, fromSeq: number) {
        readFromCalls += 1
        reads.push({ id, fromSeq })
        return { events: (sessions.get(id)?.events ?? []).filter((e) => e.seq >= fromSeq) }
      },
    },
  }
}

const T0 = Date.UTC(2026, 7, 10, 4, 0)

describe('TokenAggregator', () => {
  it('cold-folds every session and answers summary/days', async () => {
    const fx = fakePersistence()
    fx.sessions.set('s1', { revision: 1, events: [usageMessage(1, 1, 0, T0, 100, 50), usageMessage(1, 2, 1, T0, 30, 20)] })
    fx.sessions.set('s2', { revision: 1, events: [usageMessage(1, 1, 0, T0, 10, 5)] })
    const agg = new TokenAggregator(fx.persistence)
    await agg.refresh()
    expect(fx.stats().inspectCalls).toBe(2)
    expect(agg.summary('utc').all).toBe(215)
    expect(agg.summary('utc').sessionCount).toBe(2)
    expect(agg.days('utc', 26, 0)).toHaveLength(26 * 7)
  })

  it('skips sessions whose revision is unchanged and refolds only the tail of changed ones', async () => {
    const fx = fakePersistence()
    fx.sessions.set('s1', { revision: 1, events: [usageMessage(1, 1, 0, T0, 100, 50)] })
    const agg = new TokenAggregator(fx.persistence)
    await agg.refresh()
    expect(fx.stats().inspectCalls).toBe(1)

    await agg.refresh() // nothing changed: no reads at all
    expect(fx.stats().inspectCalls).toBe(1)
    expect(fx.stats().readFromCalls).toBe(0)

    fx.sessions.get('s1')!.events.push(usageMessage(1, 2, 1, T0, 30, 20))
    fx.sessions.get('s1')!.revision = 2
    await agg.refresh()
    expect(fx.stats().readFromCalls).toBe(1)
    expect(fx.stats().reads).toEqual([{ id: 's1', fromSeq: 1 }]) // watermark = lastSeq + 1
    expect(agg.summary('utc').all).toBe(200)
  })

  it('overwrites a cached chunk sample when its final message lands in the tail', async () => {
    const fx = fakePersistence()
    const chunk = { type: 'assistant/chunk', seq: 0, time: T0, data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } } } } as SessionEvent
    fx.sessions.set('s1', { revision: 1, events: [chunk] })
    const agg = new TokenAggregator(fx.persistence)
    await agg.refresh()
    expect(agg.summary('utc').all).toBe(150)

    fx.sessions.get('s1')!.events.push(usageMessage(1, 1, 1, T0, 100, 50))
    fx.sessions.get('s1')!.revision = 2
    await agg.refresh()
    expect(agg.summary('utc').all).toBe(150) // replaced, not double-counted
  })

  it('prunes sessions removed from the store', async () => {
    const fx = fakePersistence()
    fx.sessions.set('s1', { revision: 1, events: [usageMessage(1, 1, 0, T0, 100, 50)] })
    const agg = new TokenAggregator(fx.persistence)
    await agg.refresh()
    expect(agg.summary('utc').all).toBe(150)
    fx.sessions.delete('s1')
    await agg.refresh()
    expect(agg.summary('utc').all).toBe(0)
    expect(agg.summary('utc').sessionCount).toBe(0)
  })

  it('buckets days by the requested timezone policy', async () => {
    const fx = fakePersistence()
    const nearMidnight = Date.UTC(2026, 7, 13, 16, 1) // 00:01 +08 on 8/14, but 8/13 in UTC
    fx.sessions.set('s1', { revision: 1, events: [usageMessage(1, 1, 0, nearMidnight, 10, 5)] })
    const agg = new TokenAggregator(fx.persistence)
    await agg.refresh()
    expect(dayKeyOf(nearMidnight, 'local')).toBe('2026-08-14')
    const localDays = agg.days('local', 1, 0)
    expect(localDays[localDays.length - 1].date).toBe(dayKeyOf(Date.now(), 'local'))
    const utcMap = new Map(agg.days('utc', 1, 0).map((d) => [d.date, d]))
    const localMap = new Map(localDays.map((d) => [d.date, d]))
    expect(utcMap.get('2026-08-13')?.totalTokens).toBe(15)
    expect(localMap.get('2026-08-14')?.totalTokens).toBe(15)
  })
})
