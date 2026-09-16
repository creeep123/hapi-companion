import { describe, expect, test } from 'bun:test'
import { OfficialHapiClient, OfficialHapiError, OfficialSSEParser } from '../src/official-hapi'

describe('OfficialSSEParser', () => {
  test('parses CRLF, partial chunks, comments and multi-line data', () => {
    const parser = new OfficialSSEParser()
    expect(parser.append(new TextEncoder().encode(': hi\r\nid: e1\r\ndata: {"type":\r\n'))).toEqual([])
    expect(parser.append(new TextEncoder().encode('data: "heartbeat"}\r\n\r\n'))).toEqual([{ id: 'e1', data: '{"type":\n"heartbeat"}' }])
  })
})

describe('OfficialHapiClient', () => {
  test('authenticates once, loads catalog, and refreshes once after 401', async () => {
    let auth = 0, sessions = 0
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
      const path = new URL(String(input)).pathname
      if (path === '/api/auth') return Response.json({ token: `jwt-${'x'.repeat(20)}-${++auth}` })
      if (path === '/api/sessions') { sessions++; if (sessions === 1) return new Response('', { status: 401 }); return Response.json({ sessions: [{ id: 's1', title: 'One' }] }) }
      return new Response('', { status: 404 })
    }
    const client = new OfficialHapiClient('https://hapi.example', 'secret', fetcher as any)
    expect(await client.catalog()).toEqual([{ id: 's1', title: 'One' }])
    expect(auth).toBe(2)
  })

  test('validates connected first frame and yields official events', async () => {
    const body = ['data: {"type":"connection-changed","data":{"status":"connected","resume":"gap"}}\n\n', 'id: epoch:1\ndata: {"type":"session-ended","sessionId":"s1","reason":"completed"}\n\n'].join('')
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => new URL(String(input)).pathname === '/api/auth'
      ? Response.json({ token: `jwt-${'x'.repeat(20)}` })
      : new Response(body, { headers: { 'content-type': 'text/event-stream' } })
    const client = new OfficialHapiClient('https://hapi.example', 'secret', fetcher as any)
    const items: any[] = []
    await expect((async () => { for await (const item of client.events(undefined, new AbortController().signal)) items.push(item) })()).rejects.toMatchObject({ code: 'stream_ended' })
    expect(items).toEqual([
      { type: 'connected', connected: { resume: 'gap', subscriptionId: undefined } },
      { type: 'event', frame: { id: 'epoch:1', event: { type: 'session-ended', sessionId: 's1', reason: 'completed' } } }
    ])
  })

  test('fails closed when connected verdict is absent', async () => {
    const fetcher = async (input: RequestInfo | URL): Promise<Response> => new URL(String(input)).pathname === '/api/auth'
      ? Response.json({ token: `jwt-${'x'.repeat(20)}` })
      : new Response('id: 1\ndata: {"type":"heartbeat"}\n\n', { headers: { 'content-type': 'text/event-stream' } })
    const client = new OfficialHapiClient('https://hapi.example', 'secret', fetcher as any)
    await expect((async () => { for await (const _ of client.events(undefined, new AbortController().signal)) {} })()).rejects.toBeInstanceOf(OfficialHapiError)
  })
})
