import type { SnapshotV1 } from '../durable/contracts';
export interface FetchSnapshotOptions {
    weeks?: number;
    offsetWeeks?: number;
    signal?: AbortSignal;
}
export declare function fetchSnapshot(options?: FetchSnapshotOptions): Promise<SnapshotV1>;
//# sourceMappingURL=snapshot.d.ts.map