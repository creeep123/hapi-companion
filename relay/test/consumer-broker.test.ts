import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConsumerBroker } from '../src/consumer-broker'
import { SidecarStore } from '../src/sidecar-store'
import { event } from './helpers'

const stores: SidecarStore[] = []
async function setup() { const root = await mkdtemp(join(tmpdir(), 'broker-')); const dir = join(root, 'state'); await mkdir(dir, { mode: 0o700 }); const store = new SidecarStore(join(dir, 'db')); stores.push(store); store.bindSource('https://hapi.example', 'ns'); const credential = store.createConsumer('mac'); return { store, credential, broker: new ConsumerBroker(store) } }
afterEach(() => { while (stores.length) stores.pop()!.close() })
const request = (path: string, credential: { consumerId: string; token: string }, init: RequestInit = {}) => new Request(`https://relay${path}`, { ...init, headers: { authorization: `Bearer ${credential.token}`, 'x-hapi-device-id': credential.consumerId, ...init.headers } })

describe('ConsumerBroker', () => {
  test('protects data plane and serves compatible catalog/status', async () => {
    const { store, credential, broker } = await setup(); store.replaceCatalog([{ id: 's1', title: 'One', active: true, updatedAt: 4 }])
    expect((await broker.handler(new Request('https://relay/companion/sessions')))?.status).toBe(401)
    expect(await (await broker.handler(request('/companion/sessions', credential)))!.json()).toEqual({ version: 1, capabilities: { turnDuration: true }, sessions: [{ id: 's1', title: 'One', updatedAt: 4, active: true }] })
    expect(await (await broker.handler(request('/companion/status', credential)))!.json()).toMatchObject({ version: 1, replayExpired: false, highWaterSeq: 0 })
  })
  test('streams legacy connected frame and canonical notification then ACKs exactly', async () => {
    const { store, credential, broker } = await setup(); const item = event(); store.append({ sourceKey: 'one', event: item }, 'e1')
    const response = await broker.handler(request('/companion/events', credential)); expect(response?.headers.get('content-type')).toContain('text/event-stream')
    const reader = response!.body!.getReader(), decoder = new TextDecoder(); let text = ''
    while (!text.includes('event: notification')) text += decoder.decode((await reader.read()).value)
    expect(text).toStartWith('event: connected\ndata: {}\n\n'); expect(text).toContain('id: 1\nevent: notification')
    const ack = await broker.handler(request('/companion/ack', credential, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seq: 1, eventId: item.eventId }) }))
    expect(ack?.status).toBe(200); expect(store.pending(credential.consumerId)).toEqual([]); await reader.cancel()
  })
  test('rejects skipped or mismatched ACK', async () => {
    const { store, credential, broker } = await setup(); store.append({ sourceKey: 'one', event: event() }, 'e1')
    const ack = await broker.handler(request('/companion/ack', credential, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seq: 2, eventId: crypto.randomUUID() }) }))
    expect(ack?.status).toBe(409)
  })
})
