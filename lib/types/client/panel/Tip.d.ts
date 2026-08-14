import type { ReactNode } from 'react';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { TokenDayBucket } from '../../core/types';
/** Clamp a viewport point so a TIP_WIDTH x TIP_HEIGHT box stays fully visible. */
export declare function clampTip(x: number, y: number): {
    left: number;
    top: number;
};
export interface TipProps {
    x: number;
    y: number;
    children: ReactNode;
}
export declare function Tip({ x, y, children }: TipProps): import("react").ReactPortal;
/** Tooltip body: date + total, per-model top-3 + others, request count. */
export declare function DayTipContent({ day, t }: {
    day: TokenDayBucket;
} & PropsLocale<'token-dashboard'>): import("react").JSX.Element;
//# sourceMappingURL=Tip.d.ts.map