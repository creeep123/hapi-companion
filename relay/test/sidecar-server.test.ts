import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConsumerBroker } from '../src/consumer-broker'
import { RelayManager } from '../src/manager'
import { createHandler } from '../src/server'
import { SidecarManager } from '../src/sidecar-manager'
import { createSidecarHandler } from '../src/sidecar-server'
import { SidecarStore } from '../src/sidecar-store'
import { StateStore } from '../src/state'
const dbs: SidecarStore[] = []
async function setup() { const root = await mkdtemp(join(tmpdir(), 'sidecar-server-')); const dir = join(root, 'state'); await mkdir(dir, { mode: 0o700 }); const state = new StateStore(join(dir, 'state.json')); const relay = new RelayManager(state, { start: async () => {}, stop: async () => {} } as any); const db = new SidecarStore(join(dir, 'db')); dbs.push(db); db.bindSource('https://hapi.example', 'ns'); const manager = new SidecarManager(relay, db, 'https://hapi.example', 'https://relay.example'); return { relay, db, handler: createSidecarHandler(new ConsumerBroker(db), manager, createHandler(relay)) } }
afterEach(() => { while (dbs.length) dbs.pop()!.close() })
describe('Sidecar management API', () => {
  test('uses existing one-time pairing then issues a scoped consumer once', async () => {
    const { relay, db, handler } = await setup(); const code = await relay.createPairCode(); const pair = await handler(new Request('https://relay/v1/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })); const management = (await pair.json() as any).managementToken
    const response = await handler(new Request('https://relay/v2/consumers', { method: 'POST', headers: { authorization: `Bearer ${management}`, 'content-type': 'application/json' }, body: JSON.stringify({ installationId: '11111111-1111-4111-8111-111111111111', name: 'Mac', publicHapiOrigin: 'https://hapi.example' }) }))
    expect(response.status).toBe(201); const value = await response.json() as any; expect(value).toMatchObject({ publicHapiOrigin: 'https://hapi.example', sidecarAPIOrigin: 'https://relay.example', contractVersion: 1 }); expect(db.authenticateConsumer(value.consumerId, value.token)).toBeTrue()
  })
  test('rejects mismatched public HAPI origin', async () => {
    const { relay, handler } = await setup(); const token = await relay.pair(await relay.createPairCode()); const response = await handler(new Request('https://relay/v2/consumers', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ installationId: '11111111-1111-4111-8111-111111111111', name: 'Mac', publicHapiOrigin: 'https://evil.example' }) })); expect(response.status).toBe(400)
  })
})
