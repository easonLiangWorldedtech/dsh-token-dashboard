// Same-origin fetches against the host half's dashboard routes (01, §4/§5:
// one shared webserver, no CORS). Returns parsed envelopes or throws with a
// readable message for the panel's error state.

import type { DashboardEnvelope, TokenDaysPayload, TokenSummary, TimezonePolicy } from '../core/types'

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(path, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

function unwrap<T>(raw: unknown): T {
  const envelope = raw as DashboardEnvelope<T>
  if (envelope.ok) return envelope.value
  throw new Error(envelope.error.message)
}

export async function fetchSummary(tz: TimezonePolicy): Promise<TokenSummary> {
  return unwrap<TokenSummary>(await getJson('/api/token-dashboard/summary?tz=' + tz))
}

export async function fetchDays(tz: TimezonePolicy, weeks: number, offsetWeeks: number): Promise<TokenDaysPayload> {
  return unwrap<TokenDaysPayload>(
    await getJson('/api/token-dashboard/days?tz=' + tz + '&weeks=' + weeks + '&offsetWeeks=' + offsetWeeks),
  )
}
