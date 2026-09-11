import { describe, expect, test } from 'bun:test'
import { stat } from 'node:fs/promises'
import { StateStore } from '../src/state'
import { statePath } from './helpers'

describe('StateStore', () => {
  test('atomically persists mode 0600 and serializes updates', async () => {
    const path = await statePath(), store = new StateStore(path)
    await Promise.all(Array.from({ length: 10 }, (_, i) => store.update(s => { s.handled[`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`] = { seq: i + 1, at: 1, reason: 'posted' } })))
    expect(Object.keys((await store.load()).handled)).toHaveLength(10)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
  })
  test('rejects unknown schema', async () => {
    const path = await statePath(), store = new StateStore(path)
    await Bun.write(path, '{"schemaVersion":99}')
    await expect(store.load()).rejects.toThrow('unsupported state schema')
  })
  test('preflight accepts private owned directory and rejects broad permissions', async () => {
    const path = await statePath(), store = new StateStore(path); await store.preflight()
    const { chmod } = await import('node:fs/promises'); await chmod(path.substring(0, path.lastIndexOf('/')), 0o755)
    await expect(store.preflight()).rejects.toThrow('state_directory_permissions')
  })
  test('rejects committed activation whose credential belongs to another device', async () => {
    const path = await statePath(), store = new StateStore(path)
    await store.update(s => {
      s.config = { receiverId: 'r', revision: 1, hapiOrigin: 'https://hapi.example', ntfyBaseUrl: 'https://ntfy.sh', topic: 'abcdefghijklmnopqrstuv', policy: { scope: 'all', selectedSessionIds: [], keywords: [], durationEnabled: false, minimumMinutes: 1, quietEnabled: false, quietStartMinutes: 0, quietEndMinutes: 0, quietMode: 'mute', timeZone: 'UTC' } }
      s.credential = { deviceId: '11111111-1111-4111-8111-111111111111', token: 'x'.repeat(40) }
      s.activation = { activationId: '22222222-2222-4222-8222-222222222222', installationId: '33333333-3333-4333-8333-333333333333', deviceId: '44444444-4444-4444-8444-444444444444', status: 'committed', requestFingerprint: 'a'.repeat(64) }
      s.enabled = true
    })
    await expect(store.load()).rejects.toThrow('invalid committed activation')
  })
})
