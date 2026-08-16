import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { SqliteUsageStore } from './sqlite-store';
import type { UsageCollector } from './collector';
import type { UsageWorkerClient } from './worker-client';
/** Minimal persistence seam shape sufficient for init/recovery. */
export interface PersistenceLike {
    listSnapshots(signal?: AbortSignal): Promise<Array<{
        header: {
            id: string;
            createdAt?: number;
            cwd?: string;
        };
        revision: unknown;
    }>>;
    readFrom(id: string, fromSeq: number, signal?: AbortSignal): Promise<{
        meta: {
            id: string;
            createdAt?: number;
            cwd?: string;
        };
        events: SessionEvent[];
    }>;
}
export interface InitRecoveryOptions {
    readonly store: SqliteUsageStore;
    readonly persistence: PersistenceLike;
    readonly collector: UsageCollector;
    readonly worker: UsageWorkerClient;
    readonly generation: string;
    readonly now?: () => number;
    readonly yieldEvery?: number;
    readonly maxRecoveryParallel?: number;
    readonly signal?: AbortSignal;
}
export declare class InitRecoveryCoordinator {
    private readonly store;
    private readonly persistence;
    private readonly collector;
    private readonly worker;
    private readonly generation;
    private readonly now;
    private readonly yieldEvery;
    private readonly maxRecoveryParallel;
    private readonly signal?;
    private aborted;
    private started;
    constructor(options: InitRecoveryOptions);
    get isAborted(): boolean;
    /** Start the coordinator: arm run, activate with baseline, then schedule init/recovery. */
    start(): Promise<void>;
    /** Abort background scan/recovery; committed work is preserved. */
    abort(): void;
    private runInitialization;
    private runRecovery;
    private scanLifecycle;
    private currentEpochId;
}
//# sourceMappingURL=init-recovery.d.ts.map