import { describe, expect, test } from 'bun:test'
import { RelayEngine } from '../src/engine'
import { HubError } from '../src/hub'
import { RelayManager } from '../src/manager'
import { NtfyError } from '../src/ntfy'
import { StateStore } from '../src/state'
import { config, event, statePath } from './helpers'

const waitForAbort = (signal: AbortSignal): Promise<never> => {
  if (signal.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'))
  return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
}

async function activeStore() {
  const store = new StateStore(await statePath())
  await store.update(s => {
    s.config = config(); s.credential = { deviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', token: 't'.repeat(40) }
    s.activation = { activationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', installationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', deviceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'committed', requestFingerprint: 'd'.repeat(64) }; s.enabled = true
  })
  return store
}

describe('RelayEngine delivery gate', () => {
  test('persists provider acceptance before ACK and ledger replay does not repost', async () => {
    const store = await activeStore(); let posts = 0, acks = 0; const id = '11111111-1111-4111-8111-111111111111'; const item = event({ eventId: id })
    const ntfy = { post: async () => { posts++ } }
    const hub = { ack: async () => { expect((await store.load()).handled[id]?.reason).toBe('posted'); acks++ } }
    const engine = new RelayEngine(store, ntfy as any)
    await (engine as any).processHead(1, item, hub, new AbortController().signal)
    await (engine as any).processHead(1, item, hub, new AbortController().signal)
    expect(posts).toBe(1); expect(acks).toBe(2)
  })
  test('provider failure writes no ledger and does not ACK', async () => {
    const store = await activeStore(); let acks = 0
    const engine = new RelayEngine(store, { post: async () => { throw new Error('offline') } } as any)
    const id = '22222222-2222-4222-8222-222222222222'; await expect((engine as any).processHead(1, event({ eventId: id }), { ack: async () => { acks++ } }, new AbortController().signal)).rejects.toThrow('offline')
    expect(acks).toBe(0); expect((await store.load()).handled[id]).toBeUndefined()
  })
  test('ACK failure retains handled ledger for restart replay', async () => {
    const store = await activeStore(); let posts = 0
    const engine = new RelayEngine(store, { post: async () => { posts++ } } as any)
    const id = '33333333-3333-4333-8333-333333333333'; await expect((engine as any).processHead(2, event({ eventId: id }), { ack: async () => { throw new Error('ack offline') } }, new AbortController().signal)).rejects.toThrow()
    expect((await store.load()).handled[id]).toBeDefined()
    await (engine as any).processHead(2, event({ eventId: id }), { ack: async () => {} }, new AbortController().signal)
    expect(posts).toBe(1)
  })
  test('paused event is durably suppressed and ACKed', async () => {
    const store = await activeStore(); await store.update(s => { s.paused = true }); let posts = 0, acks = 0
    const engine = new RelayEngine(store, { post: async () => { posts++ } } as any)
    const id = '44444444-4444-4444-8444-444444444444'; await (engine as any).processHead(3, event({ eventId: id }), { ack: async () => { acks++ } }, new AbortController().signal)
    expect(posts).toBe(0); expect(acks).toBe(1); expect((await store.load()).handled[id].reason).toBe('paused')
  })
  test('event ID collision fails closed without ACK', async () => {
    const id = '55555555-5555-4555-8555-555555555555'; const store = await activeStore(); await store.update(s => { s.handled[id] = { seq: 1, at: Date.now(), reason: 'posted' } }); let acks = 0
    const engine = new RelayEngine(store)
    await expect((engine as any).processHead(2, event({ eventId: id }), { ack: async () => { acks++ } }, new AbortController().signal)).rejects.toThrow('hub_contract_invalid')
    expect(acks).toBe(0)
  })
  test('permanent failure at head never processes or ACKs a later sequence', async () => {
    const store = await activeStore(), seen: string[] = [], acked: number[] = []
    const first = event({ eventId: '66666666-6666-4666-8666-666666666666' }), second = event({ eventId: '77777777-7777-4777-8777-777777777777' })
    const hub = { events: async function* () { yield { seq: 1, event: first }; yield { seq: 2, event: second } }, ack: async (seq: number) => { acked.push(seq) } }
    const ntfy = { post: async (_c: any, e: any) => { seen.push(e.eventId); throw new NtfyError('ntfy_configuration_error', true) } }
    const engine = new RelayEngine(store, ntfy as any, () => hub as any, async () => {})
    await engine.start()
    for (let i = 0; i < 50 && (await store.load()).health.stream !== 'attention'; i++) await Bun.sleep(2)
    await engine.stop()
    expect(seen).toEqual([first.eventId]); expect(acked).toEqual([])
  })
  test('provider acceptance followed by ledger write failure never ACKs', async () => {
    const store = await activeStore(), original = store.update.bind(store); let fail = true, posts = 0, acks = 0
    store.update = ((mutate: any) => original((state: any) => {
      const before = Object.keys(state.handled).length, result = mutate(state)
      if (fail && Object.keys(state.handled).length > before) { fail = false; throw new Error('disk_full') }
      return result
    })) as any
    const engine = new RelayEngine(store, { post: async () => { posts++ } } as any)
    await expect((engine as any).processHead(1, event(), { ack: async () => { acks++ } }, new AbortController().signal)).rejects.toThrow('disk_full')
    expect(posts).toBe(1); expect(acks).toBe(0)
  })
  test('429 retry reconnects from head and preserves sequence', async () => {
    const store = await activeStore(), ids = ['88888888-8888-4888-8888-888888888888', '99999999-9999-4999-8999-999999999999'], events = ids.map((eventId, i) => ({ seq: i + 1, event: event({ eventId }) }))
    const attempts: string[] = [], acked: number[] = [], delays: number[] = []; let first = true
    const hub = { events: async function* (signal: AbortSignal) { for (const item of events.filter(x => x.seq > (acked.at(-1) ?? 0))) yield item; await waitForAbort(signal) }, ack: async (seq: number) => { acked.push(seq) } }
    const ntfy = { post: async (_c: any, e: any) => { attempts.push(e.eventId); if (first) { first = false; throw new NtfyError('ntfy_rate_limited', false, 2000) } } }
    const engine = new RelayEngine(store, ntfy as any, () => hub as any, async (ms: number) => { delays.push(ms) })
    await engine.start(); for (let i = 0; i < 100 && acked.length < 2; i++) await Bun.sleep(2); await engine.stop()
    expect(delays).toEqual([2000]); expect(attempts).toEqual([ids[0], ids[0], ids[1]]); expect(acked).toEqual([1, 2])
  })
  test('Hub contract failure becomes safe attention and ACKs nothing', async () => {
    const store = await activeStore(), hub = { events: async function* () { throw new (await import('../src/hub')).HubError('hub_contract_invalid', true) }, ack: async () => { throw new Error('must not ACK') } }
    const engine = new RelayEngine(store, {} as any, () => hub as any); await engine.start()
    for (let i = 0; i < 50 && (await store.load()).health.stream !== 'attention'; i++) await Bun.sleep(2)
    expect((await store.load()).health).toMatchObject({ stream: 'attention', attentionCode: 'hub_contract_invalid' }); await engine.stop()
  })
  test.each(['ntfy_temporary_failure'] as const)('408/5xx-class failure reconnects without skipping (%s)', async code => {
    const store = await activeStore(), id = 'aaaaaaaa-1111-4111-8111-111111111111', acked: number[] = []; let attempts = 0
    const item = { seq: 1, event: event({ eventId: id }) }
    const hub = { events: async function* (signal: AbortSignal) { yield item; await waitForAbort(signal) }, ack: async (seq: number) => { acked.push(seq) } }
    const ntfy = { post: async () => { if (++attempts === 1) throw new NtfyError(code, false) } }
    const engine = new RelayEngine(store, ntfy as any, () => hub as any, async () => {})
    await engine.start(); for (let i = 0; i < 100 && acked.length < 1; i++) await Bun.sleep(2); await engine.stop()
    expect(attempts).toBe(2); expect(acked).toEqual([1])
  })
  test('shutdown during provider POST neither records nor ACKs', async () => {
    const store = await activeStore(), id = 'bbbbbbbb-1111-4111-8111-111111111111'; let acked = false, posting = false
    const hub = { events: async function* () { yield { seq: 1, event: event({ eventId: id }) } }, ack: async () => { acked = true } }
    const ntfy = { post: async (_c: any, _e: any, _u: any, _q: any, signal: AbortSignal) => { posting = true; await waitForAbort(signal) } }
    const engine = new RelayEngine(store, ntfy as any, () => hub as any); await engine.start(); for (let i = 0; i < 50 && !posting; i++) await Bun.sleep(1); await engine.stop()
    expect(acked).toBeFalse(); expect((await store.load()).handled[id]).toBeUndefined()
  })
  test('shutdown during ACK preserves accepted ledger for offline restart', async () => {
    const store = await activeStore(), id = 'cccccccc-1111-4111-8111-111111111111'; let posting = 0, ackStarted = false
    const item = { seq: 1, event: event({ eventId: id }) }
    const firstHub = { events: async function* () { yield item }, ack: async (_s: number, _e: string, signal: AbortSignal) => { ackStarted = true; await waitForAbort(signal) } }
    const first = new RelayEngine(store, { post: async () => { posting++ } } as any, () => firstHub as any); await first.start(); for (let i = 0; i < 50 && !ackStarted; i++) await Bun.sleep(1); await first.stop()
    expect((await store.load()).handled[id]?.reason).toBe('posted')
    let acked = false; const secondHub = { events: async function* () { yield item }, ack: async () => { acked = true } }
    const second = new RelayEngine(store, { post: async () => { posting++ } } as any, () => secondHub as any); await second.start(); for (let i = 0; i < 50 && !acked; i++) await Bun.sleep(1); await second.stop()
    expect(posting).toBe(1); expect(acked).toBeTrue()
  })
  test('non-ledger sequence at or below durable ACK enters attention before post', async () => {
    const store = await activeStore(); await store.update(s => { s.health.lastAckSeq = 5 }); let posts = 0, acks = 0
    const hub = { events: async function* () { yield { seq: 5, event: event({ eventId: 'dddddddd-1111-4111-8111-111111111111' }) } }, ack: async () => { acks++ } }
    const engine = new RelayEngine(store, { post: async () => { posts++ } } as any, () => hub as any); await engine.start()
    for (let i = 0; i < 50 && (await store.load()).health.stream !== 'attention'; i++) await Bun.sleep(1)
    expect(posts).toBe(0); expect(acks).toBe(0); expect((await store.load()).health.attentionCode).toBe('hub_contract_invalid'); await engine.stop()
  })
  test('persists connected as soon as Hub handshake succeeds while idle', async () => {
    const store = await activeStore()
    const hub = { events: async function* (signal: AbortSignal, onConnected: () => Promise<void>) { await onConnected(); await waitForAbort(signal); yield undefined as never }, ack: async () => {} }
    const engine = new RelayEngine(store, {} as any, () => hub as any); await engine.start()
    for (let i = 0; i < 50 && (await store.load()).health.stream !== 'connected'; i++) await Bun.sleep(1)
    expect((await store.load()).health.stream).toBe('connected'); await engine.stop()
  })
  test.each([['hub_unauthorized', true], ['hub_ack_conflict', true]] as const)('ACK %s pauses in attention; replay ACKs ledger without repost', async (code, permanent) => {
    const store = await activeStore(), item = { seq: 1, event: event({ eventId: crypto.randomUUID() }) }; let posts = 0, ackAttempts = 0
    const failingHub = { events: async function* () { yield item }, ack: async () => { ackAttempts++; throw new HubError(code, permanent) } }
    const engine = new RelayEngine(store, { post: async () => { posts++ } } as any, () => failingHub as any); await engine.start()
    for (let i = 0; i < 50 && (await store.load()).health.stream !== 'attention'; i++) await Bun.sleep(1)
    expect((await store.load()).health.attentionCode).toBe(code); expect(posts).toBe(1); expect(ackAttempts).toBe(1); await engine.stop()
    let acked = false; const repairedHub = { events: async function* () { yield item }, ack: async () => { acked = true } }
    const repaired = new RelayEngine(store, { post: async () => { posts++ } } as any, () => repairedHub as any); await repaired.start(); for (let i = 0; i < 50 && !acked; i++) await Bun.sleep(1); await repaired.stop()
    expect(acked).toBeTrue(); expect(posts).toBe(1)
  })
  test('configuration rotation aborts an in-flight post and retries the event with the new destination', async () => {
    const store = await activeStore(), item = { seq: 1, event: event({ eventId: crypto.randomUUID() }) }, topics: string[] = []; let acked = false
    const hub = { events: async function* (signal: AbortSignal) { yield item; await waitForAbort(signal) }, ack: async () => { acked = true } }
    const modes: string[] = []
    const ntfy = { post: async (c: any, _e: any, _u: any, _q: any, signal: AbortSignal) => { topics.push(c.topic); modes.push(c.contentMode); if (topics.length === 1) await waitForAbort(signal) } }
    const engine = new RelayEngine(store, ntfy as any, () => hub as any), manager = new RelayManager(store, engine, ntfy as any)
    await engine.start(); for (let i = 0; i < 50 && topics.length < 1; i++) await Bun.sleep(1)
    await manager.configure(config({ revision: 2, topic: 'zyxwvutsrqponmlkjihgfe', contentMode: 'eventPreview' }), 1)
    for (let i = 0; i < 50 && !acked; i++) await Bun.sleep(1); await engine.stop()
    expect(topics).toEqual(['abcdefghijklmnopqrstuv', 'zyxwvutsrqponmlkjihgfe']); expect(modes).toEqual(['fixed', 'eventPreview']); expect(acked).toBeTrue(); expect((await store.load()).handled[item.event.eventId]?.reason).toBe('posted')
  })
  test('rotation requested during ledger write serializes, then ACK replay does not repost accepted event', async () => {
    const store = await activeStore(), item = { seq: 1, event: event({ eventId: crypto.randomUUID() }) }, originalUpdate = store.update.bind(store)
    let ledgerEntered!: () => void, releaseLedger!: () => void; const entered = new Promise<void>(r => { ledgerEntered = r }), release = new Promise<void>(r => { releaseLedger = r }); let gate = true
    store.update = ((mutate: any) => originalUpdate(async (state: any) => { const before = Object.keys(state.handled).length, result = await mutate(state); if (gate && Object.keys(state.handled).length > before) { gate = false; ledgerEntered(); await release } return result })) as any
    let posts = 0, ackAttempts = 0, acked = false, acceptedMode = ''
    const hub = { events: async function* (signal: AbortSignal) { yield item; await waitForAbort(signal) }, ack: async (_s: number, _e: string, signal: AbortSignal) => { ackAttempts++; if (ackAttempts === 1) await waitForAbort(signal); acked = true } }
    const ntfy = { post: async (c: any) => { posts++; acceptedMode = c.contentMode } }, engine = new RelayEngine(store, ntfy as any, () => hub as any), manager = new RelayManager(store, engine, ntfy as any)
    await engine.start(); await entered
    const rotation = manager.configure(config({ revision: 2, topic: 'zyxwvutsrqponmlkjihgfe', contentMode: 'eventPreview' }), 1); await Bun.sleep(1); releaseLedger(); await rotation
    for (let i = 0; i < 50 && !acked; i++) await Bun.sleep(1); await engine.stop()
    expect(posts).toBe(1); expect(acceptedMode).toBe('fixed'); expect(ackAttempts).toBe(2); expect(acked).toBeTrue(); expect((await store.load()).config?.contentMode).toBe('eventPreview')
  })
})
