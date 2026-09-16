import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConsumerBroker } from '../src/consumer-broker'
import { EventInterpreter } from '../src/interpreter'
import { SidecarSourceEngine } from '../src/sidecar-source'
import { SidecarStore } from '../src/sidecar-store'

const stores: SidecarStore[] = []
async function setup(client: any, sleep: (ms: number, signal: AbortSignal) => Promise<void> = async () => { throw new DOMException('aborted', 'AbortError') }, targetKinds: Array<'mac' | 'ntfy'> = ['mac', 'ntfy']) { const root = await mkdtemp(join(tmpdir(), 'source-')); const dir = join(root, 'state'); await mkdir(dir, { mode: 0o700 }); const store = new SidecarStore(join(dir, 'db')); stores.push(store); store.bindSource('https://hapi.example', 'ns'); const credential = store.createConsumer('mac'); const broker = new ConsumerBroker(store); return { store, credential, engine: new SidecarSourceEngine(store, new EventInterpreter('https://hapi.example', 'ns', () => 20_000), broker, client, sleep, () => {}, targetKinds) } }
afterEach(() => { while (stores.length) stores.pop()!.close() })

describe('SidecarSourceEngine', () => {
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
  test('does not notify existing state on cold gap baseline', async () => {
    const client = {
      catalog: async () => [{ id: 's1', title: 'One', active: true, pendingRequestsCount: 1 }],
      session: async () => ({ id: 's1', title: 'One', active: true, agentState: { requests: { old: { tool: 'Bash' } } } }),
      messages: async () => ({ messages: [], page: { epoch: 1, reset: false, nextAfterSeq: null, nextAfterAt: null, snapshotHeadSeq: null, snapshotHeadAt: null, hasMore: false } }),
      events: async function* () { yield { type: 'connected', connected: { resume: 'gap' } } }
    }
    const { store, credential, engine } = await setup(client); engine.start(); await Bun.sleep(20); expect(store.pending(credential.consumerId)).toEqual([]); expect(store.catalog().sessions).toHaveLength(1); await engine.stop()
  })
  test('restores durable interpreter state and recovers a ready message across a gap', async () => {
    const client = {
      catalog: async () => [{ id: 's1', active: true, metadata: { name: 'Project', flavor: 'codex' } }],
      session: async () => ({ id: 's1', active: true, thinking: false, metadata: { name: 'Project', flavor: 'codex' } }),
      messages: async (_id: string, query: any) => query.afterSeq === undefined
        ? { messages: [], page: { epoch: 3, reset: false, nextAfterSeq: null, nextAfterAt: null, snapshotHeadSeq: 10, snapshotHeadAt: 1000, hasMore: false } }
        : { messages: [{ id: 'm11', seq: 11, createdAt: 1100, content: { type: 'event', data: { type: 'ready' } } }], page: { epoch: 3, reset: false, nextAfterSeq: 11, nextAfterAt: 1100, snapshotHeadSeq: 11, snapshotHeadAt: 1100, hasMore: false } },
      events: async function* () { yield { type: 'connected', connected: { resume: 'gap' } } }
    }
    const { store, credential, engine } = await setup(client)
    const initial = new EventInterpreter('https://hapi.example', 'ns', () => 10_000); initial.baseline([await client.session()]); initial.baselineMessages('s1', await client.messages('s1', {}))
    store.commitBaseline((await client.catalog()).map((item: any) => ({ id: item.id, title: item.metadata.name, active: item.active })), initial.exportState())
    engine.start(); for (let i = 0; i < 20 && !store.pending(credential.consumerId).length; i++) await Bun.sleep(5)
    expect(store.pending(credential.consumerId)[0]?.event).toMatchObject({ kind: 'ready', sessionName: 'Project' }); await engine.stop()
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
    let catalogStarted!: () => void, releaseCatalog!: () => void, releaseSecond!: () => void
    const catalogSeen = new Promise<void>(resolve => { catalogStarted = resolve }), catalogHold = new Promise<void>(resolve => { releaseCatalog = resolve }), secondHold = new Promise<void>(resolve => { releaseSecond = resolve })
    const client = {
      catalog: async () => { catalogStarted(); await catalogHold; return [{ id: 's1', active: true }] },
      session: async () => ({ id: 's1', active: true }),
      messages: async () => ({ messages: [], page: { epoch: 1, reset: false, nextAfterSeq: null, nextAfterAt: null, snapshotHeadSeq: null, snapshotHeadAt: null, hasMore: false } }),
      events: async function* (_cursor: unknown, signal: AbortSignal) {
        yield { type: 'connected', connected: { resume: 'ok' } }; yield { type: 'event', frame: { id: 'before', event: { type: 'session-ended', sessionId: 's1', reason: 'completed' } } }
        await secondHold; yield { type: 'event', frame: { id: 'after', event: { type: 'session-ended', sessionId: 's1', reason: 'completed' } } }
        await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
      }
    }
    const { store, credential, engine } = await setup(client, async () => { throw new DOMException('aborted', 'AbortError') }, [])
    const initial = new EventInterpreter('https://hapi.example', 'ns', () => 20_000); initial.baseline([{ id: 's1', active: true }]); store.commitBaseline([{ id: 's1', active: true }], initial.exportState())
    engine.start(); await catalogSeen
    let cutoverCommitted = false; const cutover = engine.activateDelivery(async () => { cutoverCommitted = true })
    await Bun.sleep(5); expect(cutoverCommitted).toBeFalse(); releaseCatalog(); await cutover; expect(store.pending(credential.consumerId)).toEqual([])
    releaseSecond(); for (let i = 0; i < 30 && store.sourceCursor() !== 'after'; i++) await Bun.sleep(5)
    expect(store.sourceCursor()).toBe('after'); expect(store.pending(credential.consumerId)).toHaveLength(1); await engine.stop()
  })
})
