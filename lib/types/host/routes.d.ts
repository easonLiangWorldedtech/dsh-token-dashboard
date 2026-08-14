import type { Context } from '@deepseek-ai/cordis';
import type { TokenAggregator } from './aggregator.ts';
/**
 * Register the dashboard routes on ctx.webServer.
 * Returns a disposer that removes both routes (wired via ctx.effect).
 */
export declare function registerTokenRoutes(ctx: Context, aggregator: TokenAggregator): () => void;
//# sourceMappingURL=routes.d.ts.map