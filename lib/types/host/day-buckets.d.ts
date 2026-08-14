import type { TokenDayBucket, UsageSample } from '../core/types.ts';
export type TimezonePolicy = 'local' | 'utc';
/** Machine-local UTC offset (hours, positive east) at the given instant. */
export declare function localOffsetHours(time: number): number;
export declare function offsetHoursFor(tz: TimezonePolicy, time: number, localOffset?: (t: number) => number): number;
/** YYYY-MM-DD of an epoch-ms instant under the timezone policy. */
export declare function dayKeyOf(time: number, tz: TimezonePolicy, localOffset?: (t: number) => number): string;
/** YYYY-MM-DD shifted by N days (pure, timezone-independent calendar math). */
export declare function shiftDateKey(key: string, days: number): string;
/** Aggregate every sample into the full day-bucket map (no window truncation). */
export declare function buildBucketMap(samples: Iterable<UsageSample>, tz: TimezonePolicy, localOffset?: (t: number) => number): Map<string, TokenDayBucket>;
/**
 * Zero-filled day buckets for the window
 * [today - (offsetWeeks + weeks) * 7 + 1, today - offsetWeeks * 7], oldest
 * first (05 decision: 26-week default window, offset paging).
 */
export declare function buildDays(samples: Iterable<UsageSample>, tz: TimezonePolicy, weeks: number, offsetWeeks: number, now?: number, localOffset?: (t: number) => number): TokenDayBucket[];
/** Rolling totals for the panel header, summed from the full bucket map. */
export declare function buildSummary(buckets: ReadonlyMap<string, TokenDayBucket>, tz: TimezonePolicy, now?: number, localOffset?: (t: number) => number): {
    today: number;
    week: number;
    month30: number;
    all: number;
    cacheReadAll: number;
};
//# sourceMappingURL=day-buckets.d.ts.map