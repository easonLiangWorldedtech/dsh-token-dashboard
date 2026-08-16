// PROTOTYPE — throwaway pure state machine. No filesystem/database access.

export function initialState() {
  return {
    run: { epoch: 0, marker: 'none' },
    projection: { phase: 'initializing', complete: false },
    source: { revision: 0, lastSeq: -1, durableSeq: -1 },
    sqlite: { checkpoint: -1, commitGeneration: 0, facts: {} },
    host: { pending: [], unacked: [], needsResync: false, overflowed: false },
    initialization: { discovered: 0, completed: 0, failed: 0 },
    trace: [],
  }
}

function appendTrace(state, message) {
  return { ...state, trace: [...state.trace, message].slice(-10) }
}

function upsertFact(facts, observation) {
  const current = facts[observation.key]
  if (current !== undefined && current.sourceSeq > observation.seq) return facts
  return { ...facts, [observation.key]: { sourceSeq: observation.seq, tokens: observation.tokens } }
}

export function transition(previous, action) {
  let state = structuredClone(previous)
  switch (action.type) {
    case 'boot': {
      state.run.epoch += 1
      state.run.marker = 'arming'
      state.projection.phase = action.phase ?? 'ready'
      state.projection.complete = state.projection.phase === 'ready'
      return appendTrace(state, `boot epoch ${state.run.epoch} -> arming`)
    }
    case 'activate': {
      state.run.marker = 'active'
      return appendTrace(state, 'revision baseline durable -> active')
    }
    case 'event': {
      state.source.lastSeq = action.seq
      state.host.pending.push({ seq: action.seq, key: action.key, tokens: action.tokens })
      return appendTrace(state, `event seq=${action.seq} queued`)
    }
    case 'sourceFlush': {
      state.source.durableSeq = state.source.lastSeq
      state.source.revision += 1
      return appendTrace(state, `JSONL durable through seq=${state.source.durableSeq}`)
    }
    case 'send': {
      state.host.unacked.push(...state.host.pending)
      state.host.pending = []
      return appendTrace(state, 'source-confirmed batch sent to worker')
    }
    case 'commit': {
      const eligible = state.host.unacked
        .filter((item) => item.seq <= state.source.durableSeq)
        .sort((a, b) => a.seq - b.seq)
      for (const item of eligible) state.sqlite.facts = upsertFact(state.sqlite.facts, item)
      if (eligible.length > 0) {
        state.sqlite.checkpoint = Math.max(state.sqlite.checkpoint, eligible.at(-1).seq)
        state.sqlite.commitGeneration += 1
      }
      return appendTrace(state, `SQLite commit checkpoint=${state.sqlite.checkpoint}`)
    }
    case 'ack': {
      state.host.unacked = state.host.unacked.filter((item) => item.seq > state.sqlite.checkpoint)
      return appendTrace(state, 'commit ack received')
    }
    case 'crash': {
      state.run.marker = state.run.marker === 'clean' ? 'clean' : 'crashed-active'
      state.host.pending = []
      state.host.unacked = []
      state.projection.phase = 'recovering'
      state.projection.complete = false
      return appendTrace(state, 'hard crash: process memory lost')
    }
    case 'restart': {
      state.run.epoch += 1
      state.run.marker = 'arming'
      state.projection.phase = action.cleanPrevious ? 'ready' : 'recovering'
      state.projection.complete = action.cleanPrevious === true
      return appendTrace(state, `restart epoch ${state.run.epoch}`)
    }
    case 'recoverTail': {
      for (let seq = state.sqlite.checkpoint + 1; seq <= state.source.durableSeq; seq += 1) {
        const item = action.events.find((candidate) => candidate.seq === seq)
        if (item === undefined) throw new Error(`prototype recovery gap at seq ${seq}`)
        state.sqlite.facts = upsertFact(state.sqlite.facts, item)
        state.sqlite.checkpoint = seq
      }
      state.sqlite.commitGeneration += 1
      state.host.needsResync = false
      state.host.overflowed = false
      state.projection.phase = 'ready'
      state.projection.complete = true
      return appendTrace(state, `tail recovered through seq=${state.sqlite.checkpoint}`)
    }
    case 'discover': {
      state.initialization.discovered = action.count
      return appendTrace(state, `initialization discovered=${action.count}`)
    }
    case 'bootstrapComplete': {
      state.initialization.completed += 1
      return appendTrace(state, `bootstrap completed=${state.initialization.completed}`)
    }
    case 'readyGate': {
      const ready = state.initialization.discovered === state.initialization.completed
        && state.initialization.failed === 0
        && state.host.pending.length === 0
        && state.host.unacked.length === 0
      state.projection.phase = ready ? 'ready' : 'initializing'
      state.projection.complete = ready
      return appendTrace(state, `ready gate -> ${String(ready)}`)
    }
    case 'overflow': {
      state.host.pending = []
      state.host.overflowed = true
      state.host.needsResync = true
      state.projection.phase = 'degraded'
      state.projection.complete = false
      return appendTrace(state, 'hard queue limit -> resync_required')
    }
    case 'shutdown': {
      const canClean = action.drainSucceeded
        && state.host.pending.length === 0
        && state.host.unacked.length === 0
        && !state.host.needsResync
      state.run.marker = canClean ? 'clean' : 'active'
      return appendTrace(state, `shutdown clean=${String(canClean)}`)
    }
    default:
      throw new Error(`unknown prototype action: ${action.type}`)
  }
}

export function invariants(state) {
  const facts = Object.values(state.sqlite.facts)
  return [
    {
      name: 'SQLite checkpoint never leads durable JSONL',
      pass: state.sqlite.checkpoint <= state.source.durableSeq,
    },
    {
      name: 'Facts are unique by lifecycle/turn/step key',
      pass: facts.length === Object.keys(state.sqlite.facts).length,
    },
    {
      name: 'Every fact sourceSeq is at or below checkpoint',
      pass: facts.every((fact) => fact.sourceSeq <= state.sqlite.checkpoint),
    },
    {
      name: 'Clean has no pending, unacked, or resync work',
      pass: state.run.marker !== 'clean'
        || (state.host.pending.length === 0 && state.host.unacked.length === 0 && !state.host.needsResync),
    },
    {
      name: 'Complete is only published in ready phase',
      pass: !state.projection.complete || state.projection.phase === 'ready',
    },
    {
      name: 'Complete is never published while run is only arming',
      pass: !state.projection.complete || state.run.marker === 'active' || state.run.marker === 'clean',
    },
  ]
}

function apply(state, actions) {
  return actions.reduce(transition, state)
}

const factA = { seq: 0, key: 'life-1:1:1', tokens: 150 }
const factAFinal = { seq: 1, key: 'life-1:1:1', tokens: 160 }

export const scenarios = {
  normal() {
    return apply(initialState(), [
      { type: 'boot' }, { type: 'activate' },
      { type: 'event', ...factA }, { type: 'event', ...factAFinal },
      { type: 'sourceFlush' }, { type: 'send' }, { type: 'commit' }, { type: 'ack' },
      { type: 'shutdown', drainSucceeded: true },
    ])
  },
  crashAfterJsonl() {
    let state = apply(initialState(), [
      { type: 'boot' }, { type: 'activate' }, { type: 'event', ...factA },
      { type: 'sourceFlush' }, { type: 'crash' }, { type: 'restart', cleanPrevious: false }, { type: 'activate' },
    ])
    return transition(state, { type: 'recoverTail', events: [factA] })
  },
  crashAfterCommit() {
    let state = apply(initialState(), [
      { type: 'boot' }, { type: 'activate' }, { type: 'event', ...factA },
      { type: 'sourceFlush' }, { type: 'send' }, { type: 'commit' },
      { type: 'crash' }, { type: 'restart', cleanPrevious: false }, { type: 'activate' },
    ])
    return transition(state, { type: 'recoverTail', events: [factA] })
  },
  initializationRace() {
    return apply(initialState(), [
      { type: 'boot', phase: 'initializing' }, { type: 'activate' }, { type: 'discover', count: 1 },
      { type: 'event', ...factA }, { type: 'event', ...factAFinal }, { type: 'sourceFlush' }, { type: 'send' },
      { type: 'commit' }, { type: 'ack' }, { type: 'bootstrapComplete' }, { type: 'readyGate' },
    ])
  },
  overflowResync() {
    let state = apply(initialState(), [
      { type: 'boot' }, { type: 'activate' }, { type: 'event', ...factA },
      { type: 'sourceFlush' }, { type: 'overflow' },
    ])
    return transition(state, { type: 'recoverTail', events: [factA] })
  },
  shutdownTimeout() {
    return apply(initialState(), [
      { type: 'boot' }, { type: 'activate' }, { type: 'event', ...factA },
      { type: 'sourceFlush' }, { type: 'send' }, { type: 'shutdown', drainSucceeded: false },
    ])
  },
}
