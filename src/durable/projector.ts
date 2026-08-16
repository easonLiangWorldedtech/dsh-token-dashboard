// Pure projection semantics for the durable usage projection.
//
// The host normalizes SessionEvents into minimal deltas; the Worker applies
// those deltas to SQLite. This module contains the pure, DB-free rules that
// both sides share so the route cursor, last-wins fact overwrite, bad-event
// isolation and continuous checkpoint semantics are tested once.

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TokenUsageLike } from '../core/types'
import {
  IngestionCodes,
  type IngestionErrorRecord,
  type ProjectedFact,
  type ProjectionBatch,
  type ProjectionState,
  type UsageDelta,
} from './contracts'

/** Key for one fact within a lifecycle: `turn:step`. */
export function factKey(turn: number, step: number): string {
  return turn + ':' + step
}

/** Create an empty projection state (checkpoint -1 = no events processed). */
export function createProjectionState(): ProjectionState {
  return {
    checkpoint: -1,
    facts: new Map(),
    errors: new Map(),
  }
}

/**
 * Normalize a raw token usage object into the four non-negative buckets.
 * Missing values become 0. Invalid numbers, negative values, non-integer
 * values, or values above Number.MAX_SAFE_INTEGER produce a deterministic
 * ingestion warning instead of a fact.
 */
export function normalizeTokenUsage(usage: unknown): { usage: TokenUsageLike | null; reasonCode?: string; detail?: string } {
  if (usage === null || typeof usage !== 'object') {
    return { usage: null, reasonCode: IngestionCodes.BadTokenValue, detail: 'usage is not an object' }
  }
  const record = usage as Record<string, unknown>
  const buckets: Array<[keyof TokenUsageLike, string]> = [
    ['inputTokens', 'input'],
    ['outputTokens', 'output'],
    ['cacheReadTokens', 'cacheRead'],
    ['cacheWriteTokens', 'cacheWrite'],
  ]
  const normalized: TokenUsageLike = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  for (const [field, label] of buckets) {
    const raw = record[field]
    if (raw === undefined) continue
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
      return { usage: null, reasonCode: IngestionCodes.BadTokenValue, detail: `${label} must be a non-negative safe integer` }
    }
    normalized[field] = raw
  }
  return { usage: normalized }
}

/** Extract one minimal delta from a committed SessionEvent, or null. */
export function normalizeEventDelta(event: SessionEvent): UsageDelta | null {
  if (event.type === 'request/header') {
    const config = event.data.header.config
    return {
      kind: 'route',
      seq: event.seq,
      time: event.time,
      ...(typeof config.provider === 'string' && config.provider.length > 0 ? { provider: config.provider.slice(0, 256) } : {}),
      ...(typeof config.model === 'string' && config.model.length > 0 ? { model: config.model.slice(0, 256) } : {}),
    } satisfies UsageDelta
  }
  if (event.type === 'request/context') {
    return {
      kind: 'route',
      seq: event.seq,
      time: event.time,
      ...(typeof event.data.provider === 'string' && event.data.provider.length > 0 ? { provider: event.data.provider.slice(0, 256) } : {}),
      ...(typeof event.data.model === 'string' && event.data.model.length > 0 ? { model: event.data.model.slice(0, 256) } : {}),
    } satisfies UsageDelta
  }
  if (event.type === 'assistant/message') {
    if (event.data.usage === undefined) return null
    return {
      kind: 'usage',
      seq: event.seq,
      time: event.time,
      turn: event.data.turn,
      step: event.data.step,
      usage: event.data.usage as TokenUsageLike,
      final: true,
    }
  }
  if (event.type === 'assistant/chunk') {
    const chunk = event.data.chunk
    if (chunk.type !== 'usage') return null
    return {
      kind: 'usage',
      seq: event.seq,
      time: event.time,
      turn: event.data.turn,
      step: event.data.step,
      usage: chunk.usage as TokenUsageLike,
      final: false,
    }
  }
  return null
}

