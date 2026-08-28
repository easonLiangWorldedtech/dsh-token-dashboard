import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type TokenKey } from './locales';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'token-dashboard': TokenKey;
    }
}
/** Required client services: the slot registry and the locale dictionary. */
export declare const inject: string[];
/** Mount the sidebar entry and the heatmap panel. */
export declare function apply(ctx: ClientContext): void;
//# sourceMappingURL=index.d.ts.map