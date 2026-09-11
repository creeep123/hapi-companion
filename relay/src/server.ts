import { RelayManager, ConflictError } from './manager'

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
async function body(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('json_required')
  const declared = Number(request.headers.get('content-length') ?? 0); if (declared > 65_536) throw new Error('request too large')
  const text = await request.text(); if (text.length > 65_536) throw new Error('request too large')
  return JSON.parse(text || 'null')
}
const objectBody = async (request: Request): Promise<Record<string, unknown>> => {
  const value = await body(request); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_json_body'); return value as Record<string, unknown>
}
export function createHandler(manager: RelayManager): (request: Request) => Promise<Response> {
  return async request => {
    const url = new URL(request.url)
    try {
      if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, version: 1 })
      if (request.method === 'POST' && url.pathname === '/v1/pair') { const b = await objectBody(request); if (typeof b.code !== 'string') throw new Error('invalid_pair_request'); return json({ managementToken: await manager.pair(b.code, request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown') }) }
      const bearer = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1] ?? ''
      if (!await manager.authorized(bearer)) return json({ error: 'unauthorized' }, 401)
      if (request.method === 'GET' && url.pathname === '/v1/status') {
        const s = await manager.store.load(); const requested = url.searchParams.get('activationId')
        return json({ revision: s.config?.revision ?? 0, enabled: s.enabled, paused: s.paused, capabilities: { notificationContentModes: ['fixed', 'eventPreview'] }, activation: requested && s.activation?.activationId === requested ? { status: s.activation.status, activationId: requested } : null, health: s.health })
      }
      if (request.method === 'PUT' && url.pathname === '/v1/config') { const b = await objectBody(request); if (!Number.isSafeInteger(b.expectedRevision)) throw new Error('invalid_config_request'); const config = await manager.configure(b.config, b.expectedRevision as number); return json({ revision: config.revision }) }
      if (request.method === 'POST' && url.pathname === '/v1/test') { const b = await objectBody(request); if (typeof b.sessionId !== 'string') throw new Error('invalid_test_request'); await manager.test(b.sessionId); return json({ accepted: true }) }
      if (request.method === 'POST' && url.pathname === '/v1/activate') { return json({ status: await manager.activate(await objectBody(request)) }) }
      if (request.method === 'POST' && url.pathname === '/v1/repair') { await manager.repair(await objectBody(request)); return json({ ok: true }) }
      if (request.method === 'POST' && url.pathname === '/v1/pause') { const b = await objectBody(request); if (typeof b.paused !== 'boolean') throw new Error('invalid_pause_request'); await manager.pause(b.paused); return json({ ok: true }) }
      if (request.method === 'POST' && url.pathname === '/v1/resume') { await manager.resume(); return json({ ok: true }) }
      if (request.method === 'DELETE' && url.pathname === '/v1/receiver') { await manager.remove(); return json({ ok: true }) }
      if (request.method === 'POST' && url.pathname === '/v1/unpair') { await manager.unpair(); return json({ ok: true }) }
      return json({ error: 'not found' }, 404)
    } catch (error) {
      if (error instanceof ConflictError) return json({ error: error.message, revision: error.revision }, 409)
      return json({ error: error instanceof Error ? error.message : 'request failed' }, 400)
    }
  }
}