/** Normalize a whole contiguous event array into minimal deltas (test helper). */
export function normalizeEventDeltas(events: readonly SessionEvent[]): UsageDelta[] {
  const out: UsageDelta[] = []
  for (const event of events) {
    const delta = normalizeEventDelta(event)
    if (delta !== null) out.push(delta)
  }
  return out
}

/**
 * Apply a contiguous batch to a projection state.
 *
 * Returns `gap` when the batch does not start at `checkpoint + 1` (or a
 * no-op when it is entirely at/below the checkpoint). Successful application
 * advances `checkpoint` to `batch.toSeq` and commits facts/errors atomically
 * in the returned state.
 */
export function projectBatch(
  state: ProjectionState,
  batch: Pick<ProjectionBatch, 'fromSeq' | 'toSeq' | 'deltas'>,
  now = Date.now(),
): { state: ProjectionState; status: 'ok' | 'noop' | 'gap'; reason?: string } {
  if (batch.fromSeq > state.checkpoint + 1) {
    return { state, status: 'gap', reason: `expected ${state.checkpoint + 1}, got ${batch.fromSeq}` }
  }
  if (batch.toSeq <= state.checkpoint) {
    return { state, status: 'noop' }
  }

  const startSeq = state.checkpoint + 1
  const facts = new Map(state.facts)
  const errors = new Map(state.errors)
  let routeProvider = state.routeProvider
  let routeModel = state.routeModel

  for (const delta of batch.deltas) {
    if (delta.seq < startSeq || delta.seq > batch.toSeq) continue
    if (delta.kind === 'route') {
      if (delta.provider !== undefined) routeProvider = delta.provider
      if (delta.model !== undefined) routeModel = delta.model
      continue
    }
    // usage delta
    if (!Number.isSafeInteger(delta.turn) || delta.turn < 0 || !Number.isSafeInteger(delta.step) || delta.step < 0) {
      errors.set(delta.seq, {
        sourceSeq: delta.seq,
        eventType: delta.final ? 'assistant/message' : 'assistant/chunk',
        reasonCode: IngestionCodes.MissingTurnStep,
        detail: 'usage event must carry non-negative turn and step',
        firstSeenAtMs: now,
      })
      continue
    }
    const normalized = normalizeTokenUsage(delta.usage)
    if (normalized.usage === null) {
      errors.set(delta.seq, {
        sourceSeq: delta.seq,
        eventType: delta.final ? 'assistant/message' : 'assistant/chunk',
        reasonCode: normalized.reasonCode ?? IngestionCodes.BadTokenValue,
        detail: normalized.detail ?? 'invalid token buckets',
        firstSeenAtMs: now,
      })
      continue
    }
    const key = factKey(delta.turn, delta.step)
    const existing = facts.get(key)
    if (existing !== undefined && existing.sourceSeq > delta.seq) continue
    const fact: ProjectedFact = {
      turn: delta.turn,
      step: delta.step,
      sourceSeq: delta.seq,
      occurredAtMs: delta.time,
      provider: routeProvider,
      model: routeModel,
      inputTokens: normalized.usage.inputTokens,
      outputTokens: normalized.usage.outputTokens,
      cacheReadTokens: normalized.usage.cacheReadTokens ?? 0,
      cacheWriteTokens: normalized.usage.cacheWriteTokens ?? 0,
    }
    facts.set(key, fact)
  }

  return {
    state: {
      checkpoint: batch.toSeq,
      routeProvider,
      routeModel,
      facts,
      errors,
    },
    status: 'ok',
  }
}

/** Convenience for tests: project an array of deltas over an empty state. */
export function projectDeltas(deltas: readonly UsageDelta[], fromSeq: number, toSeq: number): ProjectionState {
  return projectBatch(createProjectionState(), { fromSeq, toSeq, deltas }).state
}
