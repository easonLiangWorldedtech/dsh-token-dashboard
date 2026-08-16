#!/usr/bin/env node
// dsh-token-dashboard — local maintenance CLI.
// Read commands are safe; mutation commands require exact basenames and --yes.

import { MaintenanceManager } from './durable/maintenance'

function print(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n')
}

function fail(message: string, code = 1): never {
  process.stderr.write(message + '\n')
  process.exit(code)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]
  const manager = new MaintenanceManager()
  switch (command) {
    case 'status':
      print(manager.status())
      return
    case 'verify':
      print(manager.verify(args.includes('--full')))
      return
    case 'rebuild':
      print(manager.rebuild())
      return
    case 'backups':
      print(manager.backups())
      return
    case 'restore': {
      const name = args[1]
      if (name === undefined) fail('usage: dsh-token-dashboard restore <exact-basename> [--yes]')
      print(manager.restore(name, { yes: args.includes('--yes') }))
      return
    }
    case 'cleanup': {
      const name = args[1]
      if (name === undefined) fail('usage: dsh-token-dashboard cleanup <exact-basename> [--yes]')
      print(manager.cleanup(name, { yes: args.includes('--yes') }))
      return
    }
    default:
      fail('unknown command: ' + (command ?? '(none)'))
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error))
})
