import { RelayEngine } from './engine'
import { RelayManager } from './manager'
import { createHandler } from './server'
import { StateStore } from './state'

const statePath = process.env.HAPI_MOBILE_RELAY_STATE ?? '/var/lib/hapi-mobile-relay/state.json'
const store = new StateStore(statePath); const engine = new RelayEngine(store); const manager = new RelayManager(store, engine)
const command = process.argv[2] ?? 'serve'
await store.preflight()
if (command === 'pair-code') {
  const code = await manager.createPairCode()
  process.stdout.write(`${code}\n`)
} else if (command === 'serve') {
  const hostname = process.env.HAPI_MOBILE_RELAY_HOST ?? '127.0.0.1'; const port = Number(process.env.HAPI_MOBILE_RELAY_PORT ?? '8789')
  const server = Bun.serve({ hostname, port, maxRequestBodySize: 65_536, fetch: createHandler(manager) })
  const s = await store.load(); if (s.enabled) await engine.start()
  const shutdown = async () => { await engine.stop(); server.stop(true); process.exit(0) }
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown)
  process.stdout.write(`hapi-mobile-relay listening on ${hostname}:${port}\n`)
} else { process.stderr.write('usage: hapi-mobile-relay [serve|pair-code]\n'); process.exit(2) }
