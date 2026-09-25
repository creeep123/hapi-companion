import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { ConsumerBroker } from './consumer-broker'
import { EventInterpreter } from './interpreter'
import { RelayEngine } from './engine'
import { RelayManager } from './manager'
import { NtfyConsumer } from './ntfy-consumer'
import { OfficialHapiClient } from './official-hapi'
import { createHandler } from './server'
import { SidecarManager } from './sidecar-manager'
import { createSidecarHandler } from './sidecar-server'
import { SidecarSourceEngine } from './sidecar-source'
import { SidecarStore } from './sidecar-store'
import { readSourceToken } from './source-credential'
import { SourceContinuityJournal } from './source-continuity'
import { StateStore } from './state'

const statePath = process.env.HAPI_MOBILE_RELAY_STATE ?? '/var/lib/hapi-mobile-relay/state.json'
const store = new StateStore(statePath); const engine = new RelayEngine(store); const manager = new RelayManager(store, engine)
const command = process.argv[2] ?? 'serve'
await store.preflight()
if (command === 'pair-code') {
  const code = await manager.createPairCode()
  process.stdout.write(`${code}\n`)
} else if (command === 'sidecar-backup') {
  const destination = process.argv[3]; if (!destination) throw new Error('backup_destination_required')
  const source = process.env.HAPI_SIDECAR_DB ?? `${statePath}.sqlite`
  const sourceFile = await lstat(source).catch((error: any) => { if (error?.code === 'ENOENT') throw new Error('sidecar_database_missing'); throw error })
  if (!sourceFile.isFile()) throw new Error('sidecar_database_invalid')
  const db = new SidecarStore(source); try { db.backup(destination) } finally { db.close() }
  process.stdout.write('sidecar backup verified\n')
} else if (command === 'sidecar-shadow-report') {
  const keyPath = process.argv[3]; if (!keyPath) throw new Error('shadow_report_key_required')
  const key = await readPrivateFile(keyPath, 'shadow_report_key')
  const source = process.env.HAPI_SIDECAR_DB ?? `${statePath}.sqlite`
  const sourceFile = await lstat(source).catch((error: any) => { if (error?.code === 'ENOENT') throw new Error('sidecar_database_missing'); throw error })
  if (!sourceFile.isFile()) throw new Error('sidecar_database_invalid')
  const db = new SidecarStore(source); try { process.stdout.write(`${JSON.stringify(db.shadowReport(key))}\n`) } finally { db.close() }
} else if (command === 'serve' || command === 'serve-sidecar') {
  const hostname = process.env.HAPI_MOBILE_RELAY_HOST ?? '127.0.0.1'; const port = Number(process.env.HAPI_MOBILE_RELAY_PORT ?? '8789')
  let handler = createHandler(manager), start = async () => { const s = await store.load(); if (s.enabled) await engine.start() }, stop = async () => engine.stop()
  if (command === 'serve-sidecar') {
    const hapiOrigin = requiredOrigin('HAPI_SIDECAR_HAPI_ORIGIN'), publicOrigin = requiredOrigin('HAPI_SIDECAR_PUBLIC_ORIGIN'), apiOrigin = requiredOrigin('HAPI_SIDECAR_API_ORIGIN')
    const token = await readSourceToken(), officialClient = new OfficialHapiClient(hapiOrigin, token)
    const namespaceHash = createHash('sha256').update(await officialClient.namespace()).digest('hex')
    const deliveryMode = process.env.HAPI_SIDECAR_DELIVERY_MODE ?? 'shadow'; if (!['shadow', 'active'].includes(deliveryMode)) throw new Error('HAPI_SIDECAR_DELIVERY_MODE_invalid')
    const dbPath = process.env.HAPI_SIDECAR_DB ?? `${statePath}.sqlite`, sidecarStore = new SidecarStore(dbPath); sidecarStore.bindSource(hapiOrigin, namespaceHash)
    const broker = new ConsumerBroker(sidecarStore), ntfy = new NtfyConsumer(sidecarStore, store)
    const persisted = await store.load(), deliveryActive = deliveryMode === 'active' && persisted.enabled && persisted.sourceMode === 'officialHapi' && persisted.officialCutoverAt !== undefined
    const continuity = process.env.HAPI_SIDECAR_CONTINUITY_PATH ? new SourceContinuityJournal(process.env.HAPI_SIDECAR_CONTINUITY_PATH) : undefined
    const source = new SidecarSourceEngine(sidecarStore, new EventInterpreter(publicOrigin, namespaceHash), broker, officialClient, undefined, () => { if (deliveryMode === 'active') ntfy.signal() }, deliveryActive ? ['mac', 'ntfy'] : [], continuity)
    const noLegacyEngine = { start: async () => { ntfy.start() }, stop: async () => { await ntfy.stop() }, restart: async () => { ntfy.start(); ntfy.signal() } } as RelayEngine
    const sidecarRelayManager = new RelayManager(store, noLegacyEngine), sidecarManager = new SidecarManager(sidecarRelayManager, sidecarStore, publicOrigin, apiOrigin, () => deliveryMode === 'active' && source.isLive(), commit => source.activateDelivery(async () => { await commit(); ntfy.start() }))
    let maintenance: ReturnType<typeof setInterval> | undefined
    handler = createSidecarHandler(broker, sidecarManager, createHandler(sidecarRelayManager)); start = async () => { sidecarStore.expire(); if (deliveryActive) ntfy.start(); source.start(); maintenance = setInterval(() => sidecarStore.expire(), 3600_000) }; stop = async () => { if (maintenance) clearInterval(maintenance); try { await ntfy.stop() } finally { try { await source.stop() } finally { sidecarStore.close() } } }
  }
  const server = Bun.serve({ hostname, port, maxRequestBodySize: 65_536, fetch: handler })
  await start()
  const shutdown = async () => { let failed = false; try { await stop() } catch { failed = true } finally { server.stop(true) }; process.exit(failed ? 1 : 0) }
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown)
  process.stdout.write(`${command === 'serve-sidecar' ? 'hapi-companion-sidecar' : 'hapi-mobile-relay'} listening on ${hostname}:${port}\n`)
} else { process.stderr.write('usage: hapi-mobile-relay [serve|serve-sidecar|pair-code|sidecar-backup <path>|sidecar-shadow-report <key-file>]\n'); process.exit(2) }

function requiredOrigin(name: string): string { const raw = process.env[name]; if (!raw) throw new Error(`${name}_required`); const url = new URL(raw); if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error(`${name}_invalid`); return `${url.protocol}//${url.host}` }
async function readPrivateFile(path: string, label: string): Promise<Uint8Array> {
  if (!path.startsWith('/')) throw new Error(`${label}_path_invalid`)
  const info = await lstat(path); if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) throw new Error(`${label}_file_unsafe`)
  if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw new Error(`${label}_file_owner`)
  const value = await readFile(path); if (value.byteLength < 32) throw new Error(`${label}_too_short`); return value
}
