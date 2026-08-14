// The Token dashboard panel (redesign round 2, per user review):
// - fixed popup geometry (CSS) so week/day switching never resizes it
// - big week/day tabs live in the header (where the old tz toggle was)
// - local timezone only (UTC override removed by user decision)
// - load on open + manual refresh; no polling, no SSE.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TokenDayBucket, TokenSummary } from '../../core/types'
import { fetchDays, fetchSummary } from '../api'
import { fmt } from '../fmt'
import { panelStore, closePanel } from '../store'
import { DayView } from './DayView'
import { Heatmap } from './Heatmap'

const WEEKS = 26
const TZ = 'local'

type View = 'week' | 'day'

export interface PanelProps extends PropsLocale<'token-dashboard'> {}

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
  const [summary, setSummary] = useState<TokenSummary | null>(null)
  const [days, setDays] = useState<TokenDayBucket[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextSummary, nextDays] = await Promise.all([
        fetchSummary(TZ),
        fetchDays(TZ, WEEKS, offsetWeeks),
      ])
      setSummary(nextSummary)
      setDays(nextDays.days)
      setRefreshedAt(new Date())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [offsetWeeks])

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
        <div className="td-stat"><div className="num">{summary === null ? '–' : fmt(summary.today)}</div><div className="lbl">{t('today')}</div></div>
        <div className="td-stat"><div className="num">{summary === null ? '–' : fmt(summary.week)}</div><div className="lbl">{t('week')}</div></div>
        <div className="td-stat"><div className="num">{summary === null ? '–' : fmt(summary.month30)}</div><div className="lbl">{t('month30')}</div></div>
        <div className="td-stat"><div className="num">{summary === null ? '–' : fmt(summary.all)}</div><div className="lbl">{t('all')}</div></div>
      </div>

      <div className="td-body">
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
          {!loading && error === null && view === 'week' && <Heatmap days={days} t={t} />}
          {!loading && error === null && view === 'day' && <DayView days={days} t={t} />}
        </div>
        {view === 'week' && (
          <div className="td-legend">
            <span>{t('legendLess')}</span>
            {['var(--td-c0)', 'var(--td-c1)', 'var(--td-c2)', 'var(--td-c3)', 'var(--td-c4)', 'var(--td-c5)'].map((color) => (
              <span key={color} className="td-cell" style={{ background: color }} />
            ))}
            <span>{t('legendMore')}</span>
            <span style={{ marginLeft: 12 }}>{t('cacheExcluded')}</span>
          </div>
        )}
      </div>

      <div className="td-foot">
        {summary !== null && <span>{t('sessions', { n: summary.sessionCount })}</span>}
        {timeLabel !== '' && <span>{timeLabel}</span>}
        <span>{t('cacheExcluded')}</span>
      </div>
    </div>
  )
}
