import type { SidecarStore } from './sidecar-store'

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export class ConsumerBroker {
  private streams = new Map<string, Set<ReadableStreamDefaultController<Uint8Array>>>()
  private sentThrough = new WeakMap<ReadableStreamDefaultController<Uint8Array>, number>()
  private heartbeatTimers = new Map<ReadableStreamDefaultController<Uint8Array>, ReturnType<typeof setInterval>>()
  private encoder = new TextEncoder()
  constructor(readonly store: SidecarStore, private readonly heartbeatMs = 25_000) {}

  handler = async (request: Request): Promise<Response | undefined> => {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/companion/')) return undefined
    const consumerId = request.headers.get('x-hapi-device-id') ?? ''
    const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1] ?? ''
    if (!this.store.authenticateConsumer(consumerId, token)) return json({ error: 'unauthorized' }, 401)
    if (request.method === 'GET' && url.pathname === '/companion/sessions') return json(this.store.catalog())
    if (request.method === 'GET' && url.pathname === '/companion/status') return json(this.store.status(consumerId))
    if (request.method === 'POST' && url.pathname === '/companion/ack') {
      const body = await limitedObject(request)
      if (!Number.isSafeInteger(body.seq) || Number(body.seq) <= 0 || typeof body.eventId !== 'string') return json({ error: 'invalid_ack' }, 400)
      const result = this.store.ack(consumerId, Number(body.seq), body.eventId)
      if (result !== 'conflict') this.signal(consumerId)
      return result === 'conflict' ? json({ error: 'ack_conflict' }, 409) : json({ ok: true })
    }
    if (request.method === 'DELETE' && url.pathname === '/companion/consumer') { this.closeConsumer(consumerId); this.store.revokeConsumer(consumerId); return json({ ok: true }) }
    if (request.method === 'GET' && url.pathname === '/companion/events') return this.stream(consumerId, request.signal)
    return json({ error: 'not_found' }, 404)
  }

  signal(consumerId?: string) {
    const ids = consumerId ? [consumerId] : [...this.streams.keys()]
    for (const id of ids) for (const controller of this.streams.get(id) ?? []) this.flush(id, controller)
  }

  private stream(consumerId: string, signal: AbortSignal): Response {
    this.closeConsumer(consumerId)
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | undefined
    const body = new ReadableStream<Uint8Array>({
      start: controller => {
        controllerRef = controller; let set = this.streams.get(consumerId)
        if (!set) { set = new Set(); this.streams.set(consumerId, set) }
        set.add(controller); controller.enqueue(this.encoder.encode('event: connected\ndata: {}\n\n')); this.flush(consumerId, controller)
        this.heartbeatTimers.set(controller, setInterval(() => { try { controller.enqueue(this.encoder.encode('event: heartbeat\ndata: {}\n\n')) } catch { this.remove(consumerId, controller) } }, this.heartbeatMs))
      },
      cancel: () => { if (controllerRef) this.remove(consumerId, controllerRef) }
    })
    signal.addEventListener('abort', () => { if (controllerRef) { this.remove(consumerId, controllerRef); try { controllerRef.close() } catch {} } }, { once: true })
    return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive' } })
  }
  private flush(id: string, controller: ReadableStreamDefaultController<Uint8Array>) {
    try { for (const item of this.store.pending(id, 100)) if (item.seq > (this.sentThrough.get(controller) ?? 0)) { controller.enqueue(this.encoder.encode(`id: ${item.seq}\nevent: notification\ndata: ${JSON.stringify(item.event)}\n\n`)); this.sentThrough.set(controller, item.seq) } }
    catch { this.remove(id, controller); try { controller.error(new Error('stream_failed')) } catch {} }
  }
  private remove(id: string, controller: ReadableStreamDefaultController<Uint8Array>) { const timer = this.heartbeatTimers.get(controller); if (timer) clearInterval(timer); this.heartbeatTimers.delete(controller); const set = this.streams.get(id); set?.delete(controller); if (set?.size === 0) this.streams.delete(id) }
  private closeConsumer(id: string) { for (const controller of this.streams.get(id) ?? []) { this.remove(id, controller); try { controller.close() } catch {} }; this.streams.delete(id) }
}

async function limitedObject(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new Error('json_required')
  const text = await request.text(); if (text.length > 65_536) throw new Error('request_too_large')
  const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_json')
  return value
}
