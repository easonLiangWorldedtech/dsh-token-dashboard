import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { TokenDayBucket } from '../../core/types';
export interface DayViewProps extends PropsLocale<'token-dashboard'> {
    days: readonly TokenDayBucket[];
}
export declare function DayView({ days, t }: DayViewProps): import("react").JSX.Element;
//# sourceMappingURL=DayView.d.ts.map