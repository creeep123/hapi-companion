import { chmod, mkdir, open, readFile, rename, unlink, lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute } from 'node:path'
import type { PersistedState } from './types'
import { parseConfig } from './validation'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH = /^[0-9a-f]{64}$/

export const emptyState = (): PersistedState => ({
  schemaVersion: 1, enabled: false, paused: false, handled: {}, health: { stream: 'stopped' }
})

export class StateStore {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(readonly path: string) {}
  async preflight(): Promise<void> {
    if (!isAbsolute(this.path)) throw new Error('state_path_not_absolute')
    const directoryPath = dirname(this.path), directory = await lstat(directoryPath)
    if (!directory.isDirectory() || (directory.mode & 0o077) !== 0) throw new Error('state_directory_permissions')
    const resolvedDirectory = await realpath(directoryPath)
    if (dirname(await realpath(this.path).catch(() => `${resolvedDirectory}/state.json`)) !== resolvedDirectory) throw new Error('state_path_escape')
    const file = await lstat(this.path).catch((error: any) => { if (error?.code === 'ENOENT') return null; throw error })
    if (file && (!file.isFile() || (file.mode & 0o077) !== 0)) throw new Error('state_file_permissions')
    if (typeof process.getuid === 'function') {
      const uid = process.getuid()
      if (directory.uid !== uid || (file && file.uid !== uid)) throw new Error('state_owner_mismatch')
    }
  }
  private async loadRaw(): Promise<PersistedState> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as PersistedState
      validateState(value)
      return value
    } catch (error: any) {
      if (error?.code === 'ENOENT') return emptyState()
      throw error
    }
  }
  async load(): Promise<PersistedState> { await this.queue.catch(() => undefined); return this.loadRaw() }
  update<T>(mutate: (state: PersistedState) => T | Promise<T>): Promise<T> {
    const next = this.queue.then(async () => {
      const state = await this.loadRaw(); const result = await mutate(state); await this.save(state); return result
    })
    this.queue = next.catch(() => undefined); return next
  }
  async save(state: PersistedState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`
    const file = await open(temporary, 'wx', 0o600)
    try { await file.writeFile(`${JSON.stringify(state)}\n`); await file.sync() } finally { await file.close() }
    await chmod(temporary, 0o600); await rename(temporary, this.path); await chmod(this.path, 0o600)
    const directory = await open(dirname(this.path), 'r'); try { await directory.sync() } finally { await directory.close() }
  }
  async remove(): Promise<void> { await unlink(this.path).catch((e: any) => { if (e?.code !== 'ENOENT') throw e }) }
}
function validateState(value: PersistedState): void {
  if (!value || value.schemaVersion !== 1) throw new Error(`unsupported state schema ${value?.schemaVersion}`)
  if (typeof value.enabled !== 'boolean' || typeof value.paused !== 'boolean' || !value.health || !['stopped', 'connecting', 'connected', 'attention'].includes(value.health.stream) || !value.handled || typeof value.handled !== 'object' || Array.isArray(value.handled)) throw new Error('invalid state')
  if (value.managementTokenHash !== undefined && (typeof value.managementTokenHash !== 'string' || !HASH.test(value.managementTokenHash))) throw new Error('invalid management credential')
  if (value.bootstrap && (!HASH.test(value.bootstrap.hash) || !Number.isSafeInteger(value.bootstrap.expiresAt) || !Number.isSafeInteger(value.bootstrap.failures) || typeof value.bootstrap.sources !== 'object' || Object.values(value.bootstrap.sources).some(x => !Number.isSafeInteger(x) || x < 0))) throw new Error('invalid bootstrap state')
  if (value.config) value.config = parseConfig(value.config)
  if (value.credential && (!UUID.test(value.credential.deviceId) || typeof value.credential.token !== 'string' || value.credential.token.length < 32 || value.credential.token.length > 4096)) throw new Error('invalid Hub credential')
  if (value.activation && (!UUID.test(value.activation.activationId) || !UUID.test(value.activation.installationId) || !HASH.test(value.activation.requestFingerprint) || !['committed', 'rejected'].includes(value.activation.status) || (value.activation.deviceId !== undefined && !UUID.test(value.activation.deviceId)))) throw new Error('invalid activation state')
  if (value.activation?.status === 'committed' && (!value.activation.deviceId || !value.credential || value.credential.deviceId !== value.activation.deviceId || value.activation.rejectionCode !== undefined)) throw new Error('invalid committed activation')
  if (value.activation?.status === 'rejected' && (value.credential || value.activation.deviceId || typeof value.activation.rejectionCode !== 'string')) throw new Error('invalid rejected activation')
  if (value.enabled && (!value.config || !value.credential || value.activation?.status !== 'committed')) throw new Error('incomplete active state')
  if (value.paused && !value.enabled) throw new Error('invalid paused state')
  if (value.health.lastAckSeq !== undefined && (!Number.isSafeInteger(value.health.lastAckSeq) || value.health.lastAckSeq < 0)) throw new Error('invalid health state')
  if (value.health.latestNtfyAcceptanceAt !== undefined && (!Number.isSafeInteger(value.health.latestNtfyAcceptanceAt) || value.health.latestNtfyAcceptanceAt < 0)) throw new Error('invalid health state')
  for (const [id, item] of Object.entries(value.handled)) {
    if (!UUID.test(id) || !Number.isSafeInteger(item.seq) || item.seq <= 0 || !Number.isSafeInteger(item.at) || !['posted', 'suppressed', 'paused'].includes(item.reason)) throw new Error('invalid ledger')
  }
  if (value.health.attentionCode && !['hub_unauthorized', 'hub_contract_invalid', 'hub_stream_unavailable', 'hub_stream_ended', 'hub_ack_conflict', 'hub_ack_unavailable', 'ntfy_invalid_url', 'ntfy_rate_limited', 'ntfy_temporary_failure', 'ntfy_configuration_error', 'ntfy_invalid_response', 'network_temporary_failure'].includes(value.health.attentionCode)) throw new Error('invalid health state')
}
