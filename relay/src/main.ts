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
    const source = new SidecarSourceEngine(sidecarStore, new EventInterpreter(publicOrigin, namespaceHash), broker, officialClient, undefined, () => { if (deliveryMode === 'active') ntfy.signal() }, deliveryActive ? ['mac', 'ntfy'] : [])
    const noLegacyEngine = { start: async () => {}, stop: async () => {}, restart: async () => {} } as RelayEngine
    const sidecarRelayManager = new RelayManager(store, noLegacyEngine), sidecarManager = new SidecarManager(sidecarRelayManager, sidecarStore, publicOrigin, apiOrigin, () => deliveryMode === 'active' && source.isLive(), () => { source.setDeliveryActive(true); ntfy.start() })
    let maintenance: ReturnType<typeof setInterval> | undefined
    handler = createSidecarHandler(broker, sidecarManager, createHandler(sidecarRelayManager)); start = async () => { sidecarStore.expire(); if (deliveryActive) ntfy.start(); source.start(); maintenance = setInterval(() => sidecarStore.expire(), 3600_000) }; stop = async () => { if (maintenance) clearInterval(maintenance); await ntfy.stop(); await source.stop(); sidecarStore.close() }
  }
  const server = Bun.serve({ hostname, port, maxRequestBodySize: 65_536, fetch: handler })
  await start()
  const shutdown = async () => { await stop(); server.stop(true); process.exit(0) }
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown)
  process.stdout.write(`${command === 'serve-sidecar' ? 'hapi-companion-sidecar' : 'hapi-mobile-relay'} listening on ${hostname}:${port}\n`)
} else { process.stderr.write('usage: hapi-mobile-relay [serve|serve-sidecar|pair-code|sidecar-backup <path>]\n'); process.exit(2) }

function requiredOrigin(name: string): string { const raw = process.env[name]; if (!raw) throw new Error(`${name}_required`); const url = new URL(raw); if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error(`${name}_invalid`); return `${url.protocol}//${url.host}` }
async function readSourceToken(): Promise<string> {
  const path = process.env.HAPI_SIDECAR_ACCESS_TOKEN_FILE ?? (process.env.CREDENTIALS_DIRECTORY ? `${process.env.CREDENTIALS_DIRECTORY}/hapi-access-token` : '')
  if (!path) throw new Error('HAPI_SIDECAR_ACCESS_TOKEN_FILE_required')
  const file = await lstat(path); if (!file.isFile() || (file.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && file.uid !== process.getuid())) throw new Error('source_credential_permissions')
  const token = (await readFile(path, 'utf8')).trim(); if (token.length < 16 || token.length > 4096 || /[\r\n]/.test(token)) throw new Error('source_credential_invalid')
  return token
}
