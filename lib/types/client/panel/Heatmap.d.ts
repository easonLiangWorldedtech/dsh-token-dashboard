import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { TokenDayBucket } from '../../core/types';
export interface HeatmapProps extends PropsLocale<'token-dashboard'> {
    days: readonly TokenDayBucket[];
}
export declare function Heatmap({ days, t }: HeatmapProps): import("react").JSX.Element;
//# sourceMappingURL=Heatmap.d.ts.map