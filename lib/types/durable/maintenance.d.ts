import { DB_APPLICATION_ID, PROJECTION_VERSION, SCHEMA_VERSION } from './contracts';
export interface MaintenanceStatus {
    readonly home: string;
    readonly dir: string;
    readonly canonical: string;
    readonly exists: boolean;
    readonly applicationId: number | null;
    readonly userVersion: number | null;
    readonly projectionVersion: number | null;
    readonly phase: string | null;
    readonly intent: string | null;
    readonly backups: string[];
    readonly rebuilds: string[];
    readonly corrupts: string[];
}
export declare function dshHome(): string;
export declare function tokenDashboardDir(home?: string): string;
export declare function canonicalDbPath(home?: string): string;
export declare function intentPath(home?: string): string;
/** Strict basename validation: exact file name, no separators/glob/absolute. */
export declare function assertSafeBasename(name: string): string;
export interface DatabaseProbe {
    readonly exists: boolean;
    readonly applicationId: number | null;
    readonly userVersion: number | null;
    readonly projectionVersion: number | null;
    readonly phase: string | null;
    readonly quickCheck: string | null;
    readonly error?: string;
}
export declare function probeDatabase(dbPath: string): DatabaseProbe;
export declare class MaintenanceManager {
    private readonly home;
    constructor(home?: string);
    status(): MaintenanceStatus;
    verify(full?: boolean): DatabaseProbe;
    rebuild(): {
        intent: string;
    };
    backups(): string[];
    restore(exactBasename: string, opts?: {
        yes?: boolean;
    }): {
        restored: string;
    };
    cleanup(exactBasename: string, opts?: {
        yes?: boolean;
    }): {
        removed: string;
    };
}
export declare function resolveMaintenanceHome(): string;
export { DB_APPLICATION_ID, PROJECTION_VERSION, SCHEMA_VERSION };
//# sourceMappingURL=maintenance.d.ts.map