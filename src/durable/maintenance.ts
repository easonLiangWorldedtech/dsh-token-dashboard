// Maintenance: database probing, shadow rebuild intent, and the local CLI
// operations. The CLI shares the same ownership probe as the Worker and never
// touches DSH JSONL files.

import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DB_APPLICATION_ID, PROJECTION_VERSION, SCHEMA_VERSION } from './contracts'

export interface MaintenanceStatus {
  readonly home: string
  readonly dir: string
  readonly canonical: string
  readonly exists: boolean
  readonly applicationId: number | null
  readonly userVersion: number | null
  readonly projectionVersion: number | null
  readonly phase: string | null
  readonly intent: string | null
  readonly backups: string[]
  readonly rebuilds: string[]
  readonly corrupts: string[]
}

export function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

export function tokenDashboardDir(home = dshHome()): string {
  return join(home, 'data', 'token-dashboard')
}

export function canonicalDbPath(home = dshHome()): string {
  return join(tokenDashboardDir(home), 'usage-v1.sqlite')
}

export function intentPath(home = dshHome()): string {
  return join(tokenDashboardDir(home), 'rebuild-intent.json')
}

/** Strict basename validation: exact file name, no separators/glob/absolute. */
export function assertSafeBasename(name: string): string {
  if (name.length === 0 || name !== basename(name) || name.includes(sep) || name === '.' || name === '..') {
    throw new Error('unsafe_basename: exact basename required')
  }
  if (/[*?[\]]/.test(name)) throw new Error('unsafe_basename: glob characters are not allowed')
  return name
}

export interface DatabaseProbe {
  readonly exists: boolean
  readonly applicationId: number | null
  readonly userVersion: number | null
  readonly projectionVersion: number | null
  readonly phase: string | null
  readonly quickCheck: string | null
  readonly error?: string
}

export function probeDatabase(dbPath: string): DatabaseProbe {
  if (!existsSync(dbPath)) return { exists: false, applicationId: null, userVersion: null, projectionVersion: null, phase: null, quickCheck: null }
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 1000 })
    try {
      const appId = (db.prepare('PRAGMA application_id').get() as { application_id: number }).application_id
      const userVersion = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
      let projectionVersion: number | null = null
      let phase: string | null = null
      try {
        const row = db.prepare('SELECT projection_version, phase FROM projection_state WHERE singleton_id = 1').get() as { projection_version: number; phase: string } | undefined
        projectionVersion = row?.projection_version ?? null
        phase = row?.phase ?? null
      } catch {
        // Not a usage database.
      }
      const quickCheck = (db.prepare('PRAGMA quick_check').get() as { quick_check: string }).quick_check
      return { exists: true, applicationId: appId, userVersion, projectionVersion, phase, quickCheck }
    } finally {
      db.close()
    }
  } catch (error) {
    return { exists: true, applicationId: null, userVersion: null, projectionVersion: null, phase: null, quickCheck: null, error: error instanceof Error ? error.message : String(error) }
  }
}

function ensureDir(home: string): string {
  const dir = tokenDashboardDir(home)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    chmodSync(dir, 0o700)
  } catch {
    // Best effort; on filesystems that ignore mode this is fine.
  }
  return dir
}

function writeIntent(home: string, payload: unknown): void {
  const dir = ensureDir(home)
  const tmp = join(dir, '.rebuild-intent.tmp-' + randomUUID())
  writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 })
  renameSync(tmp, intentPath(home))
  try {
    chmodSync(intentPath(home), 0o600)
  } catch {
    // Best effort.
  }
}

export class MaintenanceManager {
  constructor(private readonly home = dshHome()) {}

