import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { UsageSample } from '../core/types';
/**
 * Fold a contiguous event log into one sample per (turn, step), last wins.
 * Returns samples sorted by event time (stable for day bucketing).
 */
export declare function foldUsage(events: readonly SessionEvent[]): UsageSample[];
/** Merge tail samples into an existing fold (incremental refresh). */
export declare function mergeUsage(existing: Map<string, UsageSample>, incoming: readonly UsageSample[]): void;
export declare function stepKey(sample: Pick<UsageSample, 'turn' | 'step'>): string;
//# sourceMappingURL=usage-fold.d.ts.map