// Snapshot API client — single fetch for the whole panel payload.
// The old Panel is switched to this in commit 9; this module is safe to
// import before then.

import type { SnapshotV1 } from '../durable/contracts'

export interface FetchSnapshotOptions {
  weeks?: number
  offsetWeeks?: number
  signal?: AbortSignal
}

export async function fetchSnapshot(options: FetchSnapshotOptions = {}): Promise<SnapshotV1> {
  const weeks = options.weeks ?? 26
  const offsetWeeks = options.offsetWeeks ?? 0
  const url = `/api/token-dashboard/snapshot?weeks=${weeks}&offsetWeeks=${offsetWeeks}`
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: options.signal,
  })
  if (!res.ok) {
    let message = 'HTTP ' + res.status
    try {
      const body = await res.json() as { error?: { code?: string; message?: string } }
      if (body.error?.message !== undefined) message = body.error.message
    } catch {
      // Keep the generic HTTP message.
    }
    throw new Error(message)
  }
  const envelope = await res.json() as { ok: true; value: SnapshotV1 } | { ok: false; error: { message: string } }
  if (!envelope.ok) throw new Error(envelope.error.message)
  return envelope.value
}
