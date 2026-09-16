import { OfficialHapiClient, OfficialHapiError } from '../src/official-hapi'

const [origin, token] = process.argv.slice(2)
if (!origin || !token) throw new Error('usage: official-hapi-gate <origin> <test-token>')

const client = new OfficialHapiClient(origin, token)
if (!(await client.namespace())) throw new Error('namespace_contract_failed')
const catalog = await client.catalog()
if (!Array.isArray(catalog)) throw new Error('catalog_contract_failed')

const controller = new AbortController()
const iterator = client.events(undefined, controller.signal)[Symbol.asyncIterator]()
const first = await iterator.next()
if (first.done || first.value.type !== 'connected' || !['ok', 'gap'].includes(first.value.connected.resume)) throw new Error('sse_contract_failed')
controller.abort(); await iterator.return?.()

try {
  await new OfficialHapiClient(origin, `${token}-wrong`).catalog()
  throw new Error('bad_credential_accepted')
} catch (error) {
  if (!(error instanceof OfficialHapiError) || error.code !== 'unauthorized' || !error.permanent) throw error
}

process.stdout.write('official HAPI auth/catalog/SSE gate passed\n')
