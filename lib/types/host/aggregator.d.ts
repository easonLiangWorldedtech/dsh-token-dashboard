import type { TimezonePolicy, TokenDayBucket, TokenSummary } from '../core/types';
/** Minimal structural contract satisfied by ctx.sessionPersistence. */
export interface PersistenceLike {
    listSnapshots(): Promise<Array<{
        header: {
            id: string;
        };
        revision: unknown;
    }>>;
    inspect(id: string): Promise<{
        events: readonly import('@deepseek-ai/dsh-session').SessionEvent[];
    }>;
    readFrom(id: string, fromSeq: number): Promise<{
        events: import('@deepseek-ai/dsh-session').SessionEvent[];
    }>;
}
export declare class TokenAggregator {
    private readonly persistence;
    private readonly sessions;
    private refreshChain;
    private lastSessionCount;
    constructor(persistence: PersistenceLike);
    /** Serialized refresh: one cold/增量 pass per call, concurrent callers queue. */
    refresh(): Promise<void>;
    private doRefresh;
    private allSamples;
    /** Rolling totals for the panel header (summed over all history). */
    summary(tz: TimezonePolicy): TokenSummary;
    /** Zero-filled day buckets for the requested window (05: 26w default, paged). */
    days(tz: TimezonePolicy, weeks: number, offsetWeeks: number): TokenDayBucket[];
}
//# sourceMappingURL=aggregator.d.ts.map