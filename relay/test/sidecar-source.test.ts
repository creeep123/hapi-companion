import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConsumerBroker } from '../src/consumer-broker'
import { EventInterpreter } from '../src/interpreter'
import { SidecarSourceEngine } from '../src/sidecar-source'
import { SidecarStorageLimitError, SidecarStore } from '../src/sidecar-store'

const stores: SidecarStore[] = []
async function setup(client: any, sleep: (ms: number, signal: AbortSignal) => Promise<void> = async () => { throw new DOMException('aborted', 'AbortError') }, targetKinds: Array<'mac' | 'ntfy'> = ['mac', 'ntfy']) { const root = await mkdtemp(join(tmpdir(), 'source-')); const dir = join(root, 'state'); await mkdir(dir, { mode: 0o700 }); const store = new SidecarStore(join(dir, 'db')); stores.push(store); store.bindSource('https://hapi.example', 'ns'); const credential = store.createConsumer('mac'); const broker = new ConsumerBroker(store); return { store, credential, engine: new SidecarSourceEngine(store, new EventInterpreter('https://hapi.example', 'ns', () => 20_000), broker, client, sleep, () => {}, targetKinds) } }
afterEach(() => { while (stores.length) stores.pop()!.close() })

describe('SidecarSourceEngine', () => {
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
