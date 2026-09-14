import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RelayEngine } from '../src/engine'
import { HubClient } from '../src/hub'
import { NtfyClient } from '../src/ntfy'
import { StateStore } from '../src/state'
import type { CompanionEvent } from '../src/types'
import { defaultPolicy } from '../src/validation'

const directory = await mkdtemp(join(tmpdir(), 'hapi-relay-smoke-')), store = new StateStore(join(directory, 'state.json'))
const event: CompanionEvent = { version: 1, eventId: crypto.randomUUID(), createdAt: Date.now(), kind: 'session-completed', title: 'ignored', body: 'ignored', severity: 'success', sessionId: 'smoke-session', sessionName: 'private title', url: '/hostile' }
let posted: any, acked = false, streamCalls = 0
const waitForAbort = (signal?: AbortSignal): Promise<never> => {
  if (!signal || signal.aborted) return Promise.reject(new DOMException('aborted', 'AbortError'))
  return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
}
const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(input as any)
  if (url.hostname === 'ntfy.example') { posted = JSON.parse(String(init?.body)); return Response.json({ id: 'provider-id', event: 'message', topic: posted.topic }) }
  if (url.pathname === '/companion/events') {
    streamCalls++
    if (streamCalls > 1) return await waitForAbort(init?.signal ?? undefined)
    return new Response(`event: connected\ndata: {}\n\nid: 1\nevent: notification\ndata: ${JSON.stringify(event)}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  }
  if (url.pathname === '/companion/ack') { acked = true; return Response.json({ ok: true }) }
  return new Response('', { status: 404 })
}
await store.update(s => {
  s.enabled = true
  s.config = { receiverId: 'smoke', revision: 1, hapiOrigin: 'https://hapi.example', ntfyBaseUrl: 'https://ntfy.example', topic: 'abcdefghijklmnopqrstuv', policy: defaultPolicy() }
  const deviceId = crypto.randomUUID()
  s.credential = { deviceId, token: 'x'.repeat(40) }
  s.activation = { activationId: crypto.randomUUID(), installationId: crypto.randomUUID(), deviceId, status: 'committed', requestFingerprint: 'a'.repeat(64) }
})
const engine = new RelayEngine(store, new NtfyClient(fetcher), (origin, credential) => new HubClient(origin, credential, fetcher))
await engine.start()
for (let i = 0; i < 100 && !acked; i++) await Bun.sleep(5)
await engine.stop()
const state = await store.load()
if (!acked || state.handled[event.eventId]?.reason !== 'posted' || posted?.click !== 'https://hapi.example/sessions/smoke-session' || JSON.stringify(posted).includes('private title')) throw new Error('fake provider smoke failed')
await rm(directory, { recursive: true, force: true })
console.log('fake provider smoke passed')
