import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { ProjectionBatch, LifecycleIdentity } from './contracts';
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
export interface CoordinatorStore {
    getLastRunEpoch(): Promise<{
        epochId: number;
        state: 'arming' | 'active' | 'clean';
        startedAtMs: number;
        cleanAtMs: number | null;
    } | null>;
    beginRunEpoch(startedAtMs?: number): Promise<number>;
    activateRunEpoch(epochId: number, baselines: ReadonlyArray<{
        lifecyclePk: number;
        sourceRevision: string;
    }>): Promise<void>;
    upsertLifecycle(identity: LifecycleIdentity, discoveredAtMs?: number): Promise<number>;
    getLifecycle(identity: LifecycleIdentity): Promise<number | undefined>;
    getCheckpoint(lifecyclePk: number): Promise<{
        lifecyclePk: number;
        lastSeq: number;
        routeProvider: string | null;
        routeModel: string | null;
        bootstrapComplete: boolean;
        sourceRevision: string | null;
    }>;
    getProjectionProgress(): Promise<{
        phase: 'initializing' | 'recovering' | 'ready' | 'degraded' | 'rebuild_required' | 'error';
        discoveredSessions: number;
        completedSessions: number;
        scanningSessions: number;
        retryingSessions: number;
        failedSessions: number;
        startedAtMs: number | null;
        completedAtMs: number | null;
        lastErrorCode: string | null;
        lastErrorMessage: string | null;
    }>;
    updateProjectionProgress(update: Record<string, unknown>, now?: number): Promise<void>;
    setProjectionReady(now?: number): Promise<void>;
    getBaselines(epochId: number): Promise<Array<{
        lifecyclePk: number;
        sourceRevision: string;
    }>>;
    projectBatch(batch: ProjectionBatch, now?: number): Promise<unknown>;
}
/** Async adapter for the Worker client: all SQLite operations stay in the Worker. */
export declare class WorkerCoordinatorStore implements CoordinatorStore {
    private readonly client;
    constructor(client: UsageWorkerClient);
    getLastRunEpoch(): Promise<import("./worker-client").RunEpochInfo | null>;
    beginRunEpoch(startedAtMs?: number): Promise<number>;
    activateRunEpoch(epochId: number, baselines: ReadonlyArray<{
        lifecyclePk: number;
        sourceRevision: string;
    }>): Promise<void>;
    upsertLifecycle(identity: LifecycleIdentity, discoveredAtMs?: number): Promise<number>;
    getLifecycle(identity: LifecycleIdentity): Promise<number | undefined>;
    getCheckpoint(lifecyclePk: number): Promise<import("./worker-client").CheckpointInfo>;
    getProjectionProgress(): Promise<import("./worker-client").ProjectionProgress>;
    updateProjectionProgress(update: Record<string, unknown>, now?: number): Promise<void>;
    setProjectionReady(now?: number): Promise<void>;
    getBaselines(epochId: number): Promise<import("./worker-client").BaselineInfo[]>;
    projectBatch(batch: ProjectionBatch, _now?: number): Promise<{
        committed: boolean;
        checkpoint: number;
        commitGeneration: number;
    }>;
}
/** Async adapter so the coordinator can run against either direct SQLite (tests) or the Worker client. */
export declare class SqliteCoordinatorStore implements CoordinatorStore {
    private readonly store;
    constructor(store: SqliteUsageStore);
    getLastRunEpoch(): Promise<import("./sqlite-store").RunEpochInfo | null>;
    beginRunEpoch(startedAtMs?: number): Promise<number>;
    activateRunEpoch(epochId: number, baselines: ReadonlyArray<{
        lifecyclePk: number;
        sourceRevision: string;
    }>): Promise<void>;
    upsertLifecycle(identity: LifecycleIdentity, discoveredAtMs?: number): Promise<number>;
    getLifecycle(identity: LifecycleIdentity): Promise<number | undefined>;
    getCheckpoint(lifecyclePk: number): Promise<import("./sqlite-store").CheckpointRow>;
    getProjectionProgress(): Promise<import("./sqlite-store").ProjectionProgress>;
    updateProjectionProgress(update: Record<string, unknown>, now?: number): Promise<void>;
    setProjectionReady(now?: number): Promise<void>;
    getBaselines(epochId: number): Promise<{
        lifecyclePk: number;
        sourceRevision: string;
    }[]>;
    projectBatch(batch: ProjectionBatch, now?: number): Promise<{
        committed: boolean;
        checkpoint: number;
        commitGeneration: number;
    }>;
}
export interface InitRecoveryOptions {
    readonly store: CoordinatorStore;
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
    private armed;
    private snapshots;
    private previousState;
    private previousEpochId;
    constructor(options: InitRecoveryOptions);
    get isAborted(): boolean;
    /** Start the coordinator: arm run, activate with baseline, then run scan. */
    start(): Promise<void>;
    /** Arm the run epoch and activate with a revision baseline; no scan yet. */
    arm(): Promise<void>;
    /** Run initialization/recovery/ready transition after arm(). */
    scan(): Promise<void>;
    /** Abort background scan/recovery; committed work is preserved. */
    abort(): void;
    private runInitialization;
    private runRecovery;
    private scanLifecycle;
}
//# sourceMappingURL=init-recovery.d.ts.map