# DSH committed-event and lifecycle contract

> Wayfinder research ticket: **DSH 已提交事件与生命周期合同**  
> Evidence cutoff: 2026-08-16. Installed runtime: `@deepseek-ai/dsh@0.1.0-rc.6`, its first-party DSH packages at `0.1.0-rc.6`, `@deepseek-ai/cordis@4.0.1`, and `@deepseek-ai/cordis-plugin-hmr@1.0.16`.

## Decision-ready answer

The durable usage index can use the root-scoped `ctx.on('session/event', ...)` feed, but the callback must do only bounded synchronous work (field tests plus enqueue/postMessage). The event is already committed to the in-memory session log when the callback runs, yet it is **not necessarily durable in `sessionPersistence`**. The event dispatch does not await a returned Promise.

For the proposed asynchronous SQLite index this yields four non-negotiable rules:

1. Register the live listener before the one-time initialization scan. Constructor/resume seed events are not replayed on `session/event`, so historical coverage still requires the accepted one-time `readFrom(id, 0)` scan.
2. Keep one serial queue per session (or one global writer queue with per-session order) and make SQLite facts/checkpoints one transaction. DSH guarantees contiguous session `seq`, but does not serialize this plugin's detached asynchronous listener work.
3. Do not mark a usage checkpoint as source-confirmed merely because its `session/event` arrived. Either establish a `ctx.sessions.flush(session)` durability barrier before committing the corresponding fact/checkpoint, or make abnormal recovery validate the checkpoint against the durable log (including the case where the revision never advanced). Otherwise SQLite can get ahead of the JSONL source during a hard crash.
4. Own listener removal, queue drain, SQLite commit, and the final clean-run marker in **one async `ctx.effect` disposer**, in that explicit order. Cordis awaits an async disposer, but sibling effect disposers may overlap; the DSH launcher also force-exits after a bounded grace period.

The existing `sessionProjectionCache` is useful precedent for watermark/identity/replay rules, not an implementation substrate for this index. It stores whole projection states, writes fail-soft, and is explicitly a cache rather than authority.

## Stable contracts versus current implementation details

