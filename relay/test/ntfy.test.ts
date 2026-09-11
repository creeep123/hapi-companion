import { describe, expect, test } from 'bun:test'
import { NtfyClient, NtfyError } from '../src/ntfy'
import { config, event } from './helpers'

describe('NtfyClient', () => {
  test('sends fixed payload, click and low priority and validates response', async () => {
    let request!: Request
    const client = new NtfyClient(async (input, init) => { request = new Request(input, init); return Response.json({ id: 'provider', event: 'message', topic: config().topic }) })
    await client.post(config(), event({ sessionName: 'SECRET', kind: 'permission-request' }), 'https://hapi.example/sessions/x', true)
    const body = await request.json() as any
    expect(body.click).toBe('https://hapi.example/sessions/x')
    expect(body.priority).toBe(2)
    expect(JSON.stringify(body)).not.toContain('SECRET')
  })
  test.each([[200, 'text/html', true], [302, 'application/json', true], [400, 'application/json', true], [404, 'application/json', true], [408, 'application/json', false], [429, 'application/json', false], [500, 'application/json', false]])('classifies HTTP %i', async (status, type, permanent) => {
    const client = new NtfyClient(async () => new Response(status === 200 ? '<html>' : '{}', { status, headers: { 'content-type': type, ...(status === 429 ? { 'retry-after': '2' } : {}) } }))
    try { await client.post(config(), event(), 'https://hapi.example/sessions/x', false); throw new Error('expected') } catch (e) { expect(e).toBeInstanceOf(NtfyError); expect((e as NtfyError).permanent).toBe(permanent); if (status === 429) expect((e as NtfyError).retryAfterMs).toBe(2000) }
  })
  test('rejects mismatched topic and never follows redirects', async () => {
    let redirect = ''
    const client = new NtfyClient(async (_i, init) => { redirect = String(init?.redirect); return Response.json({ id: 'x', event: 'message', topic: 'wrong' }) })
    await expect(client.post(config(), event(), 'https://hapi.example/sessions/x', false)).rejects.toThrow('ntfy_invalid_response')
    expect(redirect).toBe('manual')
  })
  test('injected timeout aborts a provider fetch that never returns', async () => {
    const timeout = new AbortController()
    const client = new NtfyClient(async (_input, init) => await new Promise<Response>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')), { once: true }); queueMicrotask(() => timeout.abort()) }), () => timeout.signal)
    await expect(client.post(config(), event(), 'https://hapi.example/sessions/x', false)).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})
