// @apodemakeles/dsh-token-dashboard — host half.
//
// Planned (ticket 06): a session-log aggregation service that folds the usage
// events of every session (via the sessionPersistence seam, deduped per
// (turn, step)) into per-day total-token buckets, caches them incrementally
// (revision + lastSeq), and exposes them to the browser half through
// /api/token-dashboard/* routes on the shared webserver.
//
// Scaffold stub: services are declared but no routes are mounted yet.

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-session-persistence'

// Required services: the HTTP route registry and the session-log read seam.
export const inject = ['webServer', 'sessionPersistence']

// Mount the aggregation service and its routes (ticket 06).
export function apply(ctx: Context): void {
  void ctx
}
