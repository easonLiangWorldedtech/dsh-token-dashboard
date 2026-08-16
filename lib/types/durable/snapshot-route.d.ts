import type { Context } from '@deepseek-ai/cordis';
import { type SnapshotQuery, type SnapshotV1 } from './contracts';
export interface SnapshotProvider {
    snapshot(query: SnapshotQuery): Promise<SnapshotV1>;
}
export declare function registerSnapshotRoute(ctx: Context, provider: SnapshotProvider): () => void;
//# sourceMappingURL=snapshot-route.d.ts.map