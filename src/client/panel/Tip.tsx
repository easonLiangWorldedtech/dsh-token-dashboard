// Shared tooltip: portal-ed to document.body with fixed positioning and
// viewport clamping, so it can never be clipped by the panel's scroll
// container (the panel is overflow:auto and transformed).

import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

const MARGIN = 10
const TIP_WIDTH = 240
const TIP_HEIGHT = 110

/** Clamp a viewport point so a TIP_WIDTH x TIP_HEIGHT box stays fully visible. */
export function clampTip(x: number, y: number): { left: number; top: number } {
  let left = x + 12
  if (left + TIP_WIDTH > window.innerWidth - MARGIN) left = x - TIP_WIDTH - 12
  left = Math.max(MARGIN, Math.min(left, window.innerWidth - TIP_WIDTH - MARGIN))
  const top = Math.max(MARGIN, Math.min(y + 10, window.innerHeight - TIP_HEIGHT - MARGIN))
  return { left, top }
}

export interface TipProps {
  x: number
  y: number
  children: ReactNode
}

export function Tip({ x, y, children }: TipProps) {
  const { left, top } = clampTip(x, y)
  return createPortal(
    <div className="td-tip" style={{ left, top }}>
      {children}
    </div>,
    document.body,
  )
}
