#!/usr/bin/env node
// PROTOTYPE — throwaway TUI over the pure state machine.

import { createInterface } from 'node:readline'
import { initialState, invariants, scenarios } from './machine.mjs'

const labels = {
  normal: 'normal write + clean shutdown',
  crashAfterJsonl: 'crash after JSONL, before SQLite',
  crashAfterCommit: 'crash after SQLite commit, before ack',
  initializationRace: 'initial scan + live event race',
  overflowResync: 'hard queue overflow + JSONL resync',
  shutdownTimeout: 'shutdown drain timeout stays dirty',
}

function report(name, state) {
  const checks = invariants(state)
  return {
    scenario: name,
    verdict: checks.every((check) => check.pass) ? 'PASS' : 'FAIL',
    state,
    invariants: checks,
  }
}

function render(name, state) {
  console.clear()
  console.log('\x1b[1mPROTOTYPE — Durable Usage State Machine\x1b[0m')
  console.log(`\x1b[2mScenario: ${labels[name] ?? name}\x1b[0m\n`)
  console.log(JSON.stringify(report(name, state), null, 2))
  console.log('\n\x1b[1mKeys\x1b[0m')
  console.log('[1] normal  [2] JSONL crash  [3] ack crash')
  console.log('[4] init race  [5] overflow  [6] shutdown timeout  [r] reset  [q] quit')
}

if (process.argv.includes('--scenario')) {
  const selected = process.argv[process.argv.indexOf('--scenario') + 1]
  const names = selected === 'all' ? Object.keys(scenarios) : [selected]
  const results = names.map((name) => {
    if (!(name in scenarios)) throw new Error(`unknown scenario: ${name}`)
    return report(name, scenarios[name]())
  })
  console.log(JSON.stringify(results, null, 2))
  process.exitCode = results.every((result) => result.verdict === 'PASS') ? 0 : 1
} else {
  const keys = ['normal', 'crashAfterJsonl', 'crashAfterCommit', 'initializationRace', 'overflowResync', 'shutdownTimeout']
  let currentName = 'reset'
  let state = initialState()
  render(currentName, state)

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  rl.on('line', (line) => {
    const key = line.trim().toLowerCase()
    if (key === 'q') return rl.close()
    if (key === 'r') {
      currentName = 'reset'
      state = initialState()
    } else {
      const index = Number(key) - 1
      if (Number.isInteger(index) && keys[index] !== undefined) {
        currentName = keys[index]
        state = scenarios[currentName]()
      }
    }
    render(currentName, state)
  })
}
