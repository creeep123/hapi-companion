import { Database } from 'bun:sqlite'
import { createHmac } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'
import { randomSecret, secretHash, secretMatches } from './crypto'
import type { Candidate, InterpreterState } from './interpreter'
import type { CompanionEvent, StreamEvent } from './types'

export type ConsumerKind = 'mac' | 'ntfy'
export type ConsumerCredential = { consumerId: string; token: string }
export type ConsumerStatus = { version: 1; replayExpired: boolean; replayAvailableFromSeq: number; highWaterSeq: number }
export type CatalogItem = { id: string; title?: string; machineName?: string; updatedAt?: number; active?: boolean }
export type CatalogChanges = { upsert?: CatalogItem[]; remove?: string[] }
export class SidecarStorageLimitError extends Error { constructor() { super('storage_limit') } }

export class SidecarStore {
  readonly db: Database
  constructor(readonly path: string, private readonly now = () => Date.now(), private readonly maxBytes = 100 * 1024 * 1024) {
    if (!isAbsolute(path)) throw new Error('sidecar_db_path_not_absolute')
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    const dir = lstatSync(dirname(path)); if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o077) !== 0) throw new Error('sidecar_db_directory_permissions')
    if (typeof process.getuid === 'function' && dir.uid !== process.getuid()) throw new Error('sidecar_db_directory_owner')
    for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
      if (!existsSync(candidate)) continue
      const file = lstatSync(candidate)
      if (!file.isFile() || file.isSymbolicLink() || (typeof process.getuid === 'function' && file.uid !== process.getuid())) throw new Error('sidecar_db_file_unsafe')
    }
    this.db = new Database(path, { create: true, readwrite: true, strict: true })
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
    this.migrate(); this.secureFiles()
  }
  close() { this.db.close() }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL);
      INSERT INTO schema_meta(version) SELECT 2 WHERE NOT EXISTS (SELECT 1 FROM schema_meta);
      CREATE TABLE IF NOT EXISTS source_binding (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), origin TEXT NOT NULL, namespace_hash TEXT NOT NULL,
        last_event_id TEXT, process_epoch TEXT, snapshot_generation INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'stopped', attention_code TEXT, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_dedup (source_key TEXT PRIMARY KEY, observed_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS interpreter_state (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), state_json TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_catalog (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, machine_name TEXT, updated_at INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 0, snapshot_generation INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS canonical_notifications (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, source_key TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL, created_at INTEGER NOT NULL, payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS consumers (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('mac','ntfy')), credential_hash TEXT,
        namespace_hash TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1, ack_seq INTEGER NOT NULL DEFAULT 0, last_seen_at INTEGER NOT NULL,
        replay_expired INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS deliveries (
        notification_seq INTEGER NOT NULL REFERENCES canonical_notifications(seq) ON DELETE CASCADE,
        consumer_id TEXT NOT NULL REFERENCES consumers(id) ON DELETE CASCADE,
        state TEXT NOT NULL CHECK(state IN ('pending','acked','accepted','suppressed','failed')) DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0, terminal_at INTEGER, reason TEXT,
        PRIMARY KEY(notification_seq, consumer_id)
      );
      CREATE INDEX IF NOT EXISTS deliveries_consumer_pending ON deliveries(consumer_id,state,notification_seq);
    `)
    const version = this.db.query('SELECT version FROM schema_meta LIMIT 1').get() as any
    if (version?.version === 1) {
      const columns = this.db.query('PRAGMA table_info(consumers)').all() as Array<{ name: string }>
      if (!columns.some(column => column.name === 'namespace_hash')) this.db.exec('ALTER TABLE consumers ADD COLUMN namespace_hash TEXT')
      this.db.query('UPDATE schema_meta SET version=2').run()
    } else if (version?.version !== 2) throw new Error('unsupported_sidecar_schema')
  }

  bindSource(origin: string, namespaceHash: string) {
    const current = this.db.query('SELECT origin,namespace_hash FROM source_binding WHERE singleton=1').get() as any
    if (current && (current.origin !== origin || current.namespace_hash !== namespaceHash)) throw new Error('source_binding_conflict')
    this.db.query(`INSERT INTO source_binding(singleton,origin,namespace_hash,updated_at) VALUES(1,?,?,?)
      ON CONFLICT(singleton) DO UPDATE SET updated_at=excluded.updated_at`).run(origin, namespaceHash, this.now())
    this.db.query('UPDATE consumers SET namespace_hash=? WHERE namespace_hash IS NULL').run(namespaceHash)
  }
  sourceCursor(): string | undefined { return (this.db.query('SELECT last_event_id FROM source_binding WHERE singleton=1').get() as any)?.last_event_id ?? undefined }
  interpreterState(): InterpreterState | undefined {
    const row = this.db.query('SELECT state_json FROM interpreter_state WHERE singleton=1').get() as any
    if (!row) return undefined
    const value = JSON.parse(row.state_json)
    if (value?.version !== 1 || !Array.isArray(value.sessions)) throw new Error('invalid_interpreter_state')
    return value as InterpreterState
  }
  sourceHealth(state: string, attentionCode?: string) {
    this.db.query('UPDATE source_binding SET state=?,attention_code=?,updated_at=? WHERE singleton=1').run(state, attentionCode ?? null, this.now())
  }
  sourceStatus(): { state: string; attentionCode?: string; updatedAt: number } {
    const row = this.db.query('SELECT state,attention_code,updated_at FROM source_binding WHERE singleton=1').get() as any
    if (!row) return { state: 'stopped', updatedAt: 0 }
    return { state: row.state, ...(row.attention_code ? { attentionCode: row.attention_code } : {}), updatedAt: Number(row.updated_at) }
  }
  replaceCatalog(sessions: CatalogItem[]) {
    this.db.transaction(() => {
      const row = this.db.query('SELECT snapshot_generation FROM source_binding WHERE singleton=1').get() as any
      if (!row) throw new Error('source_not_bound')
      const generation = Number(row.snapshot_generation) + 1
      this.db.query('DELETE FROM session_catalog').run()
      const insert = this.db.query('INSERT INTO session_catalog(id,title,machine_name,updated_at,active,snapshot_generation) VALUES(?,?,?,?,?,?)')
      for (const item of sessions) insert.run(item.id, item.title?.trim() || 'HAPI session', item.machineName ?? null, Number.isSafeInteger(item.updatedAt) ? item.updatedAt! : 0, item.active ? 1 : 0, generation)
      this.db.query('UPDATE source_binding SET snapshot_generation=?,updated_at=? WHERE singleton=1').run(generation, this.now())
    })()
  }
  commitBaseline(sessions: CatalogItem[], state: InterpreterState) {
    this.db.transaction(() => { this.replaceCatalog(sessions); this.writeInterpreterState(state) })()
  }
  commitReconciliation(candidates: Candidate[], sessions: CatalogItem[], state: InterpreterState, targetKinds: ConsumerKind[] = ['mac', 'ntfy']) {
    if (!this.ensureCapacity()) throw new SidecarStorageLimitError()
    this.db.transaction(() => {
      this.insertCandidates(candidates, targetKinds, this.now())
      this.replaceCatalog(sessions)
      this.writeInterpreterState(state)
    })()
  }
  catalog() {
    const rows = this.db.query('SELECT id,title,machine_name,updated_at,active FROM session_catalog ORDER BY updated_at DESC,id').all() as any[]
    return { version: 1, capabilities: { turnDuration: true }, sessions: rows.map(row => ({ id: row.id, title: row.title, ...(row.machine_name ? { machineName: row.machine_name } : {}), updatedAt: row.updated_at, active: row.active === 1 })) }
  }

  createConsumer(kind: ConsumerKind, id = crypto.randomUUID()): ConsumerCredential {
    const token = randomSecret(), now = this.now(), high = this.highWater()
    const namespaceHash = (this.db.query('SELECT namespace_hash FROM source_binding WHERE singleton=1').get() as any)?.namespace_hash
    if (!namespaceHash) throw new Error('source_not_bound')
    this.db.query('INSERT INTO consumers(id,kind,credential_hash,namespace_hash,ack_seq,last_seen_at,created_at) VALUES(?,?,?,?,?,?,?)').run(id, kind, secretHash(token), namespaceHash, high, now, now)
    return { consumerId: id, token }
  }
  ensureInternalConsumer(id: string, kind: Extract<ConsumerKind, 'ntfy'>) {
    const now = this.now(), high = this.highWater()
    const namespaceHash = (this.db.query('SELECT namespace_hash FROM source_binding WHERE singleton=1').get() as any)?.namespace_hash
    if (!namespaceHash) throw new Error('source_not_bound')
    this.db.query('INSERT OR IGNORE INTO consumers(id,kind,credential_hash,namespace_hash,ack_seq,last_seen_at,created_at) VALUES(?,?,NULL,?,?,?,?)').run(id, kind, namespaceHash, high, now, now)
  }
  authenticateConsumer(id: string, token: string): boolean {
    const row = this.db.query(`SELECT c.credential_hash,c.enabled,c.namespace_hash=s.namespace_hash AS namespace_match
      FROM consumers c JOIN source_binding s ON s.singleton=1 WHERE c.id=?`).get(id) as any
    if (!row || row.enabled !== 1 || row.namespace_match !== 1 || !row.credential_hash || !secretMatches(token, row.credential_hash)) return false
    this.db.query('UPDATE consumers SET last_seen_at=? WHERE id=?').run(this.now(), id); return true
  }

  append(candidate: Candidate, upstreamCursor: string, targetKinds: ConsumerKind[] = ['mac', 'ntfy']): number | undefined {
    return this.commitObservation([candidate], upstreamCursor, this.interpreterState(), targetKinds)[0]
  }
  advanceCursor(upstreamCursor: string, state?: InterpreterState, catalogChanges?: CatalogChanges) {
    if (!this.ensureCapacity()) throw new SidecarStorageLimitError()
    this.db.transaction(() => {
      if (catalogChanges) this.applyCatalogChanges(catalogChanges)
      if (state) this.writeInterpreterState(state)
      this.db.query("UPDATE source_binding SET last_event_id=?,state='live',attention_code=NULL,updated_at=? WHERE singleton=1").run(upstreamCursor, this.now())
    })()
  }

  commitObservation(candidates: Candidate[], upstreamCursor: string, state?: InterpreterState, targetKinds: ConsumerKind[] = ['mac', 'ntfy'], catalogChanges?: CatalogChanges): number[] {
    if (!this.ensureCapacity()) throw new SidecarStorageLimitError()
    return this.db.transaction(() => {
      const now = this.now(), sequences = this.insertCandidates(candidates, targetKinds, now)
      if (catalogChanges) this.applyCatalogChanges(catalogChanges)
      if (state) this.writeInterpreterState(state)
      this.db.query('UPDATE source_binding SET last_event_id=?,state=?,attention_code=NULL,updated_at=? WHERE singleton=1').run(upstreamCursor, 'live', now)
      return sequences
    })()
  }

  private applyCatalogChanges(changes: CatalogChanges) {
    const generation = Number((this.db.query('SELECT snapshot_generation FROM source_binding WHERE singleton=1').get() as any)?.snapshot_generation ?? 0)
    const upsert = this.db.query(`INSERT INTO session_catalog(id,title,machine_name,updated_at,active,snapshot_generation)
      VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      title=excluded.title,machine_name=excluded.machine_name,updated_at=excluded.updated_at,
      active=excluded.active,snapshot_generation=excluded.snapshot_generation`)
    for (const item of changes.upsert ?? []) upsert.run(
      item.id,
      item.title?.trim() || 'HAPI session',
      item.machineName ?? null,
      Number.isSafeInteger(item.updatedAt) ? item.updatedAt! : 0,
      item.active ? 1 : 0,
      generation
    )
    const remove = this.db.query('DELETE FROM session_catalog WHERE id=?')
    for (const id of changes.remove ?? []) remove.run(id)
  }

  private insertCandidates(candidates: Candidate[], targetKinds: ConsumerKind[], now: number): number[] {
    const sequences: number[] = []
    for (const candidate of candidates) {
      if (this.db.query('SELECT 1 FROM source_dedup WHERE source_key=?').get(candidate.sourceKey)) continue
      const payload = JSON.stringify(candidate.event)
      if (new TextEncoder().encode(payload).byteLength > 131_072) throw new Error('canonical_event_too_large')
      this.db.query('INSERT INTO source_dedup(source_key,observed_at) VALUES(?,?)').run(candidate.sourceKey, now)
      const result = this.db.query('INSERT INTO canonical_notifications(event_id,source_key,session_id,created_at,payload) VALUES(?,?,?,?,?)').run(candidate.event.eventId, candidate.sourceKey, candidate.event.sessionId, candidate.event.createdAt, payload)
      const seq = Number(result.lastInsertRowid); sequences.push(seq)
      for (const kind of targetKinds) this.db.query(`INSERT INTO deliveries(notification_seq,consumer_id)
        SELECT ?,id FROM consumers WHERE kind=? AND enabled=1`).run(seq, kind)
    }
    return sequences
  }

  private writeInterpreterState(state: InterpreterState) {
    const json = JSON.stringify(state)
    if (new TextEncoder().encode(json).byteLength > 8 * 1024 * 1024) throw new Error('interpreter_state_too_large')
    this.db.query(`INSERT INTO interpreter_state(singleton,state_json,updated_at) VALUES(1,?,?)
      ON CONFLICT(singleton) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at`).run(json, this.now())
  }

  pending(consumerId: string, limit = 100): StreamEvent[] {
    const rows = this.db.query(`SELECT n.seq,n.payload FROM deliveries d JOIN canonical_notifications n ON n.seq=d.notification_seq
      WHERE d.consumer_id=? AND d.state='pending' ORDER BY n.seq LIMIT ?`).all(consumerId, limit) as any[]
    return rows.map(row => ({ seq: row.seq, event: JSON.parse(row.payload) as CompanionEvent }))
  }
  ack(consumerId: string, seq: number, eventId: string): 'acked' | 'idempotent' | 'conflict' {
    return this.db.transaction(() => {
      const consumer = this.db.query('SELECT ack_seq FROM consumers WHERE id=? AND enabled=1').get(consumerId) as any
      if (!consumer) return 'conflict'
      const target = this.db.query(`SELECT d.state,n.event_id FROM deliveries d JOIN canonical_notifications n ON n.seq=d.notification_seq WHERE d.consumer_id=? AND n.seq=?`).get(consumerId, seq) as any
      if (target?.state === 'acked' && target.event_id === eventId && consumer.ack_seq >= seq) return 'idempotent'
      const next = this.db.query(`SELECT n.seq,n.event_id FROM deliveries d JOIN canonical_notifications n ON n.seq=d.notification_seq WHERE d.consumer_id=? AND d.state='pending' ORDER BY n.seq LIMIT 1`).get(consumerId) as any
      if (!next || next.seq !== seq || next.event_id !== eventId) return 'conflict'
      const now = this.now()
      this.db.query("UPDATE deliveries SET state='acked',terminal_at=? WHERE consumer_id=? AND notification_seq=?").run(now, consumerId, seq)
      this.db.query('UPDATE consumers SET ack_seq=?,last_seen_at=? WHERE id=?').run(seq, now, consumerId)
      return 'acked'
    })()
  }
  markNtfy(consumerId: string, seq: number, state: 'accepted' | 'suppressed' | 'failed', reason?: string) {
    this.db.query(`UPDATE deliveries SET state=?,attempts=attempts+1,terminal_at=?,reason=? WHERE consumer_id=? AND notification_seq=? AND state='pending'`).run(state, this.now(), reason ?? null, consumerId, seq)
  }
  highWater(): number { return Number((this.db.query('SELECT COALESCE(MAX(seq),0) AS value FROM canonical_notifications').get() as any).value) }
  shadowReport(key: Uint8Array) {
    if (key.byteLength < 32) throw new Error('shadow_report_key_too_short')
    const groups = new Map<string, { kind: string; sessionFingerprint: string; count: number }>()
    for (const row of this.db.query('SELECT payload FROM canonical_notifications ORDER BY seq').all() as Array<{ payload: string }>) {
      const event = JSON.parse(row.payload) as Partial<CompanionEvent>
      if (typeof event.kind !== 'string' || typeof event.sessionId !== 'string') throw new Error('invalid_canonical_event')
      const sessionFingerprint = createHmac('sha256', key).update(event.sessionId).digest('hex')
      const id = `${event.kind}/${sessionFingerprint}`, current = groups.get(id)
      if (current) current.count += 1; else groups.set(id, { kind: event.kind, sessionFingerprint, count: 1 })
    }
    return { version: 1, highWaterSeq: this.highWater(), observations: [...groups.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.sessionFingerprint.localeCompare(b.sessionFingerprint)) }
  }
  status(consumerId: string): ConsumerStatus {
    const row = this.db.query('SELECT replay_expired FROM consumers WHERE id=? AND enabled=1').get(consumerId) as any
    if (!row) throw new Error('consumer_not_found')
    const available = this.db.query('SELECT COALESCE(MIN(seq),0) AS value FROM canonical_notifications').get() as any
    this.db.query('UPDATE consumers SET last_seen_at=? WHERE id=?').run(this.now(), consumerId)
    return { version: 1, replayExpired: row.replay_expired === 1, replayAvailableFromSeq: Number(available.value), highWaterSeq: this.highWater() }
  }
  revokeConsumer(consumerId: string) { this.db.query('UPDATE consumers SET enabled=0,credential_hash=NULL WHERE id=?').run(consumerId) }
  expire(now = this.now()) {
    const hard = now - 35 * 24 * 3600_000, grace = now - 7 * 24 * 3600_000, lease = now - 45 * 24 * 3600_000
    this.db.transaction(() => {
      this.db.query("UPDATE consumers SET enabled=0 WHERE enabled=1 AND last_seen_at<?").run(lease)
      const expired = this.db.query(`SELECT DISTINCT consumer_id FROM deliveries d JOIN canonical_notifications n ON n.seq=d.notification_seq WHERE n.created_at<? AND d.state='pending'`).all(hard) as Array<{ consumer_id: string }>
      for (const row of expired) {
        this.db.query("DELETE FROM deliveries WHERE consumer_id=? AND state='pending'").run(row.consumer_id)
        this.db.query('UPDATE consumers SET replay_expired=1,ack_seq=? WHERE id=?').run(this.highWater(), row.consumer_id)
      }
      this.db.query('DELETE FROM canonical_notifications WHERE created_at<?').run(hard)
      this.db.query(`DELETE FROM canonical_notifications WHERE created_at<? AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.notification_seq=canonical_notifications.seq AND d.state='pending')`).run(grace)
      this.db.query('DELETE FROM source_dedup WHERE observed_at<?').run(now - 45 * 24 * 3600_000)
    })()
  }
  storageBytes(): number { return [this.path, `${this.path}-wal`, `${this.path}-shm`].reduce((sum, path) => sum + (existsSync(path) ? statSync(path).size : 0), 0) }
  ensureCapacity(): boolean {
    if (this.storageBytes() < this.maxBytes * 0.8) return true
    this.expire(); this.db.exec('PRAGMA wal_checkpoint(PASSIVE)')
    this.secureFiles()
    return this.storageBytes() < this.maxBytes * 0.8
  }
  backup(destination: string): void {
    if (!isAbsolute(destination) || existsSync(destination)) throw new Error('invalid_backup_destination')
    mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
    this.db.query('VACUUM INTO ?').run(destination)
    chmodSync(destination, 0o600)
    const check = new Database(destination, { readonly: true, strict: true })
    try { const row = check.query('PRAGMA integrity_check').get() as any; if (row?.integrity_check !== 'ok') throw new Error('backup_integrity_failed') } finally { check.close() }
  }
  private secureFiles() { for (const file of [this.path, `${this.path}-wal`, `${this.path}-shm`]) if (existsSync(file)) chmodSync(file, 0o600) }
}
