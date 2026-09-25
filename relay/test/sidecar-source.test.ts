import { afterEach, describe, expect, test } from 'bun:test'
import { fsyncSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConsumerBroker } from '../src/consumer-broker'
import { EventInterpreter } from '../src/interpreter'
import { SidecarSourceEngine } from '../src/sidecar-source'
import { SidecarStorageLimitError, SidecarStore } from '../src/sidecar-store'
import { SourceContinuityJournal, readContinuityEvidence, type ContinuityKind } from '../src/source-continuity'

class FaultJournal extends SourceContinuityJournal {
  failOn?: ContinuityKind
  override record(kind: ContinuityKind) {
    if (this.failOn === kind) { this.failOn = undefined; throw new Error('synthetic_write_failure') }
    super.record(kind)
  }
}

const stores: SidecarStore[] = []
async function setup(client: any, sleep: (ms: number, signal: AbortSignal) => Promise<void> = async () => { throw new DOMException('aborted', 'AbortError') }, targetKinds: Array<'mac' | 'ntfy'> = ['mac', 'ntfy']) { const root = await mkdtemp(join(tmpdir(), 'source-')); const dir = join(root, 'state'); await mkdir(dir, { mode: 0o700 }); const store = new SidecarStore(join(dir, 'db')); stores.push(store); store.bindSource('https://hapi.example', 'ns'); const credential = store.createConsumer('mac'); const broker = new ConsumerBroker(store); const interpreter = new EventInterpreter('https://hapi.example', 'ns', () => 20_000); return { store, credential, interpreter, engine: new SidecarSourceEngine(store, interpreter, broker, client, sleep, () => {}, targetKinds) } }
afterEach(() => { while (stores.length) stores.pop()!.close() })

