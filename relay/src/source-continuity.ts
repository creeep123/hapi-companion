import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, writeSync, constants } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import type { ContinuityEvidence } from './phase-b-compare'

export type ContinuityKind = 'run-start' | 'connecting' | 'connected-ok' | 'connected-gap' | 'live' | 'heartbeat' | 'disconnect' | 'attention' | 'stop'
type Entry = { version: 1; seq: number; runId: string; at: number; kind: ContinuityKind; prev: string; hash: string }
const ZERO = '0'.repeat(64), MAX_BYTES = 128 * 1024
const KINDS: ContinuityKind[] = ['run-start', 'connecting', 'connected-ok', 'connected-gap', 'live', 'heartbeat', 'disconnect', 'attention', 'stop']
const validTime = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0
const hashOf = (entry: Omit<Entry, 'hash'>) => createHash('sha256').update(JSON.stringify(entry)).digest('hex')

function privateFile(path: string, allowMissing = false) {
  if (!isAbsolute(path)) throw new Error('continuity_path_invalid')
  const directory = lstatSync(dirname(path))
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0 ||
    (typeof process.getuid === 'function' && directory.uid !== process.getuid())) throw new Error('continuity_directory_unsafe')
  if (allowMissing && !existsSync(path)) return
  const file = lstatSync(path)
  if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o077) !== 0 ||
    (typeof process.getuid === 'function' && file.uid !== process.getuid()) || file.size > MAX_BYTES) throw new Error('continuity_file_unsafe')
}

function readEntries(value: string): Entry[] {
  if (value.length > MAX_BYTES || (value && !value.endsWith('\n'))) throw new Error('continuity_truncated')
  const entries: Entry[] = []
  let currentRun: string | undefined, stopped = false
  const seenRuns = new Set<string>()
  for (const line of value.split('\n').filter(Boolean)) {
    const entry = JSON.parse(line) as Entry, prior = entries.at(-1)
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
      Object.keys(entry).sort().join(',') !== 'at,hash,kind,prev,runId,seq,version' ||
      entry.version !== 1 || entry.seq !== entries.length + 1 || typeof entry.runId !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(entry.runId) || !validTime(entry.at) || !KINDS.includes(entry.kind) ||
      entry.prev !== (prior?.hash ?? ZERO) || entry.hash !== hashOf({ version: 1, seq: entry.seq, runId: entry.runId, at: entry.at, kind: entry.kind, prev: entry.prev }) ||
      (prior && entry.at < prior.at)) throw new Error('continuity_invalid')
    if (entry.kind === 'run-start') {
      if (seenRuns.has(entry.runId)) throw new Error('continuity_invalid')
      seenRuns.add(entry.runId); currentRun = entry.runId; stopped = false
    } else if (entry.runId !== currentRun || stopped) throw new Error('continuity_invalid')
    if (entry.kind === 'stop') stopped = true
    entries.push(entry)
  }
  return entries
}

/** Optional private, fsynced, content-free source transition journal. No HAPI polling or database migration. */
export class SourceContinuityJournal {
  private readonly fd: number
  private readonly runId = randomUUID()
  private entries: Entry[]
  private closed = false
  constructor(readonly path: string, private readonly now = () => Date.now()) {
    privateFile(path, true)
    this.fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW, 0o600)
    try {
      const file = fstatSync(this.fd)
      if (!file.isFile() || (file.mode & 0o077) !== 0 || file.size > MAX_BYTES ||
        (typeof process.getuid === 'function' && file.uid !== process.getuid())) throw new Error('continuity_file_unsafe')
      this.entries = readEntries(readFileSync(this.fd, { encoding: 'utf8' }))
      this.record('run-start')
    } catch (error) { closeSync(this.fd); throw error }
  }
  record(kind: ContinuityKind) {
    if (this.closed || !KINDS.includes(kind)) throw new Error('continuity_closed_or_invalid')
    const at = this.now(), prior = this.entries.at(-1)
    if (!validTime(at) || (prior && at < prior.at)) throw new Error('continuity_clock_invalid')
    const unsigned = { version: 1 as const, seq: this.entries.length + 1, runId: this.runId, at, kind, prev: prior?.hash ?? ZERO }
    const entry = { ...unsigned, hash: hashOf(unsigned) }, line = `${JSON.stringify(entry)}\n`
    if (fstatSync(this.fd).size + Buffer.byteLength(line) > MAX_BYTES) throw new Error('continuity_full')
    writeSync(this.fd, line); fsyncSync(this.fd); this.entries.push(entry)
  }
  close() { if (!this.closed) { try { this.record('stop') } finally { this.closed = true; closeSync(this.fd) } } }
}

/** A proof covers a window only when one run stays live and heartbeats through its end. */
export function readContinuityEvidence(path: string, from: number, through: number): ContinuityEvidence | undefined {
  try {
    if (!validTime(from) || !validTime(through) || from >= through) return undefined
    privateFile(path)
    const entries = readEntries(readFileSync(path, 'utf8'))
    const live = [...entries].reverse().find(entry => entry.kind === 'live' && entry.at <= from)
    if (!live || !entries.some(entry => entry.kind === 'run-start' && entry.runId === live.runId && entry.seq < live.seq)) return undefined
    const beforeLive = entries.filter(entry => entry.runId === live.runId && entry.seq < live.seq)
    const connecting = [...beforeLive].reverse().find(entry => entry.kind === 'connecting')
    const verdict = [...beforeLive].reverse().find(entry => entry.kind === 'connected-ok' || entry.kind === 'connected-gap')
    if (!connecting || !verdict || verdict.seq < connecting.seq ||
      beforeLive.some(entry => entry.seq > verdict.seq && (entry.kind === 'disconnect' || entry.kind === 'attention'))) return undefined
    const following = entries.filter(entry => entry.seq > live.seq && entry.at <= through)
    if (following.some(entry => entry.runId !== live.runId || entry.kind !== 'heartbeat')) return undefined
    const heartbeat = entries.find(entry => entry.seq > live.seq && entry.runId === live.runId && entry.kind === 'heartbeat' && entry.at >= through && entry.at <= through + 10_000)
    if (!heartbeat) return undefined
    const covered = entries.filter(entry => entry.seq > live.seq && entry.seq <= heartbeat.seq)
    if (covered.some(entry => entry.runId !== live.runId || entry.kind !== 'heartbeat')) return undefined
    if (covered.some((entry, index) => entry.at - (index ? covered[index - 1]!.at : live.at) > 10_000)) return undefined
    return { sourceState: 'live', gapCount: 0, observedFrom: live.at, observedThrough: heartbeat.at }
  } catch { return undefined }
}
