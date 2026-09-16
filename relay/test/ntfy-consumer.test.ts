import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NtfyConsumer } from '../src/ntfy-consumer'
import { SidecarStore } from '../src/sidecar-store'
import { StateStore } from '../src/state'
import { config, event } from './helpers'

const dbs: SidecarStore[] = []
async function setup(ntfy: any) { const root = await mkdtemp(join(tmpdir(), 'ntfy-consumer-')); const dir = join(root, 'state'); await mkdir(dir, { mode: 0o700 }); const sidecar = new SidecarStore(join(dir, 'db')); dbs.push(sidecar); sidecar.bindSource('https://hapi.example', 'ns'); const state = new StateStore(join(dir, 'state.json')); await state.save({ schemaVersion: 1, enabled: true, paused: false, handled: {}, health: { stream: 'connected' }, config: config(), credential: { deviceId: '11111111-1111-4111-8111-111111111111', token: 'x'.repeat(40) }, activation: { activationId: '22222222-2222-4222-8222-222222222222', installationId: '33333333-3333-4333-8333-333333333333', deviceId: '11111111-1111-4111-8111-111111111111', status: 'committed', requestFingerprint: 'a'.repeat(64) } }); return { sidecar, state, worker: new NtfyConsumer(sidecar, state, ntfy) } }
afterEach(() => { while (dbs.length) dbs.pop()!.close() })
describe('NtfyConsumer', () => {
  test('posts independently and marks provider acceptance', async () => {
    let posts = 0; const { sidecar, worker } = await setup({ post: async () => { posts++ } }); const item = event(); sidecar.append({ sourceKey: 'one', event: item }, '1'); worker.start()
    for (let i = 0; i < 20 && posts === 0; i++) await Bun.sleep(5)
    expect(posts).toBe(1); expect(sidecar.pending(worker.consumerId)).toEqual([]); worker.stop()
  })
  test('policy suppression is terminal without provider post', async () => {
    let posts = 0; const { sidecar, state, worker } = await setup({ post: async () => { posts++ } }); await state.update(s => { s.config!.policy = { ...s.config!.policy, scope: 'specified', selectedSessionIds: [], keywords: [] } }); sidecar.append({ sourceKey: 'one', event: event() }, '1'); worker.start(); await Bun.sleep(20)
    expect(posts).toBe(0); expect(sidecar.pending(worker.consumerId)).toEqual([]); worker.stop()
  })
})
