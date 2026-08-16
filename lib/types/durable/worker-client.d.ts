import { type ProjectionBatch, type SnapshotQuery, type SnapshotV1 } from './contracts';
/** Minimal Worker-like surface used by tests. */
export interface WorkerLike {
    postMessage(value: unknown): void;
    on(event: 'message' | 'error' | 'exit', listener: (...args: any[]) => void): unknown;
    terminate(): Promise<unknown>;
}
export interface WorkerClientOptions {
    readonly generation: string;
    readonly dbPath: string;
    readonly workerFactory?: () => WorkerLike;
    readonly restartDelaysMs?: readonly number[];
}
export declare class UsageWorkerClient {
    private readonly generation;
    private readonly dbPath;
    private readonly workerFactory;
    private readonly restartDelaysMs;
    private worker;
    private readonly pending;
    private readonly unacked;
    private startPromise;
    private circuitOpen;
    private intentionalExit;
    private restartCount;
    private requestCounter;
    constructor(options: WorkerClientOptions);
    get pendingBatchCount(): number;
    get isCircuitOpen(): boolean;
    /** Start (or restart) the Worker and wait for init ack. */
    start(): Promise<void>;
    private spawnAndInit;
    /** Send a projection batch and await commit ack. */
    project(batch: ProjectionBatch): Promise<{
        committed: boolean;
        checkpoint: number;
        commitGeneration: number;
    }>;
    /** Query a consistent snapshot. */
    snapshot(query: SnapshotQuery): Promise<SnapshotV1>;
    /** Barrier: all previously sent commands have committed. */
    drain(): Promise<{
        commitGeneration: number;
        stateGeneration: number;
    }>;
    /** Stop admission, flush commands, close DB and terminate the Worker. */
    shutdown(): Promise<void>;
    private attach;
    private onMessage;
    private onUnexpectedExit;
    private request;
    private nextRequestId;
}
export declare class WorkerRpcError extends Error {
    readonly code: string;
    readonly retryable: boolean;
    constructor(code: string, message: string, retryable: boolean);
}
//# sourceMappingURL=worker-client.d.ts.map