import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { compareSnapshotFiles, type CompareOptions } from '../src/phase-b-compare'
import { SidecarStore } from '../src/sidecar-store'
import { SourceContinuityJournal } from '../src/source-continuity'
import { event } from './helpers'

const stores: SidecarStore[] = [], hubs: Database[] = []
afterEach(() => { while (stores.length) stores.pop()!.close(); while (hubs.length) hubs.pop()!.close() })
const kinds = ['ready', 'session-completed', 'task-notification', 'permission-request', 'input-request'] as const
const namespace = 'private-namespace', session = 'private-session', base = 1_800_000_000_000
const options = (): CompareOptions => ({ from: base - 100, through: base + 10_000, toleranceMs: 500,
  continuity: { sourceState: 'live', gapCount: 0, observedFrom: base - 100, observedThrough: base + 10_000 }, key: new TextEncoder().encode('x'.repeat(32)) })

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'phase-b-')), dir = join(root, 'state'); await mkdir(dir, { mode: 0o700 })
  const sidecarPath = join(dir, 'sidecar.sqlite'), hubPath = join(dir, 'hub.sqlite')
  const sidecar = new SidecarStore(sidecarPath); stores.push(sidecar)
  sidecar.bindSource('https://hapi.example', createHash('sha256').update(namespace).digest('hex'))
  const hub = new Database(hubPath, { create: true }); hubs.push(hub)
  hub.exec('CREATE TABLE companion_notification_outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT UNIQUE,namespace TEXT,payload_json TEXT,created_at INTEGER,expires_at INTEGER)')
  const add = (kind: typeof kinds[number], at: number, requestId?: string, only?: 'sidecar' | 'hub', sessionId = session) => {
    const common = { kind, createdAt: at, sessionId, sessionName: 'Private title', body: 'Private body', title: 'Private heading', ...(requestId ? { requestId } : {}) }
    if (only !== 'hub') sidecar.append({ sourceKey: `source-${crypto.randomUUID()}`, event: event({ ...common }) }, `cursor-${at}`, [])
    if (only !== 'sidecar') {
      const payload = event({ ...common, eventId: crypto.randomUUID() })
      hub.query('INSERT INTO companion_notification_outbox(event_id,namespace,payload_json,created_at,expires_at) VALUES(?,?,?,?,?)')
        .run(payload.eventId, namespace, JSON.stringify(payload), at, at + 100_000)
    }
  }
  const compare = (override?: Partial<CompareOptions>) => compareSnapshotFiles(sidecarPath, hubPath, { ...options(), ...override })
  return { sidecar, hub, add, compare, sidecarPath, hubPath }
}

