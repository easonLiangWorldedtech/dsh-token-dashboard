import type { ReactNode } from 'react';
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
//# sourceMappingURL=Tip.d.ts.map