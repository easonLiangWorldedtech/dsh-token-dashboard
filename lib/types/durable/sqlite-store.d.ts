import type { LifecycleIdentity, ProjectionBatch, SnapshotV1, StoredProjectionPhase } from './contracts';
export interface ProjectionProgress {
    phase: StoredProjectionPhase;
    discoveredSessions: number;
    completedSessions: number;
    scanningSessions: number;
    retryingSessions: number;
    failedSessions: number;
    startedAtMs: number | null;
    completedAtMs: number | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
}
export interface RunEpochInfo {
    epochId: number;
    state: 'arming' | 'active' | 'clean';
    startedAtMs: number;
    cleanAtMs: number | null;
}
export interface CheckpointRow {
    lifecyclePk: number;
    lastSeq: number;
    routeProvider: string | null;
    routeModel: string | null;
    bootstrapComplete: boolean;
    sourceRevision: string | null;
}
export declare class ProjectionGapError extends Error {
    constructor(message: string);
}
export declare class ProjectionTooNewError extends Error {
    constructor(message: string);
}
export declare class ForeignDatabaseError extends Error {
    constructor(message: string);
}
export declare class DatabaseInUseError extends Error {
    constructor(message: string);
}
export declare class SqliteUsageStore {
    private readonly db;
    private commitGeneration;
    private stateGeneration;
    private closed;
    constructor(dbPath: string, options?: {
        readonly createIfMissing?: boolean;
        readonly readOnly?: boolean;
    });
    private probe;
    private txDepth;
    /** Run a function inside an immediate transaction; rolls back on throw. */
    transaction<T>(fn: () => T): T;
    close(): void;
    get isClosed(): boolean;
    get commitGenerationValue(): number;
    get stateGenerationValue(): number;
    private bumpState;
    private bumpCommit;
    upsertLifecycle(identity: LifecycleIdentity, discoveredAtMs?: number): number;
    getLifecycle(identity: LifecycleIdentity): number | undefined;
    getCheckpoint(lifecyclePk: number): CheckpointRow;
    /** Project one source-confirmed batch; facts/errors/checkpoint are atomic. */
    projectBatch(batch: ProjectionBatch, now?: number): {
        committed: boolean;
        checkpoint: number;
        commitGeneration: number;
    };
    beginRunEpoch(startedAtMs?: number): number;
    activateRunEpoch(epochId: number, baselines: ReadonlyArray<{
        lifecyclePk: number;
        sourceRevision: string;
    }>, now?: number): void;
    markRunClean(epochId: number, cleanAtMs?: number): void;
    getLastRunEpoch(): RunEpochInfo | undefined;
    getBaselines(epochId: number): Array<{
        lifecyclePk: number;
        sourceRevision: string;
    }>;
    getProjectionProgress(): ProjectionProgress;
    updateProjectionProgress(update: Partial<Omit<ProjectionProgress, 'phase'>> & {
        phase?: StoredProjectionPhase;
    }, now?: number): void;
    setProjectionReady(now?: number): void;
    private warnings;
    snapshot(query: {
        weeks: number;
        offsetWeeks: number;
    }, pendingBatches: number, now?: number): SnapshotV1;
}
//# sourceMappingURL=sqlite-store.d.ts.map