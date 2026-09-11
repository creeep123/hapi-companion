import { describe, expect, test } from 'bun:test'
import { HubClient, HubError, parseHubEvent } from '../src/hub'
import { event } from './helpers'

describe('HubClient', () => {
  test('parses CRLF SSE and ACKs with device credential', async () => {
    const payload = JSON.stringify(event({ eventId: '11111111-1111-4111-8111-111111111111' }))
    let ackBody: any
    const client = new HubClient('https://hapi.example', { deviceId: 'device', token: 'token' }, async (input, init) => {
      if (new URL(input as any).pathname.endsWith('/events')) return new Response(`event: connected\r\ndata: {}\r\n\r\nid: 7\r\nevent: notification\r\ndata: ${payload}\r\n\r\n`, { headers: { 'content-type': 'text/event-stream' } })
      ackBody = JSON.parse(String(init?.body)); return Response.json({ ok: true })
    })
    const controller = new AbortController(); const iterator = client.events(controller.signal); const first = await iterator.next(); expect(first.value?.seq).toBe(7); controller.abort(); await iterator.return(undefined)
    await client.ack(7, payload.slice(0, 1)); expect(ackBody.seq).toBe(7)
  })
  test('announces connected immediately before an idle stream', async () => {
    const controller = new AbortController(); let connected = false
    const client = new HubClient('https://hapi.example', { deviceId: 'd', token: 't' }, async (_input, init) => new Response(new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode('event: connected\ndata: {}\n\n')); init?.signal?.addEventListener('abort', () => stream.close()) } }), { headers: { 'content-type': 'text/event-stream' } }))
    const iterator = client.events(controller.signal, () => { connected = true }), pending = iterator.next()
    for (let i = 0; i < 20 && !connected; i++) await Bun.sleep(1)
    expect(connected).toBeTrue(); controller.abort(); await pending.catch(() => undefined); await iterator.return(undefined)
  })
  test('classifies unauthorized stream', async () => {
    const client = new HubClient('https://hapi.example', { deviceId: 'd', token: 't' }, async () => new Response('', { status: 401 }))
    const iterator = client.events(new AbortController().signal)
    await expect(iterator.next()).rejects.toMatchObject({ code: 'hub_unauthorized', permanent: true } satisfies Partial<HubError>)
  })
  test('classifies Hub stream 403 as permanent unauthorized', async () => {
    const client = new HubClient('https://hapi.example', { deviceId: 'd', token: 't' }, async () => new Response('', { status: 403 }))
    await expect(client.events(new AbortController().signal).next()).rejects.toMatchObject({ code: 'hub_unauthorized', permanent: true })
  })
  test.each([[401, 'hub_unauthorized', true], [403, 'hub_unauthorized', true], [409, 'hub_ack_conflict', true], [500, 'hub_ack_unavailable', false]] as const)('classifies ACK HTTP %i', async (status, code, permanent) => {
    const client = new HubClient('https://hapi.example', { deviceId: 'd', token: 't' }, async () => new Response('', { status }))
    await expect(client.ack(1, crypto.randomUUID())).rejects.toMatchObject({ code, permanent })
  })
  test('requires connected first frame and case-insensitive SSE content type', async () => {
    const payload = JSON.stringify(event())
    const invalid = new HubClient('https://hapi.example', { deviceId: 'd', token: 't' }, async () => new Response(`id: 1\nevent: notification\ndata: ${payload}\n\n`, { headers: { 'Content-Type': 'TEXT/EVENT-STREAM; Charset=UTF-8' } }))
    await expect(invalid.events(new AbortController().signal).next()).rejects.toMatchObject({ code: 'hub_contract_invalid', permanent: true })
  })
  test.each([
    ['bad uuid', { eventId: 'bad' }], ['bad kind', { kind: 'other' }], ['bad time', { createdAt: -1 }],
    ['bad duration', { durationMs: -1 }], ['bad session', { sessionId: '' }], ['bad severity', { severity: 'fatal' }]
  ])('rejects contract violation: %s', (_name, change) => {
    expect(() => parseHubEvent({ ...event(), ...change })).toThrow('hub_contract_invalid')
  })
  test('ACK obeys caller abort', async () => {
    const client = new HubClient('https://hapi.example', { deviceId: 'd', token: 't' }, async (_input, init) => await new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))
    const controller = new AbortController(), result = client.ack(1, crypto.randomUUID(), controller.signal); controller.abort()
    await expect(result).rejects.toThrow()
  })
  test('injected request timeout deterministically aborts a fetch that never returns', async () => {
    const timeout = new AbortController()
    const client = new HubClient('https://hapi.example', { deviceId: 'd', token: 't' }, async (_input, init) => await new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')), { once: true }); queueMicrotask(() => timeout.abort()) }), () => timeout.signal)
    await expect(client.ack(1, crypto.randomUUID())).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})
