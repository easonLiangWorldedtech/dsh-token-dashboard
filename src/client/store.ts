// Module-level stores shared between the sidebar entry and the overlay panel
// (the two slot registrations are separate React roots in the shell tree).
// Both are useSyncExternalStore-compatible.

import type { TimezonePolicy } from '../core/types'

type Listener = () => void

function createStore<T>(initial: T) {
  let state = initial
  const listeners = new Set<Listener>()
  return {
    getSnapshot: () => state,
    subscribe: (listener: Listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(update: (prev: T) => T): void {
      state = update(state)
      for (const listener of listeners) listener()
    },
  }
}

/** Panel visibility, toggled by the sidebar entry and the panel close button. */
export const panelStore = createStore<boolean>(false)
export const togglePanel = (): void => panelStore.set((open) => !open)
export const closePanel = (): void => panelStore.set(() => false)

/** Day-boundary preference (05 decision: local default, UTC overridable). */
const TZ_KEY = 'dsh-token-dashboard.tz'
const readTz = (): TimezonePolicy => {
  try {
    const stored = localStorage.getItem(TZ_KEY)
    return stored === 'utc' ? 'utc' : 'local'
  } catch {
    return 'local'
  }
}
export const tzStore = createStore<TimezonePolicy>(readTz())
export const setTz = (tz: TimezonePolicy): void => {
  tzStore.set(() => tz)
  try { localStorage.setItem(TZ_KEY, tz) } catch { /* storage unavailable — session-only */ }
}