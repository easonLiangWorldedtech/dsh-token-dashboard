// GitHub-style week heatmap (05 Variant A): weeks columns x weekday rows,
// month labels, 5-level color scale relative to the window max, hover
// tooltip with the confirmed breakdown (input+output; cacheRead as note).

import { useMemo, useState } from 'react'
import type { MouseEvent } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TokenDayBucket } from '../../core/types'
import { fmt } from '../fmt'
import { Tip } from './Tip'

interface TooltipState {
  day: TokenDayBucket
  x: number
  y: number
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const CELL = 20
const GAP = 6
const COL_PITCH = CELL + GAP // 26px per column
const WEEKDAY_COL = 36 // 28px weekday + 8px padding-right
const LABEL_GAP = 6 // flex gap between the weekday span and the first cell
const MONTH_LEFT = (col: number): number => WEEKDAY_COL + LABEL_GAP + col * COL_PITCH
const LEVELS = ['var(--td-c1)', 'var(--td-c2)', 'var(--td-c3)', 'var(--td-c4)', 'var(--td-c5)']

function colorOf(total: number, max: number): string {
  if (total <= 0 || max <= 0) return 'var(--td-c0)'
  const r = total / max
  if (r < 0.2) return LEVELS[0]
  if (r < 0.4) return LEVELS[1]
  if (r < 0.65) return LEVELS[2]
  if (r < 0.85) return LEVELS[3]
  return LEVELS[4]
}

export interface HeatmapProps extends PropsLocale<'token-dashboard'> {
  days: readonly TokenDayBucket[]
}

export function Heatmap({ days, t }: HeatmapProps) {
  const [tip, setTip] = useState<TooltipState | null>(null)
  const max = useMemo(() => days.reduce((m, d) => Math.max(m, d.totalTokens), 0), [days])

  // Align: row = weekday of the date (0 = Sunday), column = index within the window.
  const weekdayOf = (date: string): number => new Date(date + 'T00:00:00Z').getUTCDay()
  const rows: Array<Array<TokenDayBucket | null>> = useMemo(() => {
    const table: Array<Array<TokenDayBucket | null>> = [[], [], [], [], [], [], []]
    const first = days.length > 0 ? weekdayOf(days[0].date) : 0
    for (let pad = 0; pad < first; pad++) table[pad].push(null)
    for (const day of days) table[weekdayOf(day.date)].push(day)
    return table
  }, [days])

  // Month labels: one per month present, positioned at its first column.
  const months = useMemo(() => {
    const out: Array<{ label: string; col: number }> = []
    days.forEach((day, index) => {
      const label = day.date.slice(5, 7) + '月'
      const last = out[out.length - 1]
      if (last === undefined || last.label !== label) out.push({ label, col: Math.floor(index / 7) })
    })
    return out
  }, [days])

  const onMove = (day: TokenDayBucket, event: MouseEvent<HTMLElement>): void => {
    setTip({ day, x: event.clientX, y: event.clientY })
  }

  return (
    <div className="td-grid-wrap">
      <div className="td-grid">
      <div className="td-months">
        {months.map((m) => (
          <span key={m.col} style={{ left: MONTH_LEFT(m.col) }}>{m.label}</span>
        ))}
      </div>
      {rows.map((row, weekday) => (
        <div className="td-row" key={weekday}>
          <span className="td-weekday">{WEEKDAYS[weekday]}</span>
          {row.map((day, i) =>
            day === null ? (
              <span className="td-cell" key={'pad-' + i} style={{ background: 'transparent' }} />
            ) : (
              <span
                className="td-cell"
                key={day.date}
                style={{ background: colorOf(day.totalTokens, max) }}
                onMouseMove={(e) => onMove(day, e)}
                onMouseLeave={() => setTip(null)}
              />
            ),
          )}
        </div>
      ))}
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