  status(): MaintenanceStatus {
    const dir = tokenDashboardDir(this.home)
    const canonical = canonicalDbPath(this.home)
    const intent = existsSync(intentPath(this.home)) ? readFileSync(intentPath(this.home), 'utf8') : null
    const backups: string[] = []
    const rebuilds: string[] = []
    const corrupts: string[] = []
    if (existsSync(dir)) {
      for (const name of readdirSync(dir)) {
        if (name.startsWith('usage-v1.backup-')) backups.push(name)
        else if (name.startsWith('usage-v1.rebuild-')) rebuilds.push(name)
        else if (name.startsWith('usage-v1.corrupt-')) corrupts.push(name)
      }
    }
    const probe = probeDatabase(canonical)
    return {
      home: this.home,
      dir,
      canonical,
      exists: probe.exists,
      applicationId: probe.applicationId,
      userVersion: probe.userVersion,
      projectionVersion: probe.projectionVersion,
      phase: probe.phase,
      intent,
      backups: backups.sort(),
      rebuilds: rebuilds.sort(),
      corrupts: corrupts.sort(),
    }
  }

  verify(full = false): DatabaseProbe {
    const canonical = canonicalDbPath(this.home)
    const probe = probeDatabase(canonical)
    if (probe.exists && full) {
      // Full integrity_check is deliberately slower and only explicit via CLI.
      const db = new DatabaseSync(canonical, { readOnly: true, timeout: 5000 })
      try {
        return { ...probe, quickCheck: (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check }
      } finally {
        db.close()
      }
    }
    return probe
  }

  rebuild(): { intent: string } {
    const canonical = canonicalDbPath(this.home)
    if (existsSync(canonical)) {
      const probe = probeDatabase(canonical)
      if (probe.userVersion !== null && probe.userVersion > SCHEMA_VERSION) {
        throw new Error('database_too_new: refusing to rebuild a newer database')
      }
      if (probe.applicationId !== null && probe.applicationId !== 0 && probe.applicationId !== DB_APPLICATION_ID) {
        throw new Error('foreign_database: refusing to rebuild a foreign database')
      }
    }
    const intent = {
      version: 1,
      createdAtMs: Date.now(),
      target: 'usage-v1.sqlite',
      shadow: `usage-v1.rebuild-${randomUUID()}.sqlite`,
      state: 'intent',
    }
    writeIntent(this.home, intent)
    return { intent: JSON.stringify(intent) }
  }

  backups(): string[] {
    return this.status().backups
  }

  restore(exactBasename: string, opts: { yes?: boolean } = {}): { restored: string } {
    assertSafeBasename(exactBasename)
    if (opts.yes !== true) throw new Error('confirmation_required: pass --yes after verifying the exact basename')
    const dir = ensureDir(this.home)
    const backupPath = join(dir, exactBasename)
    if (!existsSync(backupPath) || !statSync(backupPath).isFile()) throw new Error('backup_not_found: ' + exactBasename)
    const canonical = canonicalDbPath(this.home)
    const preRestore = join(dir, `usage-v1.backup-${Date.now()}.sqlite`)
    if (existsSync(canonical)) renameSync(canonical, preRestore)
    renameSync(backupPath, canonical)
    try {
      chmodSync(canonical, 0o600)
    } catch {
      // Best effort.
    }
    return { restored: canonical }
  }

  cleanup(exactBasename: string, opts: { yes?: boolean } = {}): { removed: string } {
    assertSafeBasename(exactBasename)
    if (opts.yes !== true) throw new Error('confirmation_required: pass --yes after verifying the exact basename')
    const dir = ensureDir(this.home)
    const target = join(dir, exactBasename)
    if (target === canonicalDbPath(this.home)) throw new Error('unsafe_cleanup: cannot cleanup canonical database')
    if (!existsSync(target) || !statSync(target).isFile()) throw new Error('file_not_found: ' + exactBasename)
    rmSync(target, { force: true })
    return { removed: target }
  }
}

export function resolveMaintenanceHome(): string {
  return dshHome()
}

export { DB_APPLICATION_ID, PROJECTION_VERSION, SCHEMA_VERSION }
