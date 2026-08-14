// @apodemakeles/dsh-token-dashboard — host half.
//
// Mounts the token aggregation service (sessionPersistence seam -> deduped
// usage fold -> per-day buckets, incrementally cached) and serves it to the
// browser half through /api/token-dashboard/* routes on the shared webserver.
// @module @apodemakeles/dsh-token-dashboard

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { TokenAggregator } from './host/aggregator'
import { registerTokenRoutes } from './host/routes'

/** Required services: the HTTP route registry and the session-log read seam. */
export const inject = ['webServer', 'sessionPersistence']

/** Mount the aggregation service and its routes. */
export function apply(ctx: Context): void {
  const aggregator = new TokenAggregator(ctx.sessionPersistence)
  ctx.effect(() => registerTokenRoutes(ctx, aggregator), 'dsh-token-dashboard: /api/token-dashboard routes')
}