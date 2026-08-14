// Day bucketing: attribute usage samples to YYYY-MM-DD days under a
// timezone policy (05 decision: local machine timezone by default, UTC as an
// overridable option; DST-safe per-sample offsets).

import type { ModelBucket, TokenDayBucket, TokenUsageLike, UsageSample } from '../core/types'

export type TimezonePolicy = 'local' | 'utc'

const HOUR_MS = 3_600_000

/** Machine-local UTC offset (hours, positive east) at the given instant. */
export function localOffsetHours(time: number): number {
  return -new Date(time).getTimezoneOffset() / 60
}

export function offsetHoursFor(tz: TimezonePolicy, time: number, localOffset: (t: number) => number = localOffsetHours): number {
  return tz === 'utc' ? 0 : localOffset(time)
}

/** YYYY-MM-DD of an epoch-ms instant under the timezone policy. */
export function dayKeyOf(time: number, tz: TimezonePolicy, localOffset: (t: number) => number = localOffsetHours): string {
  return new Date(time + offsetHoursFor(tz, time, localOffset) * HOUR_MS).toISOString().slice(0, 10)
}

/** YYYY-MM-DD shifted by N days (pure, timezone-independent calendar math). */
export function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

function emptyBucket(date: string): TokenDayBucket {
  return { date, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, requests: 0, byModel: [] }
}

function addUsage(bucket: TokenDayBucket, sample: UsageSample): void {
  const usage = sample.usage
  const input = usage.inputTokens ?? 0
  const output = usage.outputTokens ?? 0
  const cacheRead = usage.cacheReadTokens ?? 0
  bucket.inputTokens += input
  bucket.outputTokens += output
  // User decision (05 Revision): cache reads count into the headline total.
  bucket.totalTokens += input + output + cacheRead
  bucket.cacheReadTokens += cacheRead
  bucket.requests += 1
  const provider = sample.provider ?? 'unknown'
  const model = sample.model ?? 'unknown'
  const key = provider + '\u0000' + model
  const byModel = (bucket as TokenDayBucket & { byModelMap?: Map<string, ModelBucket> }).byModelMap
    ?? ((bucket as TokenDayBucket & { byModelMap?: Map<string, ModelBucket> }).byModelMap = new Map())
  let entry = byModel.get(key)
  if (entry === undefined) {
    entry = { provider, model, tokens: 0 }
    byModel.set(key, entry)
  }
  entry.tokens += input + output + cacheRead
}

/** Aggregate every sample into the full day-bucket map (no window truncation). */
export function buildBucketMap(
  samples: Iterable<UsageSample>,
  tz: TimezonePolicy,
  localOffset: (t: number) => number = localOffsetHours,
): Map<string, TokenDayBucket> {
  const buckets = new Map<string, TokenDayBucket>()
  for (const sample of samples) {
    const key = dayKeyOf(sample.time, tz, localOffset)
    let bucket = buckets.get(key)
    if (bucket === undefined) {
      bucket = emptyBucket(key)
      buckets.set(key, bucket)
    }
    addUsage(bucket, sample)
  }
  for (const bucket of buckets.values()) {
    const map = (bucket as TokenDayBucket & { byModelMap?: Map<string, ModelBucket> }).byModelMap
    if (map !== undefined) {
      bucket.byModel = [...map.values()].sort((a, b) => b.tokens - a.tokens)
      delete (bucket as TokenDayBucket & { byModelMap?: Map<string, ModelBucket> }).byModelMap
    }
  }
  return buckets
}

/**
 * Zero-filled day buckets for the window
 * [today - (offsetWeeks + weeks) * 7 + 1, today - offsetWeeks * 7], oldest
 * first (05 decision: 26-week default window, offset paging).
 */
export function buildDays(
  samples: Iterable<UsageSample>,
  tz: TimezonePolicy,
  weeks: number,
  offsetWeeks: number,
  now = Date.now(),
  localOffset: (t: number) => number = localOffsetHours,
): TokenDayBucket[] {
  const buckets = buildBucketMap(samples, tz, localOffset)
  const todayKey = dayKeyOf(now, tz, localOffset)
  const start = shiftDateKey(todayKey, -((offsetWeeks + weeks) * 7) + 1)
  const end = shiftDateKey(todayKey, -offsetWeeks * 7)
  const days: TokenDayBucket[] = []
  for (let key = start; key <= end; key = shiftDateKey(key, 1)) {
    days.push(buckets.get(key) ?? emptyBucket(key))
  }
  return days
}

/** Rolling totals for the panel header, summed from the full bucket map. */
export function buildSummary(
  buckets: ReadonlyMap<string, TokenDayBucket>,
  tz: TimezonePolicy,
  now = Date.now(),
  localOffset: (t: number) => number = localOffsetHours,
): { today: number; week: number; month30: number; all: number; cacheReadAll: number } {
  const todayKey = dayKeyOf(now, tz, localOffset)
  let today = 0
  let week = 0
  let month30 = 0
  let all = 0
  let cacheReadAll = 0
  for (const [key, bucket] of buckets) {
    all += bucket.totalTokens
    cacheReadAll += bucket.cacheReadTokens
    if (key === todayKey) today = bucket.totalTokens
    if (key > shiftDateKey(todayKey, -7) && key <= todayKey) week += bucket.totalTokens
    if (key > shiftDateKey(todayKey, -30) && key <= todayKey) month30 += bucket.totalTokens
  }
  return { today, week, month30, all, cacheReadAll }
}