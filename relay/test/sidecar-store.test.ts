import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SidecarStore } from '../src/sidecar-store'
import { event } from './helpers'

const stores: SidecarStore[] = []
async function store(now = () => Date.now()) { const root = await mkdtemp(join(tmpdir(), 'sidecar-')); const dir = join(root, 'state'); await mkdir(dir, { mode: 0o700 }); const s = new SidecarStore(join(dir, 'sidecar.sqlite'), now); stores.push(s); return s }
afterEach(() => { while (stores.length) stores.pop()!.close() })

describe('SidecarStore', () => {
  test('commits canonical event, delivery rows and source cursor atomically', async () => {
    const s = await store(); s.bindSource('https://hapi.example', 'ns'); const mac = s.createConsumer('mac'); s.ensureInternalConsumer('phone', 'ntfy')
    const candidate = { sourceKey: 'source/1', event: event() }
    expect(s.append(candidate, 'epoch:1')).toBe(1); expect(s.sourceCursor()).toBe('epoch:1')
    expect(s.pending(mac.consumerId)).toEqual([{ seq: 1, event: candidate.event }]); expect(s.pending('phone')).toHaveLength(1)
    expect(s.append(candidate, 'epoch:2')).toBeUndefined(); expect(s.sourceCursor()).toBe('epoch:2'); expect(s.highWater()).toBe(1)
  })
  test('auth stores only hash and ACK is ordered, exact and idempotent', async () => {
    const s = await store(); s.bindSource('https://hapi.example', 'ns'); const mac = s.createConsumer('mac')
    expect(s.authenticateConsumer(mac.consumerId, mac.token)).toBeTrue(); expect(s.db.query('SELECT credential_hash FROM consumers WHERE id=?').get(mac.consumerId)).not.toEqual({ credential_hash: mac.token })
    const one = event(), two = event(); s.append({ sourceKey: 'one', event: one }, '1'); s.append({ sourceKey: 'two', event: two }, '2')
    expect(s.ack(mac.consumerId, 2, two.eventId)).toBe('conflict')
    expect(s.ack(mac.consumerId, 1, 'wrong')).toBe('conflict')
    expect(s.ack(mac.consumerId, 1, one.eventId)).toBe('acked')
    expect(s.ack(mac.consumerId, 1, one.eventId)).toBe('idempotent')
    expect(s.pending(mac.consumerId).map(x => x.seq)).toEqual([2])
  })
  test('new consumer begins at high water without historical burst', async () => {
    const s = await store(); s.bindSource('https://hapi.example', 'ns'); s.append({ sourceKey: 'old', event: event() }, '1', [])
    const mac = s.createConsumer('mac'); expect(s.pending(mac.consumerId)).toEqual([])
    s.append({ sourceKey: 'new', event: event() }, '2'); expect(s.pending(mac.consumerId).map(x => x.seq)).toEqual([2])
  })
  test('hard expiry reports replay loss and bounds offline rows', async () => {
    let now = 40 * 24 * 3600_000; const s = await store(() => now); s.bindSource('https://hapi.example', 'ns'); const mac = s.createConsumer('mac')
    now = 0; s.append({ sourceKey: 'old', event: event({ createdAt: 0 }) }, '1')
    now = 40 * 24 * 3600_000; s.expire(); expect(s.pending(mac.consumerId)).toEqual([]); expect(s.status(mac.consumerId).replayExpired).toBeTrue()
  })
  test('creates private database file', async () => {
    const s = await store(); expect((await stat(s.path)).mode & 0o077).toBe(0)
  })
})
