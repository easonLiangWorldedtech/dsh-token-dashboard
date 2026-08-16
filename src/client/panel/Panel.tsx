// The Token dashboard panel (redesign round 2, per user review):
// - fixed popup geometry (CSS) so week/day switching never resizes it
// - big week/day tabs live in the header (where the old tz toggle was)
// - local timezone only (UTC override removed by user decision)
// - load on open + manual refresh; no polling, no SSE.

import { Component, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotV1 } from '../../durable/contracts'
import { fetchSnapshot } from '../snapshot'
import { fmt } from '../fmt'
import { panelStore, closePanel } from '../store'
import { DayView } from './DayView'
import { Heatmap } from './Heatmap'
import { SnapshotStatus } from './SnapshotStatus'

const WEEKS = 26

type View = 'week' | 'day'

export interface PanelProps extends PropsLocale<'token-dashboard'> {}

/** Contains any render error inside the panel: the slot entry must survive
 *  bad host data instead of unmounting the whole plugin surface. */
class PanelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('dsh-token-dashboard: panel render error', error, info)
  }
  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

const REFRESH_ICON = (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
    <path d="M13.7 1.8v2.9h-2.9" />
  </svg>
)

export function TokenPanel({ t }: PanelProps) {
  const open = useSyncExternalStore(panelStore.subscribe, panelStore.getSnapshot)
  const [view, setView] = useState<View>('week')
  const [offsetWeeks, setOffsetWeeks] = useState(0)
  const [snapshot, setSnapshot] = useState<SnapshotV1 | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    try {
      const next = await fetchSnapshot({ weeks: WEEKS, offsetWeeks, signal: controller.signal })
      if (controller.signal.aborted) return
      setSnapshot(next)
      setRefreshedAt(new Date())
    } catch (cause) {
      if (controller.signal.aborted) return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [offsetWeeks])

  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [open])

  const timeLabel = useMemo(() => {
    if (refreshedAt === null) return ''
    const pad = (n: number): string => String(n).padStart(2, '0')
    return t('refreshedAt') + ' ' + pad(refreshedAt.getHours()) + ':' + pad(refreshedAt.getMinutes())
  }, [refreshedAt, t])

  if (!open) return null

  return (
    <div className="td-panel" role="dialog" aria-label={t('title')}>
      <div className="td-head">
        <h2>{t('title')}</h2>
        <div className="td-tabs">
          <button className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>{t('weekView')}</button>
          <button className={view === 'day' ? 'on' : ''} onClick={() => setView('day')}>{t('dayView')}</button>
        </div>
        <span className="td-spacer" />
        <button className="td-btn" onClick={() => void load()}>{REFRESH_ICON}{t('refresh')}</button>
        <button className="td-iconbtn" onClick={closePanel} aria-label={t('close')}>✕</button>
      </div>

      <div className="td-stats">
        <div className="td-stat"><div className="num">{snapshot === null ? '–' : fmt(snapshot.summary.today)}</div><div className="lbl">{t('today')}</div></div>
        <div className="td-stat"><div className="num">{snapshot === null ? '–' : fmt(snapshot.summary.week)}</div><div className="lbl">{t('week')}</div></div>
        <div className="td-stat"><div className="num">{snapshot === null ? '–' : fmt(snapshot.summary.month30)}</div><div className="lbl">{t('month30')}</div></div>
        <div className="td-stat"><div className="num">{snapshot === null ? '–' : fmt(snapshot.summary.all)}</div><div className="lbl">{t('all')}</div></div>
      </div>

      <div className="td-body">
        <PanelErrorBoundary fallback={<div className="td-status">{t('error', { message: 'render' })}</div>}>
        {view === 'week' && (
          <div className="td-pager">
            <button className="td-btn" onClick={() => setOffsetWeeks((n) => n + WEEKS)}>{t('older')}</button>
            <span className="td-cap">
              {offsetWeeks === 0 ? t('recentWeeks', { n: WEEKS }) : t('rangeWeeks', { n: offsetWeeks })}
            </span>
            <button className="td-btn" disabled={offsetWeeks === 0} onClick={() => setOffsetWeeks((n) => Math.max(0, n - WEEKS))}>{t('newer')}</button>
          </div>
        )}
        <div className="td-body-scroll">
          {loading && <div className="td-status">{t('loading')}</div>}
          {!loading && error !== null && <div className="td-status">{t('error', { message: error })}</div>}
          {!loading && error === null && view === 'week' && <Heatmap days={snapshot?.days ?? []} t={t} />}
          {!loading && error === null && view === 'day' && <DayView days={snapshot?.days ?? []} t={t} />}
        </div>
        </PanelErrorBoundary>
        {snapshot !== null && <SnapshotStatus snapshot={snapshot} t={t} />}
        {view === 'week' && (
          <div className="td-legend">
            <span>{t('legendLess')}</span>
            {['var(--td-c0)', 'var(--td-c1)', 'var(--td-c2)', 'var(--td-c3)', 'var(--td-c4)', 'var(--td-c5)'].map((color) => (
              <span key={color} className="td-cell" style={{ background: color }} />
            ))}
            <span>{t('legendMore')}</span>
          </div>
        )}
      </div>

      <div className="td-foot">
        {snapshot !== null && <span>{t('sessions', { n: snapshot.summary.sessionCount })}</span>}
        {timeLabel !== '' && <span>{timeLabel}</span>}
      </div>
    </div>
  )
}