describe('offline Phase B event comparator', () => {
  test('matches five kinds one-to-one within tolerance and emits no identifiers or content', async () => {
    const f = await fixture(); kinds.forEach((kind, i) => {
      f.add(kind, base + i * 1000, kind.endsWith('request') ? `private-request-${i}` : undefined, 'sidecar')
      f.add(kind, base + i * 1000 + 200, kind.endsWith('request') ? `private-request-${i}` : undefined, 'hub')
    })
    const before = createHash('sha256').update(await readFile(f.hubPath)).digest('hex')
    const result = f.compare(), encoded = JSON.stringify(result)
    expect(result.verdict).toBe('PASS'); expect(result.kinds.every(row => row.matched === 1)).toBeTrue()
    expect(result.timingMs).toEqual({ max: 200, median: 200, p95: 200 })
    for (const secret of [namespace, session, 'private-request', 'Private title', 'Private body', 'Private heading', f.hubPath]) expect(encoded).not.toContain(secret)
    expect(createHash('sha256').update(await readFile(f.hubPath)).digest('hex')).toBe(before)
    expect(f.sidecar.db.query('SELECT COUNT(*) AS count FROM deliveries').get()).toEqual({ count: 0 })
  })
  test('accepts ordinary long notification text without disclosing it', async () => {
    const f = await fixture(); f.add('ready', base)
    const longBody = 'Private body '.repeat(100)
    f.hub.query('UPDATE companion_notification_outbox SET payload_json=json_set(payload_json,\'$.body\',?)').run(longBody)
    const result = f.compare()
    expect(result).toMatchObject({ verdict: 'INDETERMINATE', reason: 'incomplete_kinds' })
    expect(JSON.stringify(result)).not.toContain(longBody)
  })
  test('fails on a time delta beyond the predeclared tolerance', async () => {
    const f = await fixture(); f.add('ready', base, undefined, 'sidecar'); f.add('ready', base + 501, undefined, 'hub')
    expect(f.compare().verdict).toBe('FAIL'); expect(f.compare().kinds[0]).toMatchObject({ sidecarOnly: 1, hubOnly: 1 })
    expect(f.compare({ toleranceMs: 5001 })).toMatchObject({ verdict: 'INDETERMINATE', reason: 'invalid_snapshot' })
  })
  test('does not match different request IDs or confuse input with permission', async () => {
    const f = await fixture(); f.add('input-request', base, 'ask-one', 'sidecar'); f.add('input-request', base + 1, 'ask-two', 'hub')
    expect(f.compare().verdict).toBe('FAIL')
    const g = await fixture(); g.add('input-request', base, 'same', 'sidecar'); g.add('permission-request', base + 1, 'same', 'hub')
    expect(g.compare().verdict).toBe('FAIL')
  })
  test('fails closed on duplicate request identity or extra semantic event', async () => {
    const f = await fixture(); f.add('permission-request', base, 'approve'); f.add('permission-request', base + 1, 'approve', 'sidecar')
    expect(f.compare()).toMatchObject({ verdict: 'INDETERMINATE', reason: 'invalid_snapshot' })
    const g = await fixture(); g.add('ready', base); g.add('ready', base + 1000, undefined, 'sidecar')
    expect(g.compare()).toMatchObject({ verdict: 'FAIL', reason: 'mismatch' })
  })
  test('does not claim parity when repeated ready events admit multiple pairings', async () => {
    const f = await fixture()
    f.add('ready', base, undefined, 'sidecar'); f.add('ready', base + 200, undefined, 'sidecar')
    f.add('ready', base + 100, undefined, 'hub'); f.add('ready', base + 300, undefined, 'hub')
    expect(f.compare()).toMatchObject({ verdict: 'INDETERMINATE', reason: 'ambiguous_match' })
  })
  test('fails closed on gap, missing continuity or source attention even if events match', async () => {
    const f = await fixture(); f.add('ready', base)
    expect(f.compare({ continuity: { ...options().continuity, gapCount: 1 } })).toMatchObject({ verdict: 'INDETERMINATE', reason: 'source_gap_or_unverified' })
    expect(f.compare({ continuity: { ...options().continuity, observedThrough: base } })).toMatchObject({ verdict: 'INDETERMINATE', reason: 'source_gap_or_unverified' })
    f.sidecar.sourceHealth('attention', 'source_gap')
    expect(f.compare()).toMatchObject({ verdict: 'INDETERMINATE', reason: 'source_gap_or_unverified' })
  })
  test('does not treat absent rare kinds as a full Phase B pass', async () => {
    const f = await fixture(); f.add('ready', base)
    expect(f.compare()).toMatchObject({ verdict: 'INDETERMINATE', reason: 'incomplete_kinds' })
  })
  test('rejects malformed schema or payload without echoing private data', async () => {
    const f = await fixture(); f.add('ready', base)
    f.hub.exec('DROP TABLE companion_notification_outbox')
    const result = f.compare()
    expect(result).toMatchObject({ verdict: 'INDETERMINATE', reason: 'invalid_snapshot' })
    expect(JSON.stringify(result)).not.toContain(f.hubPath)
  })
  test('refuses an unknown future event contract version', async () => {
    const f = await fixture(); f.add('ready', base)
    f.hub.query('UPDATE companion_notification_outbox SET payload_json=json_set(payload_json,\'$.version\',2)').run()
    expect(f.compare()).toMatchObject({ verdict: 'INDETERMINATE', reason: 'invalid_snapshot' })
  })
  test('CLI reads offline snapshots with private files and emits only a safe summary', async () => {
    const f = await fixture(); kinds.forEach((kind, index) => f.add(kind, base + index * 1000, kind.endsWith('request') ? `request-${index}` : undefined))
    const keyPath = join(dirname(f.hubPath), 'key'), continuityPath = join(dirname(f.hubPath), 'continuity.journal')
    await writeFile(keyPath, new Uint8Array(32).fill(77)); await chmod(keyPath, 0o600)
    let clock = options().from - 100
    const journal = new SourceContinuityJournal(continuityPath, () => clock)
    journal.record('connecting'); journal.record('connected-ok'); journal.record('live')
    clock = options().from + 5000; journal.record('heartbeat')
    clock = options().through + 100; journal.record('heartbeat'); journal.close()
    await chmod(f.sidecarPath, 0o600); await chmod(f.hubPath, 0o600)
    const script = resolve(import.meta.dir, '../src/phase-b-compare-cli.ts')
    const run = async () => {
      const child = Bun.spawn([process.execPath, 'run', script, f.sidecarPath, f.hubPath, keyPath, continuityPath,
        String(options().from), String(options().through), '5000'], { stdout: 'pipe', stderr: 'pipe' })
      const code = await child.exited, output = await new Response(child.stdout).text()
      return { code, output, error: await new Response(child.stderr).text() }
    }
    const pass = await run(); expect(pass.code).toBe(0); expect(JSON.parse(pass.output)).toMatchObject({ verdict: 'PASS', reason: 'matched' }); expect(pass.error).toBe('')
    for (const secret of [namespace, session, 'Private title', 'Private body', f.sidecarPath]) expect(pass.output).not.toContain(secret)
    const journalBytes = await readFile(continuityPath)
    await writeFile(continuityPath, JSON.stringify(options().continuity))
    const selfReport = await run(); expect(selfReport.code).toBe(2)
    expect(JSON.parse(selfReport.output)).toMatchObject({ verdict: 'INDETERMINATE', reason: 'source_gap_or_unverified' })
    await writeFile(continuityPath, journalBytes)
    await chmod(keyPath, 0o644)
    const rejected = await run(); expect(rejected.code).toBe(2); expect(JSON.parse(rejected.output)).toEqual({ version: 1, verdict: 'INDETERMINATE', reason: 'invalid_inputs' })
    expect(rejected.error).toBe('')
    await chmod(keyPath, 0o600); await chmod(f.hubPath, 0o644)
    const exposedSnapshot = await run(); expect(exposedSnapshot.code).toBe(2)
    expect(JSON.parse(exposedSnapshot.output)).toEqual({ version: 1, verdict: 'INDETERMINATE', reason: 'invalid_inputs' })
  })
})
