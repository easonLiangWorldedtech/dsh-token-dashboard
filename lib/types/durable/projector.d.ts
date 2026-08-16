import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { TokenUsageLike } from '../core/types';
import { type ProjectionBatch, type ProjectionState, type UsageDelta } from './contracts';
/** Key for one fact within a lifecycle: `turn:step`. */
export declare function factKey(turn: number, step: number): string;
/** Create an empty projection state (checkpoint -1 = no events processed). */
export declare function createProjectionState(): ProjectionState;
/**
 * Normalize a raw token usage object into the four non-negative buckets.
 * Missing values become 0. Invalid numbers, negative values, non-integer
 * values, or values above Number.MAX_SAFE_INTEGER produce a deterministic
 * ingestion warning instead of a fact.
 */
export declare function normalizeTokenUsage(usage: unknown): {
    usage: TokenUsageLike | null;
    reasonCode?: string;
    detail?: string;
};
/** Extract one minimal delta from a committed SessionEvent, or null. */
export declare function normalizeEventDelta(event: SessionEvent): UsageDelta | null;
/** Normalize a whole contiguous event array into minimal deltas (test helper). */
export declare function normalizeEventDeltas(events: readonly SessionEvent[]): UsageDelta[];
/**
 * Apply a contiguous batch to a projection state.
 *
 * Returns `gap` when the batch does not start at `checkpoint + 1` (or a
 * no-op when it is entirely at/below the checkpoint). Successful application
 * advances `checkpoint` to `batch.toSeq` and commits facts/errors atomically
 * in the returned state.
 */
export declare function projectBatch(state: ProjectionState, batch: Pick<ProjectionBatch, 'fromSeq' | 'toSeq' | 'deltas'>, now?: number): {
    state: ProjectionState;
    status: 'ok' | 'noop' | 'gap';
    reason?: string;
};
/** Convenience for tests: project an array of deltas over an empty state. */
export declare function projectDeltas(deltas: readonly UsageDelta[], fromSeq: number, toSeq: number): ProjectionState;
//# sourceMappingURL=projector.d.ts.map