import { describe, expect, test } from 'bun:test'
import { RelayManager } from '../src/manager'
import { createHandler } from '../src/server'
import { StateStore } from '../src/state'
import { statePath } from './helpers'
import { config } from './helpers'

describe('management API', () => {
  test('exposes minimal health and protects status', async () => {
    const store = new StateStore(await statePath()), manager = new RelayManager(store, { start: async () => {}, stop: async () => {} } as any)
    const handler = createHandler(manager)
    expect(await (await handler(new Request('https://relay/health'))).json()).toEqual({ ok: true, version: 1 })
    expect((await handler(new Request('https://relay/v1/status'))).status).toBe(401)
    const code = await manager.createPairCode()
    const pair = await handler(new Request('https://relay/v1/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) }))
    const token = (await pair.json() as any).managementToken
    const status = await handler(new Request('https://relay/v1/status', { headers: { authorization: `Bearer ${token}` } }))
    expect(status.status).toBe(200); expect(status.headers.get('cache-control')).toBe('no-store')
    expect((await status.json() as any).capabilities.notificationContentModes).toEqual(['fixed', 'eventPreview'])
  })
  test('status never returns topic, management bearer or Hub credential', async () => {
    const store = new StateStore(await statePath()), manager = new RelayManager(store, { start: async () => {}, stop: async () => {}, restart: async () => {} } as any)
    const code = await manager.createPairCode(), token = await manager.pair(code); await manager.configure(config(), 0)
    const response = await createHandler(manager)(new Request('https://relay/v1/status', { headers: { authorization: `Bearer ${token}` } }))
    const text = await response.text(); expect(text).not.toContain(config().topic); expect(text).not.toContain(token); expect(text).not.toContain('credential')
  })
  test('rejects oversized request before parsing', async () => {
    const store = new StateStore(await statePath()), manager = new RelayManager(store, {} as any), handler = createHandler(manager)
    const response = await handler(new Request('https://relay/v1/pair', { method: 'POST', headers: { 'content-length': '70000' }, body: '{}' }))
    expect(response.status).toBe(400)
  })
  test.each([
    ['/v1/pair', { code: 123 }], ['/v1/test', { sessionId: 123 }], ['/v1/pause', { paused: 'false' }]
  ])('does not coerce JSON types for %s', async (path, payload) => {
    const store = new StateStore(await statePath()), engine = { start: async () => {}, stop: async () => {}, restart: async () => {} }, manager = new RelayManager(store, engine as any), handler = createHandler(manager)
    const code = await manager.createPairCode(), token = await manager.pair(code)
    const response = await handler(new Request(`https://relay${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(payload) }))
    expect(response.status).toBe(400)
  })
})
