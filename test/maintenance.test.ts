// Commit 7 gate: shadow rebuild intent, migration probe and maintenance CLI.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MaintenanceManager,
  assertSafeBasename,
  canonicalDbPath,
  probeDatabase,
  tokenDashboardDir,
} from '../src/durable/maintenance'
import { SqliteUsageStore } from '../src/durable/sqlite-store'

let dir: string
let home: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-token-dashboard-maint-'))
  home = join(dir, 'dsh-home')
  mkdirSync(tokenDashboardDir(home), { recursive: true })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('maintenance path validation', () => {
  it('rejects absolute, separators, glob and dot names', () => {
    expect(() => assertSafeBasename('/tmp/usage-v1.sqlite')).toThrow('unsafe_basename')
    expect(() => assertSafeBasename('../usage-v1.sqlite')).toThrow('unsafe_basename')
    expect(() => assertSafeBasename('usage-*.sqlite')).toThrow('unsafe_basename')
    expect(() => assertSafeBasename('..')).toThrow('unsafe_basename')
    expect(assertSafeBasename('usage-v1.backup-123.sqlite')).toBe('usage-v1.backup-123.sqlite')
  })
})

describe('MaintenanceManager', () => {
  it('probes a real usage database and reports status', () => {
    const manager = new MaintenanceManager(home)
    const dbPath = canonicalDbPath(home)
    const store = new SqliteUsageStore(dbPath)
    store.close()
    const probe = probeDatabase(dbPath)
    expect(probe.exists).toBe(true)
    expect(probe.applicationId).toBe(0x44544f4b)
    expect(probe.userVersion).toBe(1)
    expect(probe.projectionVersion).toBe(1)
    expect(probe.phase).toBe('initializing')
    const status = manager.status()
    expect(status.exists).toBe(true)
    expect(status.dir).toBe(tokenDashboardDir(home))
  })

  it('rebuild writes a durable intent and verify passes quick_check', () => {
    const manager = new MaintenanceManager(home)
    const store = new SqliteUsageStore(canonicalDbPath(home))
    store.close()
    const result = manager.rebuild()
    expect(JSON.parse(result.intent)).toMatchObject({ target: 'usage-v1.sqlite', state: 'intent' })
    expect(existsSync(join(tokenDashboardDir(home), 'rebuild-intent.json'))).toBe(true)
    const verify = manager.verify()
    expect(verify.quickCheck).toBe('ok')
  })

  it('restore requires --yes and then swaps the canonical file', () => {
    const manager = new MaintenanceManager(home)
    const store = new SqliteUsageStore(canonicalDbPath(home))
    store.close()
    const backupName = 'usage-v1.backup-1.sqlite'
    const backupPath = join(tokenDashboardDir(home), backupName)
    writeFileSync(backupPath, 'backup-content')
    expect(() => manager.restore(backupName)).toThrow('confirmation_required')
    manager.restore(backupName, { yes: true })
    expect(existsSync(canonicalDbPath(home))).toBe(true)
    expect(manager.backups().length).toBeGreaterThan(0)
  })

  it('cleanup rejects canonical and unsafe names', () => {
    const manager = new MaintenanceManager(home)
    expect(() => manager.cleanup('usage-v1.sqlite', { yes: true })).toThrow('unsafe_cleanup')
    expect(() => manager.cleanup('../x', { yes: true })).toThrow('unsafe_basename')
  })
})
