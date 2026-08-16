import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { SnapshotV1 } from '../../durable/contracts';
export interface SnapshotStatusProps extends PropsLocale<'token-dashboard'> {
    snapshot: SnapshotV1;
}
export declare function SnapshotStatus({ snapshot, t }: SnapshotStatusProps): import("react").JSX.Element | null;
//# sourceMappingURL=SnapshotStatus.d.ts.map