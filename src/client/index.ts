// @apodemakeles/dsh-token-dashboard — browser half.
//
// Registers the zh/en dictionaries, injects the scoped stylesheet, and
// contributes two slot entries (01 architecture): the sidebar footer trigger
// (sidebar.footer.action) and the dashboard panel (shell.overlay), both
// declaration-aware via ctx.slots.inject.
//
// Failure policy (reference-plugin convention): every wiring failure is
// logged, never thrown — the web shell fails the whole boot when a plugin
// apply throws.

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.slots merge (the slots service the renderer client row provides).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { en, zh, type TokenKey } from './locales'
import { injectStyles } from './styles'
import { FooterTokenEntry } from './entry/FooterTokenEntry'
import { TokenPanel } from './panel/Panel'

const NS = 'token-dashboard'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'token-dashboard': TokenKey
  }
}

/** Required client services: the slot registry and the locale dictionary. */
export const inject = ['slots', 'locale']

/** Mount the sidebar entry and the heatmap panel. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-token-dashboard: dictionaries')

  ctx.effect(() => {
    injectStyles()
    return () => {
      document.getElementById('dsh-token-dashboard-styles')?.remove()
    }
  }, 'dsh-token-dashboard: stylesheet')

  // Sidebar footer trigger (declaration-aware).
  ctx.slots.inject('sidebar.footer.action', () => {
    let disposeEntry: (() => void) | undefined
    try {
      disposeEntry = ctx.slots.register(
        { name: 'sidebar.footer.action', id: 'token-dashboard', order: 60, locale: NS },
        FooterTokenEntry,
      )
    } catch (error) {
      console.error('dsh-token-dashboard: sidebar entry registration failed', error)
    }
    return () => { disposeEntry?.() }
  })

  // Dashboard panel over the frame (shell.overlay).
  ctx.slots.inject('shell.overlay', () => {
    let disposePanel: (() => void) | undefined
    try {
      disposePanel = ctx.slots.register(
        { name: 'shell.overlay', id: 'token-dashboard', locale: NS },
        TokenPanel,
      )
    } catch (error) {
      console.error('dsh-token-dashboard: panel registration failed', error)
    }
    return () => { disposePanel?.() }
  })
}