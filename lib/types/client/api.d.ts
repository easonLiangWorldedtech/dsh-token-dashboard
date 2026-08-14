import type { TokenDaysPayload, TokenSummary, TimezonePolicy } from '../core/types';
export declare function fetchSummary(tz: TimezonePolicy): Promise<TokenSummary>;
export declare function fetchDays(tz: TimezonePolicy, weeks: number, offsetWeeks: number): Promise<TokenDaysPayload>;
//# sourceMappingURL=api.d.ts.map