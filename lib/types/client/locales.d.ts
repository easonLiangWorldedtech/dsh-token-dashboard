declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        'token-dashboard': TokenKey;
    }
}
export type TokenKey = 'title' | 'today' | 'week' | 'month30' | 'all' | 'weekView' | 'dayView' | 'refresh' | 'refreshedAt' | 'close' | 'older' | 'newer' | 'recentWeeks' | 'rangeWeeks' | 'legendLess' | 'legendMore' | 'hoverTotal' | 'hoverSplit' | 'hoverRequests' | 'hoverCache' | 'cacheExcluded' | 'loading' | 'error' | 'entryLabel' | 'sessions' | 'empty';
export declare const zh: Record<TokenKey, string>;
export declare const en: Record<TokenKey, string>;
//# sourceMappingURL=locales.d.ts.map