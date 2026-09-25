import { Database } from 'bun:sqlite'
import { createHash, createHmac } from 'node:crypto'

const KINDS = ['ready', 'session-completed', 'task-notification', 'permission-request', 'input-request'] as const
type Kind = typeof KINDS[number]
type Side = 'sidecar' | 'hub'
type Item = { kind: Kind; group: string; at: number }

export type ContinuityEvidence = {
  sourceState: 'live' | string
  gapCount: number
  observedFrom: number
  observedThrough: number
}
export type CompareOptions = {
  from: number
  through: number
  toleranceMs: number
  continuity: ContinuityEvidence
  key: Uint8Array
}
export type KindResult = { kind: Kind; sidecar: number; hub: number; matched: number; sidecarOnly: number; hubOnly: number }
export type CompareResult = {
  version: 1
  verdict: 'PASS' | 'FAIL' | 'INDETERMINATE'
  reason: 'matched' | 'mismatch' | 'incomplete_kinds' | 'ambiguous_match' | 'source_gap_or_unverified' | 'invalid_snapshot'
  kinds: KindResult[]
  timingMs?: { max: number; median: number; p95: number }
}

const validTime = (value: unknown): value is number => Number.isSafeInteger(value) && typeof value === 'number' && value >= 0
const safe = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const empty = (reason: CompareResult['reason']): CompareResult => ({ version: 1, verdict: 'INDETERMINATE', reason, kinds: KINDS.map(kind => ({ kind, sidecar: 0, hub: 0, matched: 0, sidecarOnly: 0, hubOnly: 0 })) })

/** Reads only offline SQLite snapshots. Never returns an ID, fingerprint, event body, or raw error. */
export function compareSnapshotFiles(sidecarPath: string, hubPath: string, options: CompareOptions): CompareResult {
  if (!validTime(options.from) || !validTime(options.through) || options.from >= options.through ||
    !Number.isSafeInteger(options.toleranceMs) || options.toleranceMs < 0 || options.toleranceMs > 5_000 ||
    options.key.byteLength < 32) return empty('invalid_snapshot')
  const continuity = options.continuity
  if (continuity?.sourceState !== 'live' || continuity.gapCount !== 0 ||
    !validTime(continuity.observedFrom) || !validTime(continuity.observedThrough) ||
    continuity.observedFrom > options.from || continuity.observedThrough < options.through) return empty('source_gap_or_unverified')

  let sidecar: Database | undefined, hub: Database | undefined
  try {
    sidecar = new Database(sidecarPath, { readonly: true, strict: true })
    hub = new Database(hubPath, { readonly: true, strict: true })
    sidecar.exec('PRAGMA query_only=ON'); hub.exec('PRAGMA query_only=ON')
    const binding = sidecar.query('SELECT namespace_hash,state,attention_code FROM source_binding WHERE singleton=1').get() as any
    if (!binding || !safe(binding.namespace_hash) || binding.state !== 'live' || binding.attention_code) return empty('source_gap_or_unverified')
    const sidecarItems = readItems(sidecar, 'sidecar', options, binding.namespace_hash)
    const hubItems = readItems(hub, 'hub', options, binding.namespace_hash)
    if (!sidecarItems || !hubItems) return empty('invalid_snapshot')
    return compareItems(sidecarItems, hubItems, options.toleranceMs)
  } catch {
    return empty('invalid_snapshot')
  } finally {
    sidecar?.close(); hub?.close()
  }
}