describe('SidecarSourceEngine', () => {
  test.each(['connected-ok', 'disconnect'] as const)('fails closed and releases the iterator when %s cannot be recorded', async kind => {
    let release!: () => void, returned = 0, streamSignal: AbortSignal | undefined, flushed = 0
    const gate = new Promise<void>(resolve => { release = resolve })
    const client = {
      catalog: async () => [], session: async () => { throw new Error('unexpected detail') }, messages: async () => { throw new Error('unexpected messages') },
      events: async function* (_cursor: unknown, signal: AbortSignal) {
        streamSignal = signal
        try { yield { type: 'connected', connected: { resume: 'ok' } }; await gate }
        finally { returned++ }
      }
    }
    const { store, interpreter } = await setup(client)
    const journal = new FaultJournal(join(store.path, '..', `continuity-${kind}.journal`))
    journal.failOn = kind
    const engine = new SidecarSourceEngine(store, interpreter, new ConsumerBroker(store), client as any, undefined, () => {}, [], journal)
    const actualFlush = (engine as any).flushPendingCursor.bind(engine)
    ;(engine as any).flushPendingCursor = async () => { flushed++; await actualFlush() }
    engine.start()
    if (kind === 'disconnect') {
      for (let i = 0; i < 30 && !engine.isLive(); i++) await Bun.sleep(5)
      expect(engine.isLive()).toBeTrue()
      release()
    }
    for (let i = 0; i < 30 && (store.sourceStatus().attentionCode !== 'continuity_write_failed' || !returned || !flushed); i++) await Bun.sleep(5)
    expect(store.sourceStatus()).toMatchObject({ state: 'attention', attentionCode: 'continuity_write_failed' })
    expect(streamSignal?.aborted).toBeTrue()
    expect(returned).toBe(1)
    expect(flushed).toBe(1)
    expect((engine as any).continuityTimer).toBeUndefined()
    expect(() => engine.start()).toThrow('continuity_failed')
    release(); await engine.stop()
  })
  test('a stop-marker write failure cannot interrupt source cleanup', async () => {
    const client = {
      catalog: async () => [], session: async () => { throw new Error('unexpected detail') }, messages: async () => { throw new Error('unexpected messages') },
      events: async function* (_cursor: unknown, signal: AbortSignal) {
        yield { type: 'connected', connected: { resume: 'ok' } }
        await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
      }
    }
    const { store, interpreter } = await setup(client)
    const journal = new FaultJournal(join(store.path, '..', 'continuity-stop.journal'))
    const engine = new SidecarSourceEngine(store, interpreter, new ConsumerBroker(store), client as any, undefined, () => {}, [], journal)
    engine.start()
    for (let i = 0; i < 30 && !engine.isLive(); i++) await Bun.sleep(5)
    expect(engine.isLive()).toBeTrue()
    journal.failOn = 'stop'
    await engine.stop()
    expect(store.sourceStatus()).toMatchObject({ state: 'attention', attentionCode: 'continuity_write_failed' })
    expect((engine as any).continuityTimer).toBeUndefined()
    expect(() => journal.record('heartbeat')).toThrow('continuity_closed_or_invalid')
  })
  test('does not claim live when both journal and attention-store writes fail', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const client = {
      catalog: async () => [], session: async () => { throw new Error('unexpected detail') }, messages: async () => { throw new Error('unexpected messages') },
      events: async function* () { yield { type: 'connected', connected: { resume: 'ok' } }; await gate }
    }
    const { store, interpreter } = await setup(client)
    const journal = new FaultJournal(join(store.path, '..', 'continuity-double-failure.journal'))
    const engine = new SidecarSourceEngine(store, interpreter, new ConsumerBroker(store), client as any, undefined, () => {}, [], journal)
    engine.start()
    for (let i = 0; i < 30 && !engine.isLive(); i++) await Bun.sleep(5)
    expect(engine.isLive()).toBeTrue()
    const original = store.sourceHealth.bind(store)
    store.sourceHealth = ((state: any, code?: string) => {
      if (state === 'attention') throw new Error('synthetic_store_failure')
      return original(state, code)
    }) as typeof store.sourceHealth
    journal.failOn = 'disconnect'; release()
    for (let i = 0; i < 30 && !(engine as any).continuityFailed; i++) await Bun.sleep(5)
    expect(store.sourceStatus().state).toBe('live')
    expect(engine.isLive()).toBeFalse()
    expect((engine as any).continuityTimer).toBeUndefined()
    await expect(engine.activateDelivery(async () => {})).rejects.toThrow('official_source_not_live')
    store.sourceHealth = original
    await engine.stop()
  })
  test('a failed heartbeat sync aborts before queued events can commit or deliver', async () => {
    let releaseDetail!: () => void, detailStarted = false, failSync = false
    const detailGate = new Promise<void>(resolve => { releaseDetail = resolve })
    const client = {
      catalog: async () => [],
      session: async () => { detailStarted = true; await detailGate; return { id: 's1', active: true, updatedAt: 2, metadata: { name: 'Synthetic' } } },
      messages: async () => { throw new Error('unexpected messages') },
      events: async function* (_cursor: unknown, signal: AbortSignal) {
        yield { type: 'connected', connected: { resume: 'gap' } }
        yield { type: 'event', frame: { id: 'event:added', event: { type: 'session-added', sessionId: 's1', data: { id: 's1', metadata: { name: 42 } } } } }
        yield { type: 'event', frame: { id: 'event:removed', event: { type: 'session-removed', sessionId: 's1' } } }
        await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
      }
    }
    const { store, interpreter, credential } = await setup(client)
    const path = join(store.path, '..', 'continuity-queued.journal')
    const journal = new SourceContinuityJournal(path, () => Date.now(), fd => { if (failSync) throw new Error('synthetic_fsync_failure'); fsyncSync(fd) })
    const engine = new SidecarSourceEngine(store, interpreter, new ConsumerBroker(store), client as any, undefined, () => {}, ['mac'], journal)
    engine.start()
    for (let i = 0; i < 30 && !detailStarted; i++) await Bun.sleep(5)
    expect(detailStarted).toBeTrue()
    failSync = true
    expect(() => (engine as any).recordContinuity('heartbeat')).toThrow('continuity_write_failed')
    releaseDetail()
    await engine.stop()
    expect(store.sourceCursor()).toBeUndefined()
    expect(store.catalog().sessions).toHaveLength(0)
    expect(store.pending(credential.consumerId)).toHaveLength(0)
    expect(engine.isLive()).toBeFalse()
    expect(readContinuityEvidence(`${path}.sealed`, 1, Date.now())).toBeUndefined()
  })
  test('records authoritative connected/gap/live transitions for a post-baseline canary window', async () => {
    const client = {
      catalog: async () => [], session: async () => { throw new Error('unexpected detail') }, messages: async () => { throw new Error('unexpected messages') },
      events: async function* (_cursor: unknown, signal: AbortSignal) {
        yield { type: 'connected', connected: { resume: 'gap' } }
        await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
      }
    }
    const { store, interpreter } = await setup(client)
    let clock = 1000
    const journalPath = join(store.path, '..', 'continuity.journal')
    const journal = new SourceContinuityJournal(journalPath, () => clock)
    const engine = new SidecarSourceEngine(store, interpreter, new ConsumerBroker(store), client as any, undefined, () => {}, [], journal)
    engine.start()
    for (let i = 0; i < 30 && !engine.isLive(); i++) await Bun.sleep(5)
    expect(engine.isLive()).toBeTrue()
    clock = 2000; journal.record('heartbeat')
    clock = 3000; await engine.stop()
    expect(readContinuityEvidence(`${journalPath}.sealed`, 1500, 1900)).toMatchObject({ sourceState: 'live', gapCount: 0, observedFrom: 1000, observedThrough: 2000 })
  })
  test('uses the full session-added payload without a detail request', async () => {
    let catalogCalls = 0, detailCalls = 0
    const client = {
      catalog: async () => { catalogCalls++; return [] },
      session: async () => { detailCalls++; return { id: 'new', active: true } },
      messages: async () => ({ messages: [], page: { epoch: 1, reset: false, nextAfterSeq: null, nextAfterAt: null, snapshotHeadSeq: null, snapshotHeadAt: null, hasMore: false } }),
      events: async function* (_cursor: unknown, signal: AbortSignal) {
        yield { type: 'connected', connected: { resume: 'gap' } }
        yield { type: 'event', frame: { id: 'event:added', event: { type: 'session-added', sessionId: 'new', data: { id: 'new', active: true, updatedAt: 5, metadataVersion: 1, agentStateVersion: 1, metadata: { name: 'Added', flavor: 'codex' }, agentState: { requests: {} } } } } }
        await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
      }
    }
    const { store, engine } = await setup(client)
    engine.start()
    for (let i = 0; i < 30 && store.sourceCursor() !== 'event:added'; i++) await Bun.sleep(5)
    expect(store.sourceCursor()).toBe('event:added')
    expect(catalogCalls).toBe(1)
    expect(detailCalls).toBe(0)
    expect(store.catalog().sessions[0]).toMatchObject({ id: 'new', title: 'Added', active: true })
    await engine.stop()
  })

  test('uses one targeted detail fallback for a malformed full session event', async () => {
    let detailCalls = 0
    const client = {
      catalog: async () => [],
      session: async () => { detailCalls++; return { id: 'new', active: true, updatedAt: 6, metadata: { name: 'Recovered' } } },
      messages: async () => ({ messages: [], page: { epoch: 1, reset: false, nextAfterSeq: null, nextAfterAt: null, snapshotHeadSeq: null, snapshotHeadAt: null, hasMore: false } }),
      events: async function* (_cursor: unknown, signal: AbortSignal) {
        yield { type: 'connected', connected: { resume: 'gap' } }
        yield { type: 'event', frame: { id: 'event:malformed-full', event: { type: 'session-added', sessionId: 'new', data: { id: 'new', active: true, metadata: { name: 42 } } } } }
        await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
      }
    }
    const { store, engine } = await setup(client)
    engine.start()
    for (let i = 0; i < 30 && store.sourceCursor() !== 'event:malformed-full'; i++) await Bun.sleep(5)
    expect(store.sourceCursor()).toBe('event:malformed-full')
    expect(detailCalls).toBe(1)
    expect(store.catalog().sessions[0]?.title).toBe('Recovered')
    await engine.stop()
  })

  test('reduces official metadata and request patches without catalog refetch', async () => {
    let catalogCalls = 0, detailCalls = 0
    const client = {
      catalog: async () => { catalogCalls++; return [{ id: 's1', active: true, updatedAt: 1, metadata: { name: 'Old', flavor: 'codex' } }] },
      session: async () => {
        detailCalls++
        return detailCalls === 1
          ? { id: 's1', active: true, thinking: false, updatedAt: 1, metadataVersion: 1, agentStateVersion: 1, metadata: { name: 'Old', flavor: 'codex' }, agentState: { requests: {} } }
          : { id: 's1', active: true, thinking: false, updatedAt: 2, metadataVersion: 2, agentStateVersion: 2, metadata: { name: 'New', flavor: 'codex' }, agentState: { requests: { ask: { tool: 'request_user_input' } } } }
      },
      messages: async () => ({ messages: [], page: { epoch: 1, reset: false, nextAfterSeq: null, nextAfterAt: null, snapshotHeadSeq: null, snapshotHeadAt: null, hasMore: false } }),
      events: async function* (_cursor: unknown, signal: AbortSignal) {
        yield { type: 'connected', connected: { resume: 'gap' } }
        yield { type: 'event', frame: { id: 'event:metadata', event: { type: 'session-updated', sessionId: 's1', data: { metadata: { version: 2, value: { name: 'New', flavor: 'codex' } }, updatedAt: 2 } } } }
        yield { type: 'event', frame: { id: 'event:request', event: { type: 'session-updated', sessionId: 's1', data: { agentState: { version: 2, value: { requests: { ask: { tool: 'request_user_input' } } } }, updatedAt: 2 } } } }
        await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
      }
    }
    const { store, credential, engine } = await setup(client, async () => {})
    engine.start()
    for (let i = 0; i < 40 && store.sourceCursor() !== 'event:request'; i++) await Bun.sleep(5)
    expect(store.sourceCursor()).toBe('event:request')
    expect(catalogCalls).toBe(1)
    expect(detailCalls).toBe(2)
    expect(store.catalog().sessions[0]?.title).toBe('New')
    expect(store.pending(credential.consumerId).map(item => [item.event.kind, item.event.requestId])).toEqual([['input-request', 'ask']])
    await engine.stop()
  })

  test('uses one targeted detail fallback for an unknown patch and never refetches catalog', async () => {
    let catalogCalls = 0, detailCalls = 0
    const client = {
      catalog: async () => { catalogCalls++; return [{ id: 's1', active: true, updatedAt: 1, metadata: { name: 'Old' } }] },
      session: async () => ({ id: 's1', active: true, thinking: false, updatedAt: ++detailCalls, metadata: { name: detailCalls === 1 ? 'Old' : 'Fallback' } }),
      messages: async () => ({ messages: [], page: { epoch: 1, reset: false, nextAfterSeq: null, nextAfterAt: null, snapshotHeadSeq: null, snapshotHeadAt: null, hasMore: false } }),
      events: async function* (_cursor: unknown, signal: AbortSignal) {
        yield { type: 'connected', connected: { resume: 'gap' } }
        yield { type: 'event', frame: { id: 'event:unknown', event: { type: 'session-updated', sessionId: 's1', data: { futureField: true } } } }
        await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
      }
    }
    const { store, engine } = await setup(client)
    engine.start()
    for (let i = 0; i < 30 && store.sourceCursor() !== 'event:unknown'; i++) await Bun.sleep(5)
    expect(store.sourceCursor()).toBe('event:unknown')
    expect(catalogCalls).toBe(1)
    expect(detailCalls).toBe(2)
    expect(store.catalog().sessions[0]?.title).toBe('Fallback')
    await engine.stop()
  })

  test('keeps requests that first appear during live confirmation', async () => {
    let detailCalls = 0
    const client = {
      catalog: async () => [{ id: 's1', active: true, pendingRequestsCount: 0 }],
      session: async () => {
        detailCalls++
        return detailCalls === 1
          ? { id: 's1', active: true, agentStateVersion: 1, agentState: { requests: {} } }
          : { id: 's1', active: true, agentStateVersion: 3, agentState: { requests: { a: { tool: 'Write' }, b: { tool: 'request_user_input' } } } }
      },
      messages: async () => { throw new Error('request confirmation must not read messages') },
      events: async function* (_cursor: unknown, signal: AbortSignal) {
        yield { type: 'connected', connected: { resume: 'gap' } }
        yield { type: 'event', frame: { id: 'event:request', event: { type: 'session-updated', sessionId: 's1', data: { agentState: { version: 2, value: { requests: { a: { tool: 'Write' } } } } } } } }
        await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
      }
    }
    const { store, credential, engine } = await setup(client, async () => {})
    engine.start()
    for (let i = 0; i < 30 && store.sourceCursor() !== 'event:request'; i++) await Bun.sleep(5)
    expect(store.pending(credential.consumerId).map(item => [item.event.kind, item.event.requestId])).toEqual([
      ['permission-request', 'a'],
      ['input-request', 'b']
    ])
    expect(detailCalls).toBe(2)
    await engine.stop()
  })

  test('advances harmless session patches without refetching detail or the full catalog', async () => {
    let catalogCalls = 0, detailCalls = 0
    const client = {
      catalog: async () => { catalogCalls++; return [{ id: 's1', title: 'One', active: true, updatedAt: 1 }] },
      session: async () => { detailCalls++; return { id: 's1', title: 'One', active: true, thinking: false, updatedAt: 1 } },
      messages: async () => ({ messages: [], page: { epoch: 1, reset: false, nextAfterSeq: null, nextAfterAt: null, snapshotHeadSeq: null, snapshotHeadAt: null, hasMore: false } }),
      events: async function* (_cursor: unknown, signal: AbortSignal) {
        yield { type: 'connected', connected: { resume: 'gap' } }
        yield { type: 'event', frame: { id: 'event:harmless', event: { type: 'session-updated', sessionId: 's1', data: { updatedAt: 123, model: 'new-model', thinking: false } } } }
        await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
      }
    }
    const { store, engine } = await setup(client); engine.start()
    for (let i = 0; i < 30 && store.sourceCursor() !== 'event:harmless'; i++) await Bun.sleep(5)
    expect(store.sourceCursor()).toBe('event:harmless'); expect(catalogCalls).toBe(1); expect(detailCalls).toBe(1)
    expect(store.catalog().sessions[0]?.updatedAt).toBe(123); await engine.stop()
  })
  test('bounds a harmless cursor batch and flushes its tail on stop', async () => {
    const client = {
      catalog: async () => [{ id: 's1', title: 'One', active: true, updatedAt: 1 }],
      session: async () => ({ id: 's1', title: 'One', active: true, thinking: false, updatedAt: 1 }),
      messages: async () => ({ messages: [], page: { epoch: 1, reset: false, nextAfterSeq: null, nextAfterAt: null, snapshotHeadSeq: null, snapshotHeadAt: null, hasMore: false } }),
      events: async function* (_cursor: unknown, signal: AbortSignal) {
        yield { type: 'connected', connected: { resume: 'gap' } }
        for (let index = 1; index <= 100; index++) yield { type: 'event', frame: { id: `event:${index}`, event: { type: 'session-updated', sessionId: 's1', data: { updatedAt: index, thinking: false } } } }
        await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
      }
    }
    const { store, engine } = await setup(client)
    const original = store.advanceCursor.bind(store); let commits = 0
    store.advanceCursor = ((...args: Parameters<SidecarStore['advanceCursor']>) => { commits++; return original(...args) }) as SidecarStore['advanceCursor']
    engine.start(); for (let i = 0; i < 30 && store.sourceCursor() !== 'event:65'; i++) await Bun.sleep(5)
    expect(commits).toBe(2); expect(store.sourceCursor()).toBe('event:65')
    await engine.stop(); expect(commits).toBe(3); expect(store.sourceCursor()).toBe('event:100'); expect(store.catalog().sessions[0]?.updatedAt).toBe(100)
  })
  test('coalesces high-frequency official metadata patches into bounded durable checkpoints', async () => {
    let catalogCalls = 0, detailCalls = 0
    const client = {
      catalog: async () => { catalogCalls++; return [{ id: 's1', active: true, metadata: { name: 'Project', flavor: 'codex' }, updatedAt: 0 }] },
      session: async () => { detailCalls++; return { id: 's1', active: true, metadataVersion: 0, agentStateVersion: 0, metadata: { name: 'Project', flavor: 'codex' }, updatedAt: 0 } },
      messages: async () => { throw new Error('metadata traffic must not read messages') },
      events: async function* (_cursor: unknown, signal: AbortSignal) {
        yield { type: 'connected', connected: { resume: 'gap' } }
        for (let version = 1; version <= 1_000; version++) {
          yield { type: 'event', frame: { id: `event:${version}`, event: { type: 'session-updated', sessionId: 's1', data: { metadata: { version, value: { name: 'Project', flavor: 'codex' } }, updatedAt: version } } } }
        }
        await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
      }
    }
    const { store, interpreter, engine } = await setup(client)
    const original = store.advanceCursor.bind(store); let checkpoints = 0
    store.advanceCursor = ((...args: Parameters<SidecarStore['advanceCursor']>) => { checkpoints++; return original(...args) }) as SidecarStore['advanceCursor']
    const originalExport = interpreter.exportState.bind(interpreter); let fullExports = 0
    interpreter.exportState = (() => { fullExports++; return originalExport() }) as EventInterpreter['exportState']
    engine.start()
    for (let i = 0; i < 100 && store.sourceCursor() !== 'event:961'; i++) await Bun.sleep(5)
    expect(store.sourceCursor()).toBe('event:961')
    await engine.stop()
    expect(store.sourceCursor()).toBe('event:1000')
    expect(catalogCalls).toBe(1)
    expect(detailCalls).toBe(1)
    expect(checkpoints).toBeLessThanOrEqual(17)
    expect(fullExports).toBeLessThanOrEqual(40)
    expect(store.interpreterState()?.sessions[0]?.session).toMatchObject({ metadataVersion: 1000, updatedAt: 1000 })
  })
  test('discards a failed pre-gap cursor batch before reconciliation', async () => {
    let connections = 0
    const client = {
      catalog: async () => [{ id: 's1', title: 'One', active: true, updatedAt: 1 }],
      session: async () => ({ id: 's1', title: 'One', active: true, thinking: false, updatedAt: 1 }),
      messages: async () => ({ messages: [], page: { epoch: 1, reset: false, nextAfterSeq: null, nextAfterAt: null, snapshotHeadSeq: null, snapshotHeadAt: null, hasMore: false } }),
      events: async function* (_cursor: unknown, signal: AbortSignal) {
        connections++
        yield { type: 'connected', connected: { resume: 'gap' } }
        if (connections === 1) yield { type: 'event', frame: { id: 'obsolete', event: { type: 'session-updated', sessionId: 's1', data: { updatedAt: 99, thinking: false } } } }
        await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
      }
    }
    const { store, engine } = await setup(client, async () => {})
    const original = store.advanceCursor.bind(store)
    store.advanceCursor = ((...args: Parameters<SidecarStore['advanceCursor']>) => { if (connections === 1) throw new SidecarStorageLimitError(); return original(...args) }) as SidecarStore['advanceCursor']
    engine.start(); for (let i = 0; i < 50 && connections < 2; i++) await Bun.sleep(5)
    expect(connections).toBe(2); await engine.stop()
    expect(store.sourceCursor()).toBeUndefined(); expect(store.catalog().sessions[0]?.updatedAt).toBe(1)
  })
  test('rolls the whole in-memory batch back when its durable checkpoint fails', async () => {
    const client = {
      catalog: async () => { throw new Error('resume ok must not resync') },
      session: async () => { throw new Error('structured patches must not fetch detail') },
      messages: async () => { throw new Error('metadata patches must not read messages') },
      events: async function* () {
        yield { type: 'connected', connected: { resume: 'ok' } }
        for (let version = 1; version <= 65; version++) {
          yield { type: 'event', frame: { id: `event:${version}`, event: { type: 'session-updated', sessionId: 's1', data: { metadata: { version, value: { name: `V${version}`, flavor: 'codex' } }, updatedAt: version } } } }
        }
      }
    }
    const { store, interpreter, engine } = await setup(client, async () => { throw new DOMException('aborted', 'AbortError') })
    const initial = new EventInterpreter('https://hapi.example', 'ns'); initial.baseline([{ id: 's1', active: true, metadataVersion: 0, metadata: { name: 'V0', flavor: 'codex' } }])
    store.commitBaseline([{ id: 's1', title: 'V0', active: true }], initial.exportState())
    let checkpoints = 0; const original = store.advanceCursor.bind(store)
    store.advanceCursor = ((...args: Parameters<SidecarStore['advanceCursor']>) => { if (++checkpoints === 2) throw new SidecarStorageLimitError(); return original(...args) }) as SidecarStore['advanceCursor']
    engine.start()
    for (let i = 0; i < 40 && store.sourceStatus().attentionCode !== 'storage_limit'; i++) await Bun.sleep(5)
    expect(store.sourceCursor()).toBe('event:1')
    expect(store.interpreterState()?.sessions[0]?.session).toMatchObject({ metadataVersion: 1, metadata: { name: 'V1' } })
    expect(interpreter.exportState().sessions[0]?.session).toMatchObject({ metadataVersion: 1, metadata: { name: 'V1' } })
    expect(store.catalog().sessions[0]?.title).toBe('V1')
    await engine.stop()
  })
  test('gap snapshots before applying buffered live event and commits it', async () => {
    let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve })
    const client = {
      catalog: async () => { await hold; return [{ id: 's1', title: 'One', active: true }] },
      session: async () => ({ id: 's1', title: 'One', active: true }),
      messages: async () => ({ messages: [], page: { epoch: 1, reset: false, nextAfterSeq: null, nextAfterAt: null, snapshotHeadSeq: null, snapshotHeadAt: null, hasMore: false } }),
      events: async function* () { yield { type: 'connected', connected: { resume: 'gap' } }; yield { type: 'event', frame: { id: 'epoch:1', event: { type: 'session-ended', sessionId: 's1', reason: 'completed' } } } }
    }
    const { store, credential, engine } = await setup(client); engine.start(); await Bun.sleep(10); expect(store.pending(credential.consumerId)).toEqual([])
    release(); for (let i = 0; i < 20 && !store.pending(credential.consumerId).length; i++) await Bun.sleep(5)
    expect(store.pending(credential.consumerId)[0]?.event.kind).toBe('session-completed'); expect(store.sourceCursor()).toBe('epoch:1'); await engine.stop()
  })
  test('applies a buffered ready once using its SSE frame identity and only enriches that live event', async () => {
    let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve }); let messageCalls = 0
    const client = {
      catalog: async () => { await hold; return [{ id: 's1', active: true, metadata: { name: 'Project', flavor: 'codex' } }] },
      session: async () => ({ id: 's1', active: true, thinking: false, metadata: { name: 'Project', flavor: 'codex' } }),
      messages: async () => { messageCalls++; return { messages: [{ seq: 1, createdAt: 1, role: 'agent', content: 'Finished' }], page: { epoch: 1, reset: false, nextAfterSeq: 1, nextAfterAt: 1, snapshotHeadSeq: 1, snapshotHeadAt: 1, hasMore: false } } },
      events: async function* (_cursor: unknown, signal: AbortSignal) {
        yield { type: 'connected', connected: { resume: 'gap' } }
        const frame = { id: 'official:ready:1', event: { type: 'message-received', sessionId: 's1', message: { seq: 7, createdAt: 7, content: { type: 'event', data: { type: 'ready' } } } } }
        yield { type: 'event', frame }; yield { type: 'event', frame }
        await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
      }
    }
    const { store, credential, engine } = await setup(client); engine.start(); await Bun.sleep(10); release()
    for (let i = 0; i < 30 && store.sourceCursor() !== 'official:ready:1'; i++) await Bun.sleep(5)
    expect(store.pending(credential.consumerId)).toHaveLength(1); expect(store.pending(credential.consumerId)[0]?.event).toMatchObject({ kind: 'ready', body: 'Finished' }); expect(messageCalls).toBe(1)
    expect(store.db.query('SELECT source_key FROM source_dedup').all()).toEqual([{ source_key: 'ns/s1/official:ready:1/ready' }]); await engine.stop()
  })
  test('deduplicates a buffered task by SSE frame ID and suppresses its following generic completion', async () => {
    let messageCalls = 0
    const client = {
      catalog: async () => [{ id: 's1', active: true }], session: async () => ({ id: 's1', active: true }),
      messages: async () => { messageCalls++; throw new Error('task must not read messages') },
      events: async function* (_cursor: unknown, signal: AbortSignal) {
        yield { type: 'connected', connected: { resume: 'gap' } }
        const task = { id: 'official:task:1', event: { type: 'message-received', sessionId: 's1', message: { content: { type: 'output', data: { type: 'system', subtype: 'task_notification', summary: 'Done', status: 'success' } } } } }
        yield { type: 'event', frame: task }; yield { type: 'event', frame: task }
        yield { type: 'event', frame: { id: 'official:end:1', event: { type: 'session-ended', sessionId: 's1', reason: 'completed' } } }
        await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
      }
    }
    const { store, credential, engine } = await setup(client); engine.start()
    for (let i = 0; i < 30 && store.sourceCursor() !== 'official:end:1'; i++) await Bun.sleep(5)
    expect(store.pending(credential.consumerId).map(item => item.event.kind)).toEqual(['task-notification']); expect(messageCalls).toBe(0); await engine.stop()
  })
  test('does not notify existing state on cold gap baseline', async () => {
    const client = {
      catalog: async () => [{ id: 's1', title: 'One', active: true, pendingRequestsCount: 1 }],
      session: async () => ({ id: 's1', title: 'One', active: true, agentState: { requests: { old: { tool: 'Bash' } } } }),
      messages: async () => ({ messages: [], page: { epoch: 1, reset: false, nextAfterSeq: null, nextAfterAt: null, snapshotHeadSeq: null, snapshotHeadAt: null, hasMore: false } }),
      events: async function* (_cursor: unknown, signal: AbortSignal) { yield { type: 'connected', connected: { resume: 'gap' } }; await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })) }
    }
    const { store, credential, engine } = await setup(client); engine.start(); await Bun.sleep(20); expect(store.pending(credential.consumerId)).toEqual([]); expect(store.catalog().sessions).toHaveLength(1); await engine.stop()
  })
  test('restores current state across a gap without scanning historical messages', async () => {
    let messageCalls = 0
    const client = {
      catalog: async () => [{ id: 's1', active: true, metadata: { name: 'Project', flavor: 'codex' } }],
      session: async () => ({ id: 's1', active: true, thinking: false, metadata: { name: 'Project', flavor: 'codex' } }),
      messages: async () => { messageCalls++; throw new Error('history must not be scanned') },
      events: async function* (_cursor: unknown, signal: AbortSignal) { yield { type: 'connected', connected: { resume: 'gap' } }; await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })) }
    }
    const { store, credential, engine } = await setup(client)
    const initial = new EventInterpreter('https://hapi.example', 'ns', () => 10_000)
    initial.restoreState({ version: 1, sessions: [{ session: await client.session(), requestIds: [], messageEpoch: 3, messageAt: 1000, messageSeq: 10 }] })
    store.commitBaseline((await client.catalog()).map((item: any) => ({ id: item.id, title: item.metadata.name, active: item.active })), initial.exportState())
    engine.start(); for (let i = 0; i < 20 && !engine.isLive(); i++) await Bun.sleep(5)
    expect(engine.isLive()).toBeTrue(); expect(messageCalls).toBe(0); expect(store.pending(credential.consumerId)).toEqual([])
    const saved = store.interpreterState()!; expect(saved.version).toBe(1); expect(saved.sessions[0]).not.toHaveProperty('messageEpoch'); expect(saved.sessions[0]).not.toHaveProperty('messageAt'); expect(saved.sessions[0]).not.toHaveProperty('messageSeq'); await engine.stop()
  })
  test('handles a large gap catalog without reading any message pages', async () => {
    let messageCalls = 0
    const catalog = Array.from({ length: 230 }, (_, index) => ({ id: `s${index}`, active: index === 0, metadata: { name: `Session ${index}`, flavor: 'codex' } }))
    const client = {
      catalog: async () => catalog,
      session: async (id: string) => catalog.find(item => item.id === id),
      messages: async () => { messageCalls++; return { messages: [], page: { epoch: 4, reset: false, nextAfterSeq: 100, nextAfterAt: 1000, snapshotHeadSeq: 100, snapshotHeadAt: 1000, hasMore: true } } },
      events: async function* (_cursor: unknown, signal: AbortSignal) { yield { type: 'connected', connected: { resume: 'gap' } }; await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })) }
    }
    const { store, engine } = await setup(client)
    engine.start(); for (let i = 0; i < 30 && !engine.isLive(); i++) await Bun.sleep(5)
    expect(engine.isLive()).toBeTrue(); expect(messageCalls).toBe(0); expect(store.catalog().sessions).toHaveLength(230); await engine.stop()
  })
  test('recovers persistent gap requests once and does not repeat an existing request', async () => {
    const detail = { id: 's1', active: true, agentState: { requests: { old: { tool: 'Bash' }, input: { tool: 'request_user_input' }, permission: { tool: 'Write' } } } }
    const client = {
      catalog: async () => [{ id: 's1', active: true, pendingRequestsCount: 3 }], session: async () => detail,
      messages: async () => { throw new Error('history must not be scanned') },
      events: async function* (_cursor: unknown, signal: AbortSignal) { yield { type: 'connected', connected: { resume: 'gap' } }; yield { type: 'event', frame: { id: 'buffered:request', event: { type: 'session-updated', sessionId: 's1' } } }; await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })) }
    }
    const { store, credential, engine } = await setup(client, async () => {})
    const initial = new EventInterpreter('https://hapi.example', 'ns'); initial.baseline([{ id: 's1', active: true, agentState: { requests: { old: { tool: 'Bash' } } } }])
    store.commitBaseline([{ id: 's1', active: true }], initial.exportState()); engine.start()
    for (let i = 0; i < 30 && store.sourceCursor() !== 'buffered:request'; i++) await Bun.sleep(5)
    expect(store.pending(credential.consumerId).map(item => [item.event.kind, item.event.requestId])).toEqual([['input-request', 'input'], ['permission-request', 'permission']]); await engine.stop()
  })
  test('drops a gap request that disappears during the confirmation delay', async () => {
    let detailCalls = 0
    const client = {
      catalog: async () => [{ id: 's1', active: true, pendingRequestsCount: 1 }],
      session: async () => ({ id: 's1', active: true, agentState: { requests: detailCalls++ === 0 ? { transient: { tool: 'Bash' } } : {} } }),
      messages: async () => { throw new Error('history must not be scanned') },
      events: async function* (_cursor: unknown, signal: AbortSignal) { yield { type: 'connected', connected: { resume: 'gap' } }; await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })) }
    }
    const { store, credential, engine } = await setup(client, async () => {})
    const initial = new EventInterpreter('https://hapi.example', 'ns'); initial.baseline([{ id: 's1', active: true }]); store.commitBaseline([{ id: 's1', active: true }], initial.exportState())
    engine.start(); for (let i = 0; i < 30 && !engine.isLive(); i++) await Bun.sleep(5)
    expect(engine.isLive()).toBeTrue(); expect(detailCalls).toBe(2); expect(store.pending(credential.consumerId)).toEqual([]); await engine.stop()
  })
  test('keeps a request that appears during gap confirmation and does not duplicate it from the buffer', async () => {
    let detailCalls = 0
    const client = {
      catalog: async () => [{ id: 's1', active: true, pendingRequestsCount: 1 }],
      session: async () => ({ id: 's1', active: true, agentState: { requests: detailCalls++ === 0 ? { a: { tool: 'Write' } } : { a: { tool: 'Write' }, b: { tool: 'request_user_input' } } } }),
      messages: async () => { throw new Error('history must not be scanned') },
      events: async function* (_cursor: unknown, signal: AbortSignal) { yield { type: 'connected', connected: { resume: 'gap' } }; yield { type: 'event', frame: { id: 'buffered:new-request', event: { type: 'session-updated', sessionId: 's1' } } }; await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })) }
    }
    const { store, credential, engine } = await setup(client, async () => {})
    const initial = new EventInterpreter('https://hapi.example', 'ns'); initial.baseline([{ id: 's1', active: true }]); store.commitBaseline([{ id: 's1', active: true }], initial.exportState())
    engine.start(); for (let i = 0; i < 30 && store.sourceCursor() !== 'buffered:new-request'; i++) await Bun.sleep(5)
    expect(store.pending(credential.consumerId).map(item => item.event.requestId)).toEqual(['a', 'b']); expect(detailCalls).toBe(3); await engine.stop()
  })
  test('replaces a disappearing gap request with a newly confirmed request', async () => {
    let detailCalls = 0
    const client = {
      catalog: async () => [{ id: 's1', active: true, pendingRequestsCount: 1 }],
      session: async () => ({ id: 's1', active: true, agentState: { requests: detailCalls++ === 0 ? { a: { tool: 'Write' } } : { b: { tool: 'request_user_input' } } } }),
      messages: async () => { throw new Error('history must not be scanned') },
      events: async function* (_cursor: unknown, signal: AbortSignal) { yield { type: 'connected', connected: { resume: 'gap' } }; await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })) }
    }
    const { store, credential, engine } = await setup(client, async () => {})
    const initial = new EventInterpreter('https://hapi.example', 'ns'); initial.baseline([{ id: 's1', active: true }]); store.commitBaseline([{ id: 's1', active: true }], initial.exportState())
    engine.start(); for (let i = 0; i < 30 && !engine.isLive(); i++) await Bun.sleep(5)
    expect(store.pending(credential.consumerId).map(item => item.event.requestId)).toEqual(['b']); expect(detailCalls).toBe(2); await engine.stop()
  })
  test('keeps the prior cursor catalog and watermark when a gap commit fails', async () => {
    const client = {
      catalog: async () => [{ id: 's1', title: 'New', active: true, pendingRequestsCount: 1 }], session: async () => ({ id: 's1', title: 'New', active: true, agentState: { requests: { new: { tool: 'Write' } } } }),
      messages: async () => { throw new Error('history must not be scanned') }, events: async function* () { yield { type: 'connected', connected: { resume: 'gap' } } }
    }
    const sleep = async (ms: number) => { if (ms !== 500) throw new DOMException('aborted', 'AbortError') }
    const { store, credential, engine } = await setup(client, sleep)
    const initial = new EventInterpreter('https://hapi.example', 'ns'); initial.restoreState({ version: 1, sessions: [{ session: { id: 's1', title: 'Old', active: true }, requestIds: [], messageEpoch: 2, messageAt: 20, messageSeq: 2 }] })
    store.commitBaseline([{ id: 's1', title: 'Old', active: true }], initial.exportState()); store.advanceCursor('old:cursor')
    store.commitReconciliation = (() => { throw new Error('forced commit failure') }) as SidecarStore['commitReconciliation']; engine.start(); await Bun.sleep(30); await engine.stop()
    expect(store.sourceCursor()).toBe('old:cursor'); expect(store.catalog().sessions[0]?.title).toBe('Old'); expect(store.interpreterState()?.sessions[0]).toMatchObject({ messageEpoch: 2, messageAt: 20, messageSeq: 2 }); expect(store.pending(credential.consumerId)).toEqual([])
  })
  test('reconciliation overflow aborts the source and preserves the committed cursor', async () => {
    const client = {
      catalog: async (signal: AbortSignal) => new Promise<any[]>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })),
      session: async () => ({ id: 's1', active: true }),
      messages: async () => ({ messages: [], page: { epoch: 1, reset: false, nextAfterSeq: null, nextAfterAt: null, snapshotHeadSeq: null, snapshotHeadAt: null, hasMore: false } }),
      events: async function* () { yield { type: 'connected', connected: { resume: 'gap' } }; for (let index = 0; index < 2049; index++) yield { type: 'event', frame: { id: `e:${index}`, event: { type: 'session-updated', sessionId: 's1' } } } }
    }
    const { store, engine } = await setup(client); engine.start()
    for (let i = 0; i < 50 && store.sourceStatus().attentionCode !== 'source_reconcile_overflow'; i++) await Bun.sleep(5)
    expect(store.sourceStatus()).toMatchObject({ state: 'attention', attentionCode: 'source_reconcile_overflow' }); expect(store.sourceCursor()).toBeUndefined(); await engine.stop()
  })
  test('debounces a transient request and commits no notification after it disappears', async () => {
    let detailCalls = 0
    const client = {
      catalog: async () => [{ id: 's1', active: true }],
      session: async () => ({ id: 's1', active: true, agentState: { requests: detailCalls++ === 1 ? { transient: { tool: 'Bash' } } : {} } }),
      messages: async () => ({ messages: [], page: { epoch: 1, reset: false, nextAfterSeq: null, nextAfterAt: null, snapshotHeadSeq: null, snapshotHeadAt: null, hasMore: false } }),
      events: async function* (_cursor: unknown, signal: AbortSignal) {
        yield { type: 'connected', connected: { resume: 'gap' } }; yield { type: 'event', frame: { id: 'event:1', event: { type: 'session-updated', sessionId: 's1' } } }
        await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
      }
    }
    const { store, credential, engine } = await setup(client, async () => {}); engine.start()
    for (let i = 0; i < 30 && store.sourceCursor() !== 'event:1'; i++) await Bun.sleep(5)
    expect(store.sourceCursor()).toBe('event:1'); expect(store.pending(credential.consumerId)).toEqual([]); await engine.stop()
  })
  test('serializes durable cutover between source commits so no post-cutover event is shadowed', async () => {
    let detailStarted!: () => void, releaseDetail!: () => void, releaseSecond!: () => void
    const detailSeen = new Promise<void>(resolve => { detailStarted = resolve }), detailHold = new Promise<void>(resolve => { releaseDetail = resolve }), secondHold = new Promise<void>(resolve => { releaseSecond = resolve })
    const client = {
      catalog: async () => [{ id: 's1', active: true }],
      session: async () => { detailStarted(); await detailHold; return { id: 's1', active: true } },
      messages: async () => ({ messages: [], page: { epoch: 1, reset: false, nextAfterSeq: null, nextAfterAt: null, snapshotHeadSeq: null, snapshotHeadAt: null, hasMore: false } }),
      events: async function* (_cursor: unknown, signal: AbortSignal) {
        yield { type: 'connected', connected: { resume: 'ok' } }; yield { type: 'event', frame: { id: 'before', event: { type: 'session-updated', sessionId: 's1', data: { futureField: true } } } }
        await secondHold; yield { type: 'event', frame: { id: 'after', event: { type: 'session-ended', sessionId: 's1', reason: 'completed' } } }
        await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
      }
    }
    const { store, credential, engine } = await setup(client, async () => { throw new DOMException('aborted', 'AbortError') }, [])
    const initial = new EventInterpreter('https://hapi.example', 'ns', () => 20_000); initial.baseline([{ id: 's1', active: true }]); store.commitBaseline([{ id: 's1', active: true }], initial.exportState())
    engine.start(); await detailSeen
    let cutoverCommitted = false; const cutover = engine.activateDelivery(async () => { cutoverCommitted = true })
    await Bun.sleep(5); expect(cutoverCommitted).toBeFalse(); releaseDetail(); await cutover; expect(store.pending(credential.consumerId)).toEqual([])
    releaseSecond(); for (let i = 0; i < 30 && store.sourceCursor() !== 'after'; i++) await Bun.sleep(5)
    expect(store.sourceCursor()).toBe('after'); expect(store.pending(credential.consumerId)).toHaveLength(1); await engine.stop()
  })
})