| Topic | Stable/public contract in the installed packages | Current implementation detail; do not make it an unqualified cross-version promise |
|---|---|---|
| `session/event` timing | Post-commit fire-and-forget notification. The event is in the append-only in-memory log before observers run; listener failures cannot roll the append back. [`dsh-session/lib/types/index.d.ts:55-66`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts#L55), [`:178-212`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts#L178) | `Session.append()` snapshots the listener list, pushes the event, then invokes callbacks synchronously; returned Promises are only rejection-observed. [`dsh-session/lib/index.js:1451-1478`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js#L1451) |
| Event completeness | `seq` is contiguous (`seq === log length` before append). Seeded/replayed events below `firstLiveSeq` never emit on the live feed. [`dsh-session/lib/types/index.d.ts:124-145`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts#L124), [`:174-176`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/types/index.d.ts#L174) | A root/unscoped listener is admitted for every agent scope; scoped descendants narrow delivery. This follows `dsh-scope`'s current scope carrier rules. [`dsh-scope/README.md:5-16`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-scope/README.md#L5) |
| Persistence suffix read | `readFrom(id, fromSeq)` returns valid **stored** events with `seq >= fromSeq`, without synthetic closers or mutation. A past-end watermark returns an empty list. Seekable stores may read only the suffix; sequential JSONL parses the entire artifact then skips. [`dsh-session-persistence/lib/types/index.d.ts:149-170`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-persistence/lib/types/index.d.ts#L149) | The installed JSONL backend has no seek hook, so coordinator fallback loads the stable whole prefix and slices it. [`dsh-session-persistence/lib/index.js:931-968`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-persistence/lib/index.js#L931) |
| Snapshot revision | `listSnapshots()` returns materialized session headers plus an opaque source-qualified revision; unchanged durable logs compare equal and append/repair changes the next revision. It does not expose a last seq or a global atomic cut. [`dsh-session-persistence/lib/types/index.d.ts:171-187`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-persistence/lib/types/index.d.ts#L171) | JSONL currently derives the string from `dev:ino:size:mtimeNs:ctimeNs`, and listing reads only headers plus `stat`. [`dsh-session-persistence-jsonl/lib/index.js:746-755`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js#L746), [`:1036-1059`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js#L1036) |
| Cordis cleanup | `ctx.effect` may return an async disposer, and fiber disposal awaits cleanup. [`cordis/lib/types/fiber.d.ts:35-51`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/types/fiber.d.ts#L35), [`:145-159`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/lib/types/fiber.d.ts#L145) | The current unload invokes collected disposers in reverse registration order but awaits them together through `Promise.all`, so separate disposers must not encode dependent phases. [`cordis/src/utils.ts:4-31`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/src/utils.ts#L4), [`cordis/src/fiber.ts:675-686`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/src/fiber.ts#L675) |
| Process shutdown | Normal application teardown calls `fiber.dispose()`. | `SIGTERM`/`SIGINT` start root disposal but force exit after 5 seconds; a second signal exits immediately. A fatal unhandled rejection waits at most 2 seconds. [`profile-boot-DG5t9aNs.js:8-69`](/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/profile-boot-DG5t9aNs.js#L8), [`:220-239`](/usr/local/lib/node_modules/@deepseek-ai/dsh/lib/profile-boot-DG5t9aNs.js#L220), [`dsh-app-boot/lib/index.js:1008-1066`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js#L1008) |

## 1. Exact live-event boundary

The public declaration calls `session/event` a "post-commit, fire-and-forget append feed". `Session.append()` first validates and snapshots event data, assigns `seq = log.length`, validates the surface transition, resolves a listener snapshot, pushes into the log, and only then invokes the listeners. Observer throws and rejected Promises are contained and logged. This is strong enough for at-most-microtask enqueueing, but not for synchronous SQLite I/O in the conversation path.

Cordis `emit` is explicitly synchronous and ignores listener return values. [`cordis/src/events.ts:24-32`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/src/events.ts#L24), [`:189-196`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/src/events.ts#L189). An `async` callback therefore executes synchronously until its first `await`, while the returned Promise is not a barrier. The DSH session layer adds per-listener Promise rejection containment, but still does not await completion. [`dsh-session/lib/index.js:1282-1291`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/index.js#L1282).

The usage-bearing vocabulary is stable and sufficient for the accepted `(session lifecycle, turn, step)` fact:

- `assistant/chunk` carries `{turn, step, chunk}`; a usage chunk can preserve accounting for a failed request.
- `assistant/message` carries `{turn, step, message, usage?}` as the successful-step fallback/final sample.
- `request/context` carries provider/model and changes only when route/capacity changes; `request/header.header.config` is the reconstructable request snapshot.

Sources: [`dsh-session/lib/types/types.d.ts:223-280`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts#L223), [`:318-330`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts#L318), and the package's token-accounting rule at [`dsh-session/README.md:69-73`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/README.md#L69).

### Coverage caveat

Resumed/forked constructor seeds do not emit. Registering the listener captures only events appended after the plugin is active. Therefore the initialization sequence must be:

1. install listener and in-memory/worker queue;
2. create the dirty runtime generation;
3. call `listSnapshots()` and scan each durable session with `readFrom(id, 0)`;
4. UPSERT scan and live facts through the same idempotent key;
5. publish `ready` only after the scan cut and all concurrently observed live facts have been accepted.

`readFrom` is preferred over `inspect` for indexing the durable source: `inspect` may return a live in-memory snapshot with an open, not-yet-durable turn and may synthesize cold recovery closers in memory. [`dsh-session-persistence/lib/types/index.d.ts:133-170`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-persistence/lib/types/index.d.ts#L133).

## 2. Durable-log ordering and the "index ahead of source" hazard

The first-party persistence coordinator subscribes to the same event feed and synchronously clones each event into a per-session write-behind controller. The default fixed batching window is 200 ms; actual backend latency is outside that bound. [`dsh-session-persistence/lib/index.js:768-797`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-persistence/lib/index.js#L768), [`:1132-1162`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-persistence/lib/index.js#L1132). `session/flush` is the explicit quiescence barrier, and persistence appends resolve only after durability. [`dsh-session-persistence/README.md:25-36`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-persistence/README.md#L25).

The shipped web profile does load JSONL persistence and the semantic checkpoint policy, but the policy flushes before the next model request, before top-level tool side effects, and at `agent/pre-step`; the loop itself does not await a flush merely because `turn/end` was appended. [`dsh-base/cordis.patch.yml:98-101`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml#L98), [`:354-356`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-base/cordis.patch.yml#L354), [`dsh-session/lib/types/types.d.ts:233-240`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts#L233), [`dsh-session-checkpoint-policy/README.md:5-23`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-checkpoint-policy/README.md#L5).

Consequently, a worker can commit a usage fact after observing `session/event` while the corresponding JSONL event is still buffered. A hard crash in that interval can leave SQLite ahead of the log. The previously discussed recovery shortcut—compare current revision with the run-start baseline and skip unchanged sessions—does **not** detect this case: the durable JSONL revision can remain exactly equal to the baseline while SQLite already advanced.

Two sound designs exist:

### A. Recommended: source-before-index commit

- Listener enqueues facts by session and seq.
- On a final sample/step or turn boundary, a detached, tracked per-session chain awaits `ctx.sessions.flush(session)`.
- Only after that barrier resolves does it send the batch to the SQLite worker.
- The worker transaction UPSERTs facts and advances `last_seq` together.

This does not make `Session.append()` await SQLite or even await the durability barrier; it does add background I/O and means the dashboard may lag until the barrier. Concurrent DSH flush callers join the same persistence barrier, so the shipped checkpoint policy often shares the work. [`dsh-session-persistence/lib/types/write-behind.d.ts:31-44`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-persistence/lib/types/write-behind.d.ts#L31).

### B. Alternative: permit ahead-of-source, then reconcile every touched lifecycle after an unclean run

Persist the set of session lifecycles touched by the run in the same SQLite transaction as the facts. On abnormal recovery, read an anchor at or below the checkpoint for **every touched lifecycle, even when its revision equals the run-start baseline**, prove the durable end, and delete/repair facts beyond it. This is more complex and makes the permanent-token semantics ambiguous when a paid call existed but its DSH log did not survive. It is not recommended for the first design.

With design A, the accepted run-start revision baseline remains useful: after an unclean exit, new sessions and sessions whose durable revision changed are recovery candidates; `readFrom(last_seq + 1)` supplies their missing committed tail. Because JSONL is sequential, this is a logical tail only—physical work still parses the full artifact. That cost is acceptable under the agreed abnormal-exit-only recovery policy.

## 3. Checkpoint and lifecycle identity lessons from `sessionProjectionCache`

The official cache persists per-unit `{ver, seq, val}` rows and treats them as fold shortcuts, never authority. It establishes three rules worth copying:

1. **Log leads cache:** live event persistence is flushed before the checkpoint row lands. [`dsh-session-projection-cache/README.md:7-14`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-projection-cache/README.md#L7).
2. **Lifecycle identity, not id alone:** rows bind to `{createdAt, cwd}` and are rejected if that identity differs. [`dsh-session-projection-cache/lib/types/spec.d.ts:27-59`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-projection-cache/lib/types/spec.d.ts#L27).
3. **One-below restore anchor:** restore reads from one event below the lowest usable watermark so a checkpoint that claims a now-shorter log is detected and falls back to a full read. [`dsh-session-projection/lib/types/index.d.ts:169-219`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-projection/lib/types/index.d.ts#L169).

For the usage schema, `(session_id, turn, step)` should therefore be interpreted as shorthand, not the complete lifecycle-safe key. At minimum persist `session_created_at` and `session_cwd` alongside the session id and include the immutable lifecycle identity in the fact/checkpoint key (or enforce a documented collision policy). Otherwise an out-of-band deleted-and-recreated session id can overwrite permanent historical facts. This is a newly surfaced design decision.

The cache's write-behind is not a reusable durability guarantee for usage facts:

- It checkpoints whole projection records, not per-step facts.
- `apply/view` are required to be synchronous on the event hot path. [`dsh-session-projection/README.md:20-27`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-projection/README.md#L20).
- Cache writes are fail-soft by design; a failure leaves a stale cache. [`dsh-session-projection-cache/lib/index.js:229-266`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-projection-cache/lib/index.js#L229).
- Its cold reads are explicitly not deduplicated. [`dsh-session-projection-cache/README.md:58-62`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-projection-cache/README.md#L58).

The installed web composition configures it at 200 events / 5 seconds plus mandatory `turn/end` and detach triggers. [`dsh-web-app/cordis.patch.yml:76-80`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/cordis.patch.yml#L76), [`dsh-session-projection-cache/lib/index.js:199-227`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-projection-cache/lib/index.js#L199). Those are precedent and current deployment settings, not requirements for the dashboard.

## 4. Clean shutdown, abnormal-run detection, and disposer shape

The accepted `runtime_run.clean_shutdown` protocol is compatible with Cordis if the marker means **"this usage index reached its own quiescent durable point"**, not "the OS delivered a normal signal".

Recommended single-disposer order:

1. atomically set an in-memory `accepting = false` and unregister `session/event`;
2. await all already-created per-session source-flush/index chains;
3. tell the worker to drain and commit its last transaction/checkpoints;
4. in the same final SQLite transaction, mark the run clean;
5. close/terminate the worker and database handle.

If any step throws, times out, or is killed, the marker remains dirty. The next start recovers. Treating an unhandled application failure as clean is still correct when this disposer finishes: the index itself reached durability and needs no tail repair.

Do not split these steps into independent sibling `ctx.effect` registrations. Cordis invokes disposers in reverse registration order but current `Fiber._unload()` awaits them concurrently. A single returned async disposer gives the plugin the required internal sequencing.

Process-level limits define the guarantee boundary:

- First `SIGINT`/`SIGTERM`: root fiber disposal begins; 5-second timeout forces exit.
- Second signal while disposal is pending: immediate forced exit.
- Fatal unhandled rejection: app disposal is attempted, but only a 2-second grace is allowed.
- `kill -9`, power loss, runtime crash, or a wedged drain: no disposer guarantee.

All of these correctly leave `clean_shutdown = 0` unless the index already completed step 4.

## 5. HMR and concurrency boundaries

The dashboard's documented development contract already says host-half changes require rebuilding and restarting `dsh web`; only the browser client bundle is hot-reloaded. [`docs/dev-loop.md:17-35`](../../../docs/dev-loop.md#L17). That should remain the supported first-version rule.

Two current mechanisms matter if this boundary is later widened:

- Loader config updates call `fiber.update()` and await its restart; `Fiber.restart()` unloads then reloads and waits for settlement. [`cordis/src/fiber.ts:712-752`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/src/fiber.ts#L712), [`cordis-plugin-loader/src/config/entry.ts:114-138`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis-plugin-loader/src/config/entry.ts#L114).
- Current module HMR calls `registry.delete(plugin)`, whose implementation starts `fiber.dispose()` without awaiting it, then creates replacement fibers. [`cordis-plugin-hmr/src/index.ts:502-525`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis-plugin-hmr/src/index.ts#L502), [`cordis/src/registry.ts:252-266`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/cordis/src/registry.ts#L252). A second host instance could therefore overlap an old database drain.

If host HMR is ever supported, add a database generation/lease or an in-process singleton handoff and test overlapping old/new instances. Do not infer exclusivity merely from Cordis plugin identity. The JSONL source also documents one live writer per session and no cross-process exclusion. [`dsh-session-persistence-jsonl/README.md:70-77`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/README.md#L70).

Other relevant concurrency limits:

- Persistence coordinator operations are serialized **per session id**, not globally; different sessions may proceed concurrently. [`dsh-session-persistence/lib/types/coordinator.d.ts:180-206`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-session-persistence/lib/types/coordinator.d.ts#L180).
- `listSnapshots()` is lightweight but not a cross-session atomic snapshot. Initialization must tolerate events and revisions moving while enumeration runs; listener-first plus idempotent UPSERT provides that tolerance.
- An unscoped root listener sees descendant agent scopes, including subagents; do not register the collector from one agent-scoped context. [`dsh-scope/README.md:5-16`](/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-scope/README.md#L5).

## 6. Contract for the architecture ticket

The detailed architecture should state the following testable contract:

```text
Live append:
  committed session/event
    -> O(1) classify + enqueue only
    -> per-session ordered source durability barrier
    -> worker batch UPSERT facts + checkpoint in one SQLite transaction

First initialization:
  listener installed first
    -> listSnapshots
    -> readFrom(id, 0) for every durable lifecycle
    -> same UPSERT path
    -> ready only after scan/live cut is accepted

Clean disposal:
  stop admission
    -> await source/index chains
    -> drain worker
    -> mark clean last

Unclean restart:
  compare stored run-start revisions to current listSnapshots
    -> new/changed lifecycles only
    -> readFrom(checkpoint + 1)
    -> UPSERT + advance checkpoint
```

This last shortcut is sound only under the source-before-index rule. If the architecture instead permits SQLite to lead the durable session log, the recovery set must include every lifecycle touched by the dirty run even when its revision is unchanged, and it needs an anchored end-of-log reconciliation.

## Primary-source inventory

Only installed first-party source, generated declarations, package READMEs, and shipped composition files were used:

- `@deepseek-ai/dsh-session@0.1.0-rc.6`
- `@deepseek-ai/dsh-session-persistence@0.1.0-rc.6`
- `@deepseek-ai/dsh-session-persistence-jsonl@0.1.0-rc.6`
- `@deepseek-ai/dsh-session-checkpoint-policy@0.1.0-rc.6`
- `@deepseek-ai/dsh-session-projection@0.1.0-rc.6`
- `@deepseek-ai/dsh-session-projection-cache@0.1.0-rc.6`
- `@deepseek-ai/dsh-scope@0.1.0-rc.6`
- `@deepseek-ai/dsh-app-boot@0.1.0-rc.6`
- `@deepseek-ai/cordis@4.0.1`
- `@deepseek-ai/cordis-plugin-hmr@1.0.16`
- shipped `dsh-base` and `dsh-web-app` profile bundle patches

No third-party commentary was used.
