// Sidebar footer entry: the usage trigger beside Settings, rendered into the
// shell-declared sidebar.footer.action seat (01, §2.2). Text button per user
// decision (round 3): lowercase "usage", quiet but refined.

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { togglePanel } from '../store'

export type FooterTokenEntryProps = PropsLocale<'token-dashboard'> & { wide: boolean }

export function FooterTokenEntry({ t, wide }: FooterTokenEntryProps) {
  return (
    <button className="td-entry" onClick={togglePanel} title={t('entryLabel')} aria-label={t('entryLabel')}>
      <span className="td-entry-label">{t('entryLabel')}</span>
      {wide && <span className="td-entry-chevron">↗</span>}
    </button>
  )
}
