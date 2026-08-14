// Shared API types for the token dashboard — the contract between the host
// aggregation service (src/host) and the browser panel (src/client).
// Imported by both halves; erased at runtime.

/** The four token buckets a provider may report for one model call. */
export interface TokenUsageLike {
  /** Un-cached input tokens (prompt cache miss). */
  inputTokens: number
  /** Output tokens (reasoning included when the provider folds it in). */
  outputTokens: number
  /** Input tokens served from the KV cache (prompt cache hit). */
  cacheReadTokens?: number
  /** Input tokens written to the KV cache (never reported by the local provider). */
  cacheWriteTokens?: number
}

/** Day-boundary policy: machine-local timezone or UTC (05 decision). */
export type TimezonePolicy = 'local' | 'utc'

/** One deduped usage sample: the final usage reported for one (turn, step). */
export interface UsageSample {
  turn: number
  step: number
  /** Event timestamp (epoch ms) — the day bucketing anchor. */
  time: number
  usage: TokenUsageLike
  /** Provider/model of the request that produced this step (from the preceding request events). */
  provider?: string
  model?: string
}

/** Per-model token total within one day bucket (sorted desc by tokens). */
export interface ModelBucket {
  provider: string
  model: string
  tokens: number
}

/** One day of aggregated usage, keyed by date in the requested timezone. */
export interface TokenDayBucket {
  /** YYYY-MM-DD in the requested timezone. */
  date: string
  /** inputTokens + outputTokens + cacheReadTokens (user decision: cache counts). */
  totalTokens: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  requests: number
  /** Per-model totals, most-used first (tooltip top-3 + others). */
  byModel: ModelBucket[]
}

/** Rolling-window totals shown in the panel header. */
export interface TokenSummary {
  today: number
  week: number
  month30: number
  all: number
  cacheReadAll: number
  sessionCount: number
}

/** Payload of GET /api/token-dashboard/days. */
export interface TokenDaysPayload {
  tz: 'local' | 'utc'
  weeks: number
  offsetWeeks: number
  /** Every day of the window (zero-filled), oldest first. */
  days: TokenDayBucket[]
}

/** JSON envelope for every dashboard route (same shape as the reference plugins). */
export type DashboardEnvelope<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }