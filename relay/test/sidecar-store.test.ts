import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdir, mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
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
  test('commits every candidate and interpreter checkpoint from one upstream frame together', async () => {
    const s = await store(); s.bindSource('https://hapi.example', 'ns'); const mac = s.createConsumer('mac')
    const one = event(), two = event({ eventId: '22222222-2222-4222-8222-222222222222', requestId: 'second' })
    const state = { version: 1 as const, sessions: [{ session: { id: 's1', active: true }, requestIds: ['one', 'second'] }] }
    expect(s.commitObservation([{ sourceKey: 'one', event: one }, { sourceKey: 'two', event: two }], 'epoch:2', state)).toEqual([1, 2])
    expect(s.pending(mac.consumerId).map(item => item.seq)).toEqual([1, 2]); expect(s.sourceCursor()).toBe('epoch:2'); expect(s.interpreterState()).toEqual(state)
  })
  test('rolls back every candidate, checkpoint, and cursor when a later candidate fails', async () => {
    const s = await store(); s.bindSource('https://hapi.example', 'ns'); const mac = s.createConsumer('mac')
    const duplicate = event({ eventId: '22222222-2222-4222-8222-222222222222' })
    const state = { version: 1 as const, sessions: [{ session: { id: 's1', active: true }, requestIds: [] }] }
    expect(() => s.commitObservation([{ sourceKey: 'one', event: duplicate }, { sourceKey: 'two', event: duplicate }], 'epoch:2', state)).toThrow()
    expect(s.pending(mac.consumerId)).toEqual([]); expect(s.highWater()).toBe(0); expect(s.sourceCursor()).toBeUndefined(); expect(s.interpreterState()).toBeUndefined()
    expect(s.db.query('SELECT COUNT(*) AS count FROM source_dedup').get()).toEqual({ count: 0 })
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
    now = 20 * 24 * 3600_000; s.append({ sourceKey: 'newer', event: event({ eventId: '22222222-2222-4222-8222-222222222222', createdAt: now }) }, '2')
    now = 40 * 24 * 3600_000; s.expire(); expect(s.pending(mac.consumerId)).toEqual([]); expect(s.status(mac.consumerId).replayExpired).toBeTrue()
  })
  test('creates private database file', async () => {
    const s = await store(); expect((await stat(s.path)).mode & 0o077).toBe(0)
  })
  test('refuses an event transaction when storage is over the hard threshold', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sidecar-limit-')), dir = join(root, 'state'); await mkdir(dir, { mode: 0o700 }); const s = new SidecarStore(join(dir, 'sidecar.sqlite'), () => Date.now(), 1); stores.push(s); s.bindSource('https://hapi.example', 'ns')
    expect(() => s.append({ sourceKey: 'blocked', event: event() }, 'cursor')).toThrow('storage_limit'); expect(s.sourceCursor()).toBeUndefined(); expect(s.highWater()).toBe(0)
  })
  test('creates an integrity-checked SQLite snapshot including committed rows', async () => {
    const s = await store(); s.bindSource('https://hapi.example', 'ns'); s.append({ sourceKey: 'one', event: event() }, 'cursor', [])
    const destination = join(dirname(s.path), 'backup.sqlite'); s.backup(destination)
    const restored = new SidecarStore(destination); stores.push(restored); expect(restored.highWater()).toBe(1); expect(restored.sourceCursor()).toBe('cursor'); expect((await stat(destination)).mode & 0o077).toBe(0)
  })
  test('rejects a symlink database target', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sidecar-link-')), dir = join(root, 'state'); await mkdir(dir, { mode: 0o700 })
    const target = join(dir, 'target'); await Bun.write(target, 'not sqlite'); await import('node:fs/promises').then(fs => fs.symlink(target, join(dir, 'db')))
    expect(() => new SidecarStore(join(dir, 'db'))).toThrow('sidecar_db_file_unsafe')
  })
  test('migrates a version-one consumer table and binds its namespace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sidecar-v1-')), dir = join(root, 'state'); await mkdir(dir, { mode: 0o700 }); const path = join(dir, 'db')
    const legacy = new Database(path, { create: true }); legacy.exec(`
      CREATE TABLE schema_meta(version INTEGER NOT NULL); INSERT INTO schema_meta VALUES(1);
      CREATE TABLE consumers(id TEXT PRIMARY KEY,kind TEXT NOT NULL,credential_hash TEXT,enabled INTEGER NOT NULL DEFAULT 1,ack_seq INTEGER NOT NULL DEFAULT 0,last_seen_at INTEGER NOT NULL,replay_expired INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL);
      INSERT INTO consumers(id,kind,credential_hash,last_seen_at,created_at) VALUES('legacy','mac',NULL,0,0);
    `); legacy.close()
    const s = new SidecarStore(path); stores.push(s); s.bindSource('https://hapi.example', 'namespace')
    expect(s.db.query('SELECT version FROM schema_meta').get()).toEqual({ version: 2 })
    expect(s.db.query("SELECT namespace_hash FROM consumers WHERE id='legacy'").get()).toEqual({ namespace_hash: 'namespace' })
  })
})
