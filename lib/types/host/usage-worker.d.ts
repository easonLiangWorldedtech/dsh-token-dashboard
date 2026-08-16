import { type WorkerCommand } from '../durable/contracts';
/** Minimal parent-port shape so the command loop is testable without threads. */
export interface WorkerPortLike {
    postMessage(value: unknown): void;
}
/**
 * Serialized command dispatcher over a SqliteUsageStore. The Worker thread
 * feeds every incoming command through `handle()`; commands execute one at a
 * time in arrival order.
 */
export declare class UsageWorker {
    private readonly port;
    private readonly defaultDbPath?;
    private store;
    private chain;
    private hostGeneration;
    constructor(port: WorkerPortLike, defaultDbPath?: string | undefined);
    /** Enqueue a command without blocking the caller. */
    handle(command: WorkerCommand): void;
    private dispatch;
    private assertProtocol;
    private reply;
}
/** Entry point used by the actual Worker thread. */
export declare function runUsageWorker(port?: WorkerPortLike, dbPath?: string): UsageWorker;
//# sourceMappingURL=usage-worker.d.ts.map