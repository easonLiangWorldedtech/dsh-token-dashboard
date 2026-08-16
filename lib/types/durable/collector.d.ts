import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { type ProjectionBatch } from './contracts';
/** Minimal live Session shape used by the collector. */
export interface SessionLike {
    readonly id: string;
    readonly header: {
        readonly createdAt: number;
        readonly cwd?: string;
    };
}
export interface FlushService {
    flush(session: SessionLike): Promise<boolean>;
}
export interface WorkerProjectService {
    project(batch: ProjectionBatch): Promise<unknown>;
}
export interface TimerLike {
    (callback: () => void, ms?: number): unknown;
}
export interface CollectorOptions {
    readonly generation: string;
    readonly flush: FlushService;
    readonly worker: WorkerProjectService;
    readonly now?: () => number;
    readonly setTimeoutFn?: TimerLike;
    readonly clearTimeoutFn?: (handle: unknown) => void;
    readonly flushRetryDelaysMs?: readonly number[];
    readonly flushCooldownMs?: number;
}
export declare class UsageCollector {
    private readonly generation;
    private readonly flushService;
    private readonly worker;
    private readonly now;
    private readonly setTimeoutFn;
    private readonly clearTimeoutFn;
    private readonly flushRetryDelaysMs;
    private readonly flushCooldownMs;
    private readonly pipelines;
    private accepting;
    constructor(options: CollectorOptions);
    start(): void;
    stop(): void;
    get isAccepting(): boolean;
    /** Number of lifecycles currently flagged resync/degraded. */
    get resyncLifecycleCount(): number;
    /** Synchronous event admission: normalize + enqueue, never I/O. */
    onEvent(session: SessionLike, event: SessionEvent): void;
    /** Explicitly close one lifecycle's open batch and flush it (used by drain/init). */
    flushLifecycle(session: SessionLike): Promise<void>;
    /** Close all open batches and wait for every per-session chain. */
    drain(): Promise<void>;
    private enqueue;
    private armIdleClose;
    private closeBatch;
    private flushAndSend;
    private flushWithRetry;
}
//# sourceMappingURL=collector.d.ts.map