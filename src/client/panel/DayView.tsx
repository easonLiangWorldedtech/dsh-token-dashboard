// Day view (redesign round 2): bar chart only — last 30 days, today's bar
// highlighted at the right with breathing room (padding + axis labels).
// The per-day list was removed by user decision.

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
  const firstDate = recent.length > 0 ? recent[0].date : ''
  const todayDate = recent.length > 0 ? recent[recent.length - 1].date : ''

  const onMove = (day: TokenDayBucket, event: MouseEvent<HTMLElement>): void => {
    setTip({ day, x: event.clientX, y: event.clientY })
  }

  return (
    <div className="td-daywrap">
      <div className="td-bars">
        {recent.map((day, index) =>
          day.totalTokens <= 0 ? (
            <span className="td-bar empty" key={day.date} />
          ) : (
            <span
              className={index === recent.length - 1 ? 'td-bar today' : 'td-bar'}
              key={day.date}
              style={{ height: max > 0 ? Math.max(3, Math.round((day.totalTokens / max) * 100)) + '%' : '3px' }}
              onMouseMove={(e) => onMove(day, e)}
              onMouseLeave={() => setTip(null)}
            />
          ),
        )}
      </div>
      <div className="td-axis">
        <span>{firstDate}</span>
        <span>{todayDate} · {t('today')}</span>
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