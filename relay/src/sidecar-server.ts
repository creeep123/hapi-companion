import type { ConsumerBroker } from './consumer-broker'
import type { SidecarManager } from './sidecar-manager'

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
export function createSidecarHandler(broker: ConsumerBroker, manager: SidecarManager, legacy: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    try {
      const data = await broker.handler(request); if (data) return data
      const url = new URL(request.url)
      if (request.method === 'POST' && ['/v1/activate', '/v1/repair'].includes(url.pathname)) return json({ error: 'client_upgrade_required', requiredAPI: 2 }, 409)
      if (!url.pathname.startsWith('/v2/')) return legacy(request)
      const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1] ?? ''
      if (!await manager.authorized(token)) return json({ error: 'unauthorized' }, 401)
      if (request.method === 'GET' && url.pathname === '/v2/status') return json(await manager.status())
      if (request.method === 'POST' && url.pathname === '/v2/consumers') return json(manager.createConsumer(await objectBody(request)), 201)
      if (request.method === 'PUT' && url.pathname === '/v2/config') { const body = await objectBody(request); if (!Number.isSafeInteger(body.expectedRevision)) throw new Error('invalid_config_request'); const config = await manager.configure(body.config, Number(body.expectedRevision)); return json({ revision: config.revision }) }
      if (request.method === 'POST' && url.pathname === '/v2/receivers/ntfy') { const body = await objectBody(request); if (typeof body.receiverId !== 'string') throw new Error('invalid_receiver'); await manager.activateNtfy(body.receiverId); return json({ ok: true }) }
      const revoke = url.pathname.match(/^\/v2\/consumers\/([0-9a-f-]+)$/i)
      if (request.method === 'DELETE' && revoke) { manager.revoke(revoke[1]); return json({ ok: true }) }
      return json({ error: 'not_found' }, 404)
    } catch (error) { return json({ error: error instanceof Error ? error.message : 'request_failed' }, 400) }
  }
}
async function objectBody(request: Request): Promise<Record<string, unknown>> { if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('json_required'); const text = await request.text(); if (text.length > 65_536) throw new Error('request_too_large'); const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_json'); return value }
