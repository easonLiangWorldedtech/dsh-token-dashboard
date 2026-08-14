// TokenAggregator: the incremental, cached day-aggregation service.
//
// Data path (research 02, §5): the sessionPersistence seam —
// listSnapshots() for cheap revision observation, inspect() for the cold
// fold, readFrom(id, lastSeq + 1) for the incremental tail. No manual fs,
// no zstd, no chunk unpacking — the seam hands us parsed SessionEvents.
//
// Cache policy (02, §7): per-session (revision, lastSeq, fold). A session is
// re-read only when its revision changed; only events past lastSeq are
// re-folded. Kept in memory for the host process lifetime (v1): the cold
// scan is ~0.5s for 15 sessions and refresh is then tail-only.

import type { TokenDayBucket, TokenSummary, UsageSample } from '../core/types'
import { buildBucketMap, buildDays, buildSummary, type TimezonePolicy } from './day-buckets'
import { foldUsage, mergeUsage } from './usage-fold'

/** Minimal structural contract satisfied by ctx.sessionPersistence. */
export interface PersistenceLike {
  listSnapshots(): Promise<Array<{ header: { id: string }; revision: unknown }>>
  inspect(id: string): Promise<{ events: readonly import('@deepseek-ai/dsh-session').SessionEvent[] }>
  readFrom(id: string, fromSeq: number): Promise<{ events: import('@deepseek-ai/dsh-session').SessionEvent[] }>
}

interface SessionCache {
  revision: string
  lastSeq: number
  fold: Map<string, UsageSample>
}

export class TokenAggregator {
  private readonly sessions = new Map<string, SessionCache>()
  private refreshChain: Promise<void> = Promise.resolve()
  private lastSessionCount = 0

  constructor(private readonly persistence: PersistenceLike) {}

  /** Serialized refresh: one cold/增量 pass per call, concurrent callers queue. */
  refresh(): Promise<void> {
    this.refreshChain = this.refreshChain.then(() => this.doRefresh())
    return this.refreshChain
  }

  private async doRefresh(): Promise<void> {
    const snapshots = await this.persistence.listSnapshots()
    this.lastSessionCount = snapshots.length
    const seen = new Set<string>()
    for (const snapshot of snapshots) {
      const id = snapshot.header.id
      seen.add(id)
      const revision = String(snapshot.revision)
      const cached = this.sessions.get(id)
      if (cached !== undefined && cached.revision === revision) continue // unchanged — nothing to fold
      if (cached !== undefined) {
        // Same identity, new revision: fold only the tail past the watermark.
        const tail = await this.persistence.readFrom(id, cached.lastSeq + 1)
        const samples = foldUsage(tail.events)
        mergeUsage(cached.fold, samples)
        const lastSeq = tail.events.reduce((max, event) => Math.max(max, event.seq), cached.lastSeq)
        cached.lastSeq = lastSeq
        cached.revision = revision
      } else {
        // Cold session: inspect the full logical log.
        const inspection = await this.persistence.inspect(id)
        const fold = new Map(foldUsage(inspection.events).map((sample) => [sample.turn + ':' + sample.step, sample]))
        const lastSeq = inspection.events.reduce((max, event) => Math.max(max, event.seq), -1)
        this.sessions.set(id, { revision, lastSeq, fold })
      }
    }
    for (const id of this.sessions.keys()) {
      if (!seen.has(id)) this.sessions.delete(id)
    }
  }

  private allSamples(): UsageSample[] {
    const samples: UsageSample[] = []
    for (const cache of this.sessions.values()) samples.push(...cache.fold.values())
    return samples
  }

  /** Rolling totals for the panel header (summed over all history). */
  summary(tz: TimezonePolicy): TokenSummary {
    const buckets = buildBucketMap(this.allSamples(), tz)
    const totals = buildSummary(buckets, tz)
    return { ...totals, sessionCount: this.lastSessionCount }
  }

  /** Zero-filled day buckets for the requested window (05: 26w default, paged). */
  days(tz: TimezonePolicy, weeks: number, offsetWeeks: number): TokenDayBucket[] {
    return buildDays(this.allSamples(), tz, weeks, offsetWeeks)
  }
}