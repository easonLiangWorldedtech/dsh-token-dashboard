// Sidebar footer entry: the Token trigger beside Settings, rendered into the
// shell-declared sidebar.footer.action seat (01, §2.2). Plain button; the
// panel visibility lives in the module store shared with the overlay panel.

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { togglePanel } from '../store'

export type FooterTokenEntryProps = PropsLocale<'token-dashboard'> & { wide: boolean }

const ICON = (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M8 1.5c1.8 2.2 2.7 4 2.7 6a2.7 2.7 0 1 1-5.4 0c0-2 .9-3.8 2.7-6z" />
    <path d="M2 13.5c1.5-2.4 3.5-3.6 6-3.6s4.5 1.2 6 3.6" />
  </svg>
)

export function FooterTokenEntry({ t, wide }: FooterTokenEntryProps) {
  return (
    <button className="td-entry" onClick={togglePanel} title={t('entryLabel')} aria-label={t('entryLabel')}>
      {ICON}
      {wide && <span>{t('entryLabel')}</span>}
    </button>
  )
}
