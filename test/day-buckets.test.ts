// Day bucketing: timezone policies, window zero-filling, paging, and the
// input+output headline with cacheRead excluded (05 decisions).
import { describe, expect, it } from 'vitest'
import { buildDays, buildSummary, dayKeyOf, shiftDateKey } from '../src/host/day-buckets'
import type { UsageSample } from '../src/core/types'

const plus8 = () => 8
const FIXED_NOW = Date.UTC(2026, 7, 14, 4, 0) // 2026-08-14T04:00Z = 2026-08-14T12:00 +08

function sample(time: number, input: number, output: number, cacheRead = 0, turn = 1, step = 1): UsageSample {
  return { turn, step, time, usage: { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead } }
}

describe('dayKeyOf', () => {
  it('cuts days at midnight local (+8) and at midnight UTC', () => {
    const beforeLocalMidnight = Date.UTC(2026, 7, 13, 15, 59) // 23:59 +08 on the 13th
    const afterLocalMidnight = Date.UTC(2026, 7, 13, 16, 1) // 00:01 +08 on the 14th
    expect(dayKeyOf(beforeLocalMidnight, 'local', plus8)).toBe('2026-08-13')
    expect(dayKeyOf(afterLocalMidnight, 'local', plus8)).toBe('2026-08-14')
    expect(dayKeyOf(beforeLocalMidnight, 'utc')).toBe('2026-08-13')
    expect(dayKeyOf(afterLocalMidnight, 'utc')).toBe('2026-08-13')
  })
})

describe('shiftDateKey', () => {
  it('walks across month and year boundaries', () => {
    expect(shiftDateKey('2026-08-01', -1)).toBe('2026-07-31')
    expect(shiftDateKey('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDateKey('2026-02-28', 1)).toBe('2026-03-01')
  })
})

describe('buildDays', () => {
  it('zero-fills the full window and sums the headline total (cache included)', () => {
    const days = buildDays([
      sample(Date.UTC(2026, 7, 10, 4, 0), 100, 50, 9000), // 2026-08-10 +08
      sample(Date.UTC(2026, 7, 10, 9, 0), 20, 30, 1000), // same day +08
      sample(Date.UTC(2026, 7, 9, 16, 0), 5, 5), // 2026-08-10 +08 (after midnight)
    ], 'local', 2, 0, FIXED_NOW, plus8)
    expect(days).toHaveLength(14)
    const byDate = new Map(days.map((d) => [d.date, d]))
    const target = byDate.get('2026-08-10')
    expect(target?.totalTokens).toBe(10210) // 150 + 50 + 10 + cacheRead 10000 (user decision)
    expect(target?.inputTokens).toBe(125)
    expect(target?.outputTokens).toBe(85)
    expect(target?.cacheReadTokens).toBe(10000)
    expect(target?.requests).toBe(3)
    expect(target?.byModel).toEqual([{ provider: 'unknown', model: 'unknown', tokens: 10210 }])
    expect(byDate.get('2026-08-13')?.totalTokens).toBe(0) // zero-filled
    expect(byDate.get('2026-08-13')?.byModel).toEqual([])
    expect(days[days.length - 1].date).toBe('2026-08-14') // window ends today
  })

  it('pages backward with offsetWeeks', () => {
    const days = buildDays([], 'utc', 2, 2, FIXED_NOW)
    expect(days).toHaveLength(14)
    expect(days[0].date).toBe('2026-07-18') // today - 27 days (window start, inclusive)
    expect(days[days.length - 1].date).toBe('2026-07-31') // today - 14 days (window end)
  })
})

describe('buildSummary', () => {
  it('computes today / week / month30 / all with cacheRead separated', () => {
    const buckets = new Map([
      ['2026-08-14', { date: '2026-08-14', totalTokens: 100, inputTokens: 60, outputTokens: 40, cacheReadTokens: 5000, requests: 2, byModel: [] }],
      ['2026-08-10', { date: '2026-08-10', totalTokens: 50, inputTokens: 30, outputTokens: 20, cacheReadTokens: 3000, requests: 1, byModel: [] }],
      ['2026-06-01', { date: '2026-06-01', totalTokens: 999, inputTokens: 900, outputTokens: 99, cacheReadTokens: 0, requests: 5, byModel: [] }],
    ])
    const summary = buildSummary(buckets, 'local', FIXED_NOW, plus8)
    expect(summary.today).toBe(100)
    expect(summary.week).toBe(150) // 8/10 is within 7 days of 8/14
    expect(summary.month30).toBe(150) // 6/1 falls outside
    expect(summary.all).toBe(1149)
    expect(summary.cacheReadAll).toBe(8000)
  })
})