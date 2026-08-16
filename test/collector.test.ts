// Commit 5 gate: realtime collector, flush barrier, two-level queues/backpressure.
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionBatch } from '../src/durable/contracts'
import { UsageCollector, type SessionLike } from '../src/durable/collector'

function session(id: string, createdAt = 1000): SessionLike {
  return { id, header: { createdAt, cwd: '/tmp/project' } }
}

function usageMessage(seq: number, turn = 1, step = 1, input = 10, output = 5): SessionEvent {
  return { type: 'assistant/message', seq, time: Date.now(), data: { turn, step, message: {}, usage: { inputTokens: input, outputTokens: output } } } as unknown as SessionEvent
}

function noise(seq: number): SessionEvent {
  return { type: 'turn/start', seq, time: Date.now(), data: { turn: 1 } } as SessionEvent
}

function fakeWorker() {
  const batches: ProjectionBatch[] = []
  let fail = false
  return {
    batches,
    setFail(value: boolean) { fail = value },
    async project(batch: ProjectionBatch) {
      if (fail) throw new Error('worker fail')
      batches.push(batch)
      return { committed: true }
    },
  }
}

function fakeFlush(options: { fail?: boolean; delayMs?: number } = {}) {
  const calls: string[] = []
  return {
    calls,
    async flush(s: SessionLike) {
      calls.push(s.id)
      if (options.fail) throw new Error('flush fail')
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
      return true
    },
  }
}

describe('UsageCollector', () => {
  it('event admission is synchronous and never returns a promise', () => {
    const flush = fakeFlush()
    const worker = fakeWorker()
    const collector = new UsageCollector({ generation: 'g', flush, worker, flushCooldownMs: 0, flushRetryDelaysMs: [0] })
    collector.start()
    const returned = collector.onEvent(session('s1'), usageMessage(0))
    expect(returned).toBeUndefined()
    expect(worker.batches).toHaveLength(0) // no I/O in the callback
  })

  it('keeps same-session batches ordered and sends only minimal deltas', async () => {
    const flush = fakeFlush()
    const worker = fakeWorker()
    const collector = new UsageCollector({ generation: 'g', flush, worker, flushCooldownMs: 0, flushRetryDelaysMs: [0] })
    collector.start()
    const s = session('s1')
    collector.onEvent(s, usageMessage(0, 1, 1))
    collector.onEvent(s, usageMessage(1, 1, 2))
    await collector.drain()
    expect(worker.batches.map((batch) => batch.toSeq)).toEqual([0, 1])
    for (const batch of worker.batches) {
      expect(batch.deltas.every((delta) => delta.kind === 'usage')).toBe(true)
      expect(JSON.stringify(batch.deltas)).not.toContain('message')
    }
  })

  it('does not send to the worker when source flush fails', async () => {
    const flush = fakeFlush({ fail: true })
    const worker = fakeWorker()
    const collector = new UsageCollector({ generation: 'g', flush, worker, flushCooldownMs: 0, flushRetryDelaysMs: [0] })
    collector.start()
    collector.onEvent(session('s1'), usageMessage(0))
    await collector.drain()
    expect(worker.batches).toHaveLength(0)
    expect(collector.resyncLifecycleCount).toBe(1)
  })

  it('isolates a failing session from other sessions', async () => {
    const flush = fakeFlush()
    const worker = fakeWorker()
    const collector = new UsageCollector({ generation: 'g', flush, worker, flushCooldownMs: 0, flushRetryDelaysMs: [0] })
    collector.start()
    // First session will fail flush; second should still send.
    const failing = session('fail')
    const originalFlush = flush.flush.bind(flush)
    flush.flush = async (s) => {
      if (s.id === 'fail') throw new Error('flush fail')
      return originalFlush(s)
    }
    collector.onEvent(failing, usageMessage(0))
    collector.onEvent(session('ok'), usageMessage(0))
    await collector.drain()
    expect(worker.batches.some((batch) => batch.lifecycle.sessionId === 'ok')).toBe(true)
    expect(worker.batches.some((batch) => batch.lifecycle.sessionId === 'fail')).toBe(false)
  })

  it('closes a batch at turn/end even without usage', async () => {
    const flush = fakeFlush()
    const worker = fakeWorker()
    const collector = new UsageCollector({ generation: 'g', flush, worker, flushCooldownMs: 0, flushRetryDelaysMs: [0] })
    collector.start()
    const s = session('s1')
    collector.onEvent(s, noise(0))
    collector.onEvent(s, { type: 'turn/end', seq: 1, time: Date.now(), data: { turn: 1, reason: { kind: 'completed' } } } as SessionEvent)
    await collector.drain()
    expect(worker.batches).toHaveLength(1)
    expect(worker.batches[0]?.toSeq).toBe(1)
    expect(worker.batches[0]?.deltas).toHaveLength(0)
  })
})