function readItems(db: Database, side: Side, options: CompareOptions, namespaceHash: string): Item[] | undefined {
  const sql = side === 'sidecar'
    ? 'SELECT seq,event_id,source_key,session_id,created_at,payload FROM canonical_notifications WHERE created_at>=? AND created_at<? ORDER BY seq'
    : 'SELECT seq,event_id,namespace,created_at,payload_json FROM companion_notification_outbox WHERE created_at>=? AND created_at<? ORDER BY seq'
  const items: Item[] = [], seen = new Set<string>(), requestGroups = new Set<string>()
  let scanned = 0, payloadBytes = 0
  for (const row of db.query(sql).iterate(options.from, options.through) as Iterable<Record<string, unknown>>) {
    if (++scanned > 500) return undefined
    if (side === 'hub') {
      if (!safe(row.namespace)) return undefined
      if (createHash('sha256').update(row.namespace).digest('hex') !== namespaceHash) continue
    }
    const rawPayload = row[side === 'sidecar' ? 'payload' : 'payload_json']
    if (!safe(row.event_id) || !validTime(row.created_at) || typeof rawPayload !== 'string' || rawPayload.length === 0) return undefined
    const bytes = new TextEncoder().encode(rawPayload).byteLength
    payloadBytes += bytes
    if (bytes > 1024 * 1024 || payloadBytes > 16 * 1024 * 1024) return undefined
    const id = row.event_id
    if (seen.has(id)) return undefined
    seen.add(id)
    const payload = JSON.parse(rawPayload) as unknown
    if (!record(payload) || payload.version !== 1 || !KINDS.includes(payload.kind as Kind) || !safe(payload.sessionId) ||
      payload.eventId !== id || !validTime(payload.createdAt) || payload.createdAt !== row.created_at ||
      (side === 'sidecar' && payload.sessionId !== row.session_id)) return undefined
    const kind = payload.kind as Kind
    const requestKind = kind === 'permission-request' || kind === 'input-request'
    if (requestKind && !safe(payload.requestId)) return undefined
    const session = createHmac('sha256', options.key).update(payload.sessionId).digest('hex')
    const request = requestKind ? createHmac('sha256', options.key).update(payload.requestId as string).digest('hex') : ''
    const group = `${kind}/${session}/${request}`
    if (requestKind && requestGroups.has(group)) return undefined
    if (requestKind) requestGroups.add(group)
    items.push({ kind, group, at: row.created_at as number })
  }
  return items
}

function compareItems(sidecar: Item[], hub: Item[], toleranceMs: number): CompareResult {
  const kinds: KindResult[] = [], deltas: number[] = []
  for (const kind of KINDS) {
    const left = sidecar.filter(item => item.kind === kind), right = hub.filter(item => item.kind === kind)
    const edges = left.map(item => right.map((other, index) => ({ index, delta: Math.abs(item.at - other.at) }))
      .filter(edge => item.group === right[edge.index]!.group && edge.delta <= toleranceMs)
      .sort((a, b) => a.delta - b.delta || a.index - b.index))
    const possibleOwners = new Array<number>(right.length).fill(0)
    edges.forEach(matches => matches.forEach(edge => { possibleOwners[edge.index]++ }))
    if (edges.some(matches => matches.length > 1) || possibleOwners.some(count => count > 1)) return empty('ambiguous_match')
    const owner = new Array<number>(right.length).fill(-1)
    const visit = (index: number, visited: Set<number>): boolean => {
      for (const edge of edges[index]!) {
        if (visited.has(edge.index)) continue
        visited.add(edge.index)
        if (owner[edge.index] === -1 || visit(owner[edge.index]!, visited)) { owner[edge.index] = index; return true }
      }
      return false
    }
    for (let i = 0; i < left.length; i++) visit(i, new Set())
    const matched = owner.filter(index => index !== -1).length
    owner.forEach((index, rightIndex) => { if (index !== -1) deltas.push(Math.abs(left[index]!.at - right[rightIndex]!.at)) })
    kinds.push({ kind, sidecar: left.length, hub: right.length, matched, sidecarOnly: left.length - matched, hubOnly: right.length - matched })
  }
  if (kinds.some(row => row.sidecarOnly || row.hubOnly)) return { version: 1, verdict: 'FAIL', reason: 'mismatch', kinds }
  if (kinds.some(row => row.matched === 0)) return { version: 1, verdict: 'INDETERMINATE', reason: 'incomplete_kinds', kinds }
  deltas.sort((a, b) => a - b)
  return { version: 1, verdict: 'PASS', reason: 'matched', kinds, timingMs: {
    max: deltas[deltas.length - 1]!, median: deltas[Math.floor((deltas.length - 1) / 2)]!, p95: deltas[Math.ceil(deltas.length * 0.95) - 1]!
  } }
}
