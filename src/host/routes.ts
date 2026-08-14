// /api/token-dashboard/* route layer: read-only JSON endpoints over the
// shared webServer (research 01, §4). Same envelope shape as the reference
// plugins ({ ok, value | error }). No workspace gate: the dashboard reads
// global session history, not the active project.

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { DashboardEnvelope, TokenDaysPayload, TokenSummary } from '../core/types.ts'
import type { TokenAggregator } from './aggregator.ts'
import type { TimezonePolicy } from './day-buckets.ts'

const DEFAULT_WEEKS = 26
const MAX_WEEKS = 52

function ok<T>(res: ServerResponse, value: T): void {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ ok: true, value } satisfies DashboardEnvelope<T>))
}

function fail(res: ServerResponse, status: number, code: string, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ ok: false, error: { code, message } } satisfies DashboardEnvelope<never>))
}

function queryOf(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? '/', 'http://localhost').searchParams
}

function tzOf(params: URLSearchParams): TimezonePolicy | null {
  const tz = params.get('tz') ?? 'local'
  return tz === 'local' || tz === 'utc' ? tz : null
}

function intOf(params: URLSearchParams, name: string, fallback: number, min: number, max: number): number | null {
  const raw = params.get(name)
  if (raw === null) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) return null
  return value
}

/**
 * Register the dashboard routes on ctx.webServer.
 * Returns a disposer that removes both routes (wired via ctx.effect).
 */
export function registerTokenRoutes(ctx: Context, aggregator: TokenAggregator): () => void {
  const disposeSummary = ctx.webServer.register({
    kind: 'exact',
    path: '/api/token-dashboard/summary',
    handler: async (req, res) => {
      try {
        const params = queryOf(req)
        const tz = tzOf(params)
        if (tz === null) return fail(res, 400, 'bad-query', 'tz must be local or utc')
        await aggregator.refresh()
        ok<TokenSummary>(res, aggregator.summary(tz))
      } catch (error) {
        fail(res, 500, 'internal', error instanceof Error ? error.message : String(error))
      }
    },
  })
  const disposeDays = ctx.webServer.register({
    kind: 'exact',
    path: '/api/token-dashboard/days',
    handler: async (req, res) => {
      try {
        const params = queryOf(req)
        const tz = tzOf(params)
        if (tz === null) return fail(res, 400, 'bad-query', 'tz must be local or utc')
        const weeks = intOf(params, 'weeks', DEFAULT_WEEKS, 1, MAX_WEEKS)
        if (weeks === null) return fail(res, 400, 'bad-query', 'weeks must be an integer in [1, 52]')
        const offsetWeeks = intOf(params, 'offsetWeeks', 0, 0, 10_000)
        if (offsetWeeks === null) return fail(res, 400, 'bad-query', 'offsetWeeks must be a non-negative integer')
        await aggregator.refresh()
        const payload: TokenDaysPayload = { tz, weeks, offsetWeeks, days: aggregator.days(tz, weeks, offsetWeeks) }
        ok<TokenDaysPayload>(res, payload)
      } catch (error) {
        fail(res, 500, 'internal', error instanceof Error ? error.message : String(error))
      }
    },
  })
  return () => {
    disposeDays()
    disposeSummary()
  }
}
