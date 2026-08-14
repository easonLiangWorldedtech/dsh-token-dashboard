// Day view (05 Variant A): last-30-days bar chart + per-day list with the
// cache-read note (cacheRead is recorded but never counted into totals).

import { useMemo, useState } from 'react'
import type { MouseEvent } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TokenDayBucket } from '../../core/types'
import { fmt } from '../fmt'
import { Tip } from './Tip'

const DAY_COUNT = 30

export interface DayViewProps extends PropsLocale<'token-dashboard'> {
  days: readonly TokenDayBucket[]
}

export function DayView({ days, t }: DayViewProps) {
  const [tip, setTip] = useState<{ day: TokenDayBucket; x: number; y: number } | null>(null)
  const recent = useMemo(() => days.slice(-DAY_COUNT), [days])
  const max = useMemo(() => recent.reduce((m, d) => Math.max(m, d.totalTokens), 0), [recent])
  const list = useMemo(() => [...recent].reverse(), [recent])

  const onMove = (day: TokenDayBucket, event: MouseEvent<HTMLElement>): void => {
    setTip({ day, x: event.clientX, y: event.clientY })
  }

  return (
    <div className="td-daywrap" style={{ position: 'relative' }}>
      <div className="td-bars">
        {recent.map((day) => (
          <span
            className="td-bar"
            key={day.date}
            style={{ height: max > 0 ? Math.max(2, Math.round((day.totalTokens / max) * 118)) : 2 }}
            onMouseMove={(e) => onMove(day, e)}
            onMouseLeave={() => setTip(null)}
          />
        ))}
      </div>
      <div className="td-status" style={{ padding: '6px 0', textAlign: 'left' }}>{t('dayListTitle')}</div>
      <div className="td-list">
        {list.map((day) => (
          <div className="td-drow" key={day.date}>
            <span className="d">{day.date}</span>
            <span className="bar"><i style={{ width: max > 0 ? Math.round((day.totalTokens / max) * 100) + '%' : 0 }} /></span>
            <span className="v">{fmt(day.totalTokens)}</span>
            <span className="note">{day.cacheReadTokens > 0 ? t('hoverCache', { n: fmt(day.cacheReadTokens) }) : ''}</span>
          </div>
        ))}
        {list.length === 0 && <div className="td-status">{t('empty')}</div>}
      </div>
      {tip !== null && (
        <Tip x={tip.x} y={tip.y}>
          <div className="big">{t('hoverTotal', { date: tip.day.date, total: fmt(tip.day.totalTokens) })}</div>
          <div className="sub">{t('hoverSplit', { input: fmt(tip.day.inputTokens), output: fmt(tip.day.outputTokens) })}</div>
          <div className="sub">{t('hoverRequests', { n: tip.day.requests })}</div>
          {tip.day.cacheReadTokens > 0 && (
            <div className="sub">{t('hoverCache', { n: fmt(tip.day.cacheReadTokens) })}</div>
          )}
        </Tip>
      )}
    </div>
  )
}