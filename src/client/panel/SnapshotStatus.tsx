// Snapshot status strip: phase/progress/warnings for the not-yet-complete
// projection. Rendered by the new Panel after commit 9; currently standalone.

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotV1 } from '../../durable/contracts'

export interface SnapshotStatusProps extends PropsLocale<'token-dashboard'> {
  snapshot: SnapshotV1
}

export function SnapshotStatus({ snapshot, t }: SnapshotStatusProps) {
  const { projection } = snapshot
  if (projection.complete && projection.phase === 'ready' && snapshot.warnings.count === 0) return null
  const phaseKey = projection.phase === 'initializing'
    ? 'initializing'
    : projection.phase === 'recovering'
      ? 'recovering'
      : 'degraded'
  return (
    <div className="td-status-line" role="status">
      <span>{t(phaseKey)}</span>
      {projection.pendingBatches > 0 && <span>{t('pending', { n: projection.pendingBatches })}</span>}
      {snapshot.warnings.count > 0 && <span>{t('warnings', { n: snapshot.warnings.count })}</span>}
    </div>
  )
}
