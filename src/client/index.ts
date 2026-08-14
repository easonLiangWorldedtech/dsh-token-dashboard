// @apodemakeles/dsh-token-dashboard — browser half.
//
// Planned (ticket 07): a sidebar entry (sidebar.footer.action slot) opening a
// dedicated panel (shell.overlay) that renders the GitHub-style daily/weekly
// total-token heatmap, fed by the host half's /api/token-dashboard/* routes.
//
// Failure policy (convention from the reference plugins): every DOM/runtime
// wiring failure is logged, never thrown — the web shell fails the whole
// boot when a plugin apply throws.
//
// Scaffold stub: no UI is mounted yet.

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'

// Required client services: the slot registry and the locale dictionary.
export const inject = ['slots', 'locale']

// Mount the sidebar entry and heatmap panel (ticket 07).
export function apply(ctx: ClientContext): void {
  void ctx
}
