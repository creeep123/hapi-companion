import { describe, expect, test } from 'bun:test'
import { RelayManager } from '../src/manager'
import { StateStore } from '../src/state'
import { config, statePath } from './helpers'

class Engine { starts = 0; stops = 0; async start() { this.starts++ } async stop() { this.stops++ } async restart() { await this.stop(); await this.start() } }
class Ntfy { posts = 0; clicks: string[] = []; configs: any[] = []; async post(config: unknown, _event: unknown, click: string) { this.posts++; this.configs.push(config); this.clicks.push(click) } }
const activation = { activationId: '11111111-1111-4111-8111-111111111111', installationId: '22222222-2222-4222-8222-222222222222', deviceId: '33333333-3333-4333-8333-333333333333', token: 'x'.repeat(40), revision: 1 }
async function setup() { const store = new StateStore(await statePath()), engine = new Engine(), ntfy = new Ntfy(); return { store, engine, ntfy, manager: new RelayManager(store, engine as any, ntfy as any) } }

describe('RelayManager', () => {
  test('pair code is single use and only token hash persists', async () => {
    const { manager, store } = await setup(); const code = await manager.createPairCode(); const token = await manager.pair(code)
    expect(await manager.authorized(token)).toBeTrue(); expect(JSON.stringify(await store.load())).not.toContain(token)
    await expect(manager.pair(code)).rejects.toThrow()
  })
  test('failed pairing attempts are durably limited', async () => {
    const { manager, store } = await setup(); await manager.createPairCode()
    for (let i = 0; i < 3; i++) await manager.pair('wrong').catch(() => undefined)
    expect((await store.load()).bootstrap?.failures).toBe(3)
  })
  test('config uses revision CAS and hides no state invariants', async () => {
    const { manager } = await setup(); await manager.configure(config(), 0)
    await expect(manager.configure(config({ revision: 2 }), 0)).rejects.toMatchObject({ revision: 1 })
    await expect(manager.configure(config({ revision: 3 }), 1)).rejects.toMatchObject({ revision: 1 })
    await expect(manager.configure(config({ revision: 2, receiverId: 'other' }), 1)).rejects.toMatchObject({ revision: 1 })
    await expect(manager.configure({ ...config({ revision: 2 }), contentMode: 'unknown' }, 1)).rejects.toThrow('invalid content mode')
    await expect(manager.configure({ ...config({ revision: 2 }), contentMode: false }, 1)).rejects.toThrow('invalid content mode')
  })
  test('activation is committed before engine start and same id is idempotent', async () => {
    const { manager, store, engine } = await setup(); await manager.configure(config(), 0)
    await manager.activate(activation); await manager.activate(activation)
    expect(engine.starts).toBe(2); expect((await store.load()).credential?.token).toBe('x'.repeat(40))
    await expect(manager.activate({ ...activation, activationId: '44444444-4444-4444-8444-444444444444' })).rejects.toThrow('conflict')
    await expect(manager.activate({ ...activation, token: 'y'.repeat(40) })).rejects.toThrow('conflict')
    await expect(manager.activate({ ...activation, deviceId: '55555555-5555-4555-8555-555555555555' })).rejects.toThrow('conflict')
    await expect(manager.activate({ ...activation, revision: 2 })).rejects.toThrow('conflict')
  })
  test('pause and remove clear receiver secrets but preserve pairing', async () => {
    const { manager, store, engine } = await setup(); const code = await manager.createPairCode(); await manager.pair(code); await manager.configure(config(), 0)
    await manager.activate(activation); await manager.pause(true); expect((await store.load()).paused).toBeTrue()
    await manager.remove(); const state = await store.load(); expect(engine.stops).toBe(1); expect(state.credential).toBeUndefined(); expect(state.config).toBeUndefined(); expect(state.managementTokenHash).toBeDefined()
    await manager.remove()
    await manager.unpair(); expect((await store.load()).managementTokenHash).toBeUndefined()
  })
  test('test uses a real caller supplied session id', async () => {
    const { manager, ntfy } = await setup(); await manager.configure(config(), 0); await manager.test('real-session')
    expect(ntfy.posts).toBe(1)
    expect(ntfy.clicks).toEqual(['https://hapi.example/sessions/real-session'])
    expect(ntfy.configs[0].contentMode).toBe('fixed')
  })
  test('explicit repair rotates an invalid committed Hub credential', async () => {
    const { manager, store } = await setup(); await manager.configure(config(), 0)
    await manager.activate(activation)
    const newer = { ...activation, deviceId: '55555555-5555-4555-8555-555555555555', token: 'n'.repeat(40) }
    await manager.repair(newer)
    expect((await store.load()).credential).toEqual({ deviceId: newer.deviceId, token: newer.token })
  })
  test('config change restarts active engine and explicit resume restarts attention', async () => {
    const { manager, engine } = await setup(); await manager.configure(config(), 0); await manager.activate(activation)
    await manager.configure(config({ revision: 2 }), 1); await manager.resume()
    expect(engine.stops).toBe(2); expect(engine.starts).toBe(3)
  })
})
