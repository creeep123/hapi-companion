import { describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { fsyncSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SourceContinuityJournal, readContinuityEvidence } from '../src/source-continuity'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'source-continuity-')), dir = join(root, 'private')
  await mkdir(dir, { mode: 0o700 })
  return join(dir, 'continuity.journal')
}

describe('source continuity journal', () => {
  test('derives a covered window from fsynced same-run live heartbeats', async () => {
    const path = await fixture(); let clock = 1000
    const journal = new SourceContinuityJournal(path, () => clock)
    journal.record('connecting'); journal.record('connected-ok'); journal.record('live')
    clock = 6000; journal.record('heartbeat')
    clock = 11_000; journal.record('heartbeat')
    expect(readContinuityEvidence(path, 2000, 10_000)).toBeUndefined()
    journal.close()
    expect(readContinuityEvidence(`${path}.sealed`, 2000, 10_000)).toEqual({ sourceState: 'live', gapCount: 0, observedFrom: 1000, observedThrough: 11_000 })
    expect(() => new SourceContinuityJournal(path)).toThrow('continuity_sealed_exists')
    const encoded = await readFile(`${path}.sealed`, 'utf8')
    for (const secret of ['sessionId', 'requestId', 'accessToken', 'body', 'topic']) expect(encoded).not.toContain(secret)
  })
  test('fails closed on a gap, disconnect, run restart, or missing end heartbeat', async () => {
    const path = await fixture(); let clock = 1000
    const first = new SourceContinuityJournal(path, () => clock)
    first.record('connecting'); first.record('connected-ok'); first.record('live')
    expect(readContinuityEvidence(path, 2000, 10_000)).toBeUndefined()
    clock = 4000; first.record('disconnect')
    clock = 4500; first.record('connecting'); first.record('connected-gap'); first.record('live')
    clock = 11_000; first.record('heartbeat')
    clock = 1; expect(() => first.record('heartbeat')).toThrow('continuity_clock_invalid')
    first.close()
    clock = 12_000
    const second = new SourceContinuityJournal(path, () => clock)
    second.record('connecting'); second.record('connected-ok'); second.record('live')
    clock = 18_000; second.record('heartbeat')
    second.close()
    expect(readContinuityEvidence(`${path}.sealed`, 2000, 17_000)).toBeUndefined()
  })
  test('rejects truncation, altered entries, unsafe permissions and clock rollback', async () => {
    const path = await fixture(); let clock = 1000
    const journal = new SourceContinuityJournal(path, () => clock)
    journal.record('connecting'); journal.record('connected-ok'); journal.record('live')
    clock = 5000; journal.record('heartbeat')
    journal.close()
    const sealed = `${path}.sealed`
    expect(readContinuityEvidence(sealed, 2000, 4000)).toBeDefined()
    await chmod(sealed, 0o644); expect(readContinuityEvidence(sealed, 2000, 4000)).toBeUndefined()
    await chmod(sealed, 0o600)
    const original = await readFile(sealed, 'utf8')
    await writeFile(sealed, original.replace('"connected-ok"', '"connected-gap"'))
    expect(readContinuityEvidence(sealed, 2000, 4000)).toBeUndefined()
    await writeFile(sealed, original.replace('"kind":"live"', '"kind":"live","sessionId":"should-not-appear"'))
    expect(readContinuityEvidence(sealed, 2000, 4000)).toBeUndefined()
    await writeFile(sealed, original.slice(0, -2))
    expect(readContinuityEvidence(sealed, 2000, 4000)).toBeUndefined()
  })
  test('does not accept a live marker without a connection verdict in that run', async () => {
    const path = await fixture(); let clock = 1000
    const journal = new SourceContinuityJournal(path, () => clock)
    journal.record('live')
    clock = 5000; journal.record('heartbeat')
    journal.close()
    expect(readContinuityEvidence(`${path}.sealed`, 2000, 4000)).toBeUndefined()
  })
  test('rejects a long heartbeat silence even when a late end heartbeat exists', async () => {
    const path = await fixture(); let clock = 1000
    const journal = new SourceContinuityJournal(path, () => clock)
    journal.record('connecting'); journal.record('connected-ok'); journal.record('live')
    clock = 6000; journal.record('heartbeat')
    clock = 25_000; journal.record('heartbeat')
    journal.close()
    expect(readContinuityEvidence(`${path}.sealed`, 2000, 24_000)).toBeUndefined()
  })
  test('a complete heartbeat write followed by sync failure never seals the journal', async () => {
    const path = await fixture(); let clock = 1000, failSync = false
    const journal = new SourceContinuityJournal(path, () => clock, fd => {
      if (failSync) throw new Error('synthetic_fsync_failure')
      fsyncSync(fd)
    })
    journal.record('connecting'); journal.record('connected-ok'); journal.record('live')
    clock = 6000; journal.record('heartbeat')
    clock = 11_000; failSync = true
    expect(() => journal.record('heartbeat')).toThrow('synthetic_fsync_failure')
    failSync = false; journal.close()
    expect(readContinuityEvidence(`${path}.sealed`, 2000, 10_000)).toBeUndefined()
    expect(await readFile(path, 'utf8')).toContain('"kind":"heartbeat"')
  })
})
