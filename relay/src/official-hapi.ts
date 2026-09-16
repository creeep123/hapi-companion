import type { Fetcher } from './ntfy'
import type { OfficialFrame, OfficialMessagesPage, OfficialSession, OfficialSessionSummary, OfficialSyncEvent } from './types'

export type ResumeVerdict = 'ok' | 'gap'
export type OfficialConnected = { resume: ResumeVerdict; subscriptionId?: string }
export type OfficialStreamItem = { type: 'connected'; connected: OfficialConnected } | { type: 'event'; frame: OfficialFrame }

export class OfficialHapiError extends Error {
  constructor(readonly code: 'unauthorized' | 'unavailable' | 'contract_invalid' | 'stream_ended', readonly permanent = false) { super(code) }
}

type JWT = { value: string; refreshAt: number }

export class OfficialHapiClient {
  private jwt?: JWT
  private authTask?: Promise<string>
  constructor(
    readonly origin: string,
    private readonly accessToken: string,
    private readonly fetcher: Fetcher = fetch,
    private readonly now = () => Date.now(),
    private readonly inactivityMs = 75_000
  ) {
    const url = new URL(origin)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error('invalid_hapi_origin')
  }

  private async authenticate(force = false): Promise<string> {
    if (!force && this.jwt && this.jwt.refreshAt > this.now()) return this.jwt.value
    if (this.authTask) return this.authTask
    const task = (async () => {
      const response = await this.fetcher(new URL('/api/auth', this.origin), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: this.accessToken }), signal: AbortSignal.timeout(15_000)
      })
      if (response.status === 401 || response.status === 403) throw new OfficialHapiError('unauthorized', true)
      if (!response.ok) throw new OfficialHapiError('unavailable')
      const value = await response.json().catch(() => null) as any
      if (!value || typeof value.token !== 'string' || value.token.length < 16) throw new OfficialHapiError('contract_invalid', true)
      this.jwt = { value: value.token, refreshAt: this.now() + 3.5 * 3600_000 }
      return value.token
    })()
    this.authTask = task
    try { return await task } finally { if (this.authTask === task) this.authTask = undefined }
  }

  async namespace(): Promise<string> {
    const token = await this.authenticate(), part = token.split('.')[1]
    if (!part) throw new OfficialHapiError('contract_invalid', true)
    try {
      const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
      if (typeof payload?.ns !== 'string' || !payload.ns.trim() || payload.ns !== payload.ns.trim() || payload.ns.length > 256) throw new Error('invalid namespace')
      return payload.ns
    } catch { throw new OfficialHapiError('contract_invalid', true) }
  }

  private async request(path: string, init: RequestInit = {}, retry = true, streaming = false): Promise<Response> {
    const token = await this.authenticate()
    const connectController = new AbortController()
    const timeout = streaming ? connectController.signal : AbortSignal.timeout(15_000)
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    const timer = streaming ? setTimeout(() => connectController.abort(new DOMException('timed out', 'TimeoutError')), 15_000) : undefined
    let response: Response
    try { response = await this.fetcher(new URL(path, this.origin), { ...init, signal, headers: { ...init.headers, Authorization: `Bearer ${token}` } }) }
    finally { if (timer) clearTimeout(timer) }
    if ((response.status === 401 || response.status === 403) && retry) {
      this.jwt = undefined
      return this.request(path, init, false, streaming)
    }
    if (response.status === 401 || response.status === 403) throw new OfficialHapiError('unauthorized', true)
    if (!response.ok) throw new OfficialHapiError('unavailable')
    return response
  }

  async catalog(signal?: AbortSignal): Promise<OfficialSessionSummary[]> {
    const response = await this.request('/api/sessions?order=updatedAt', { signal })
    const value = await response.json().catch(() => null) as any
    const sessions = Array.isArray(value) ? value : value?.sessions
    if (!Array.isArray(sessions)) throw new OfficialHapiError('contract_invalid', true)
    return sessions.map(parseSessionSummary)
  }

  async session(id: string, signal?: AbortSignal): Promise<OfficialSession> {
    const response = await this.request(`/api/sessions/${encodeURIComponent(id)}`, { signal })
    const value = await response.json().catch(() => null) as any
    return parseSession(value?.session)
  }

  async messages(id: string, query: { afterAt?: number; afterSeq?: number; untilAt?: number; untilSeq?: number; epoch?: number; limit?: number } = {}, signal?: AbortSignal): Promise<OfficialMessagesPage> {
    const url = new URL(`/api/sessions/${encodeURIComponent(id)}/messages`, this.origin)
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value))
    const value = await this.request(`${url.pathname}${url.search}`, { signal }).then(r => r.json()).catch(() => null) as any
    if (!isObject(value) || !Array.isArray(value.messages) || !isObject(value.page) || !Number.isSafeInteger(value.page.epoch)) throw new OfficialHapiError('contract_invalid', true)
    for (const message of value.messages) if (!isObject(message) || !Number.isSafeInteger(message.seq) || !Number.isSafeInteger(message.createdAt) || !('content' in message)) throw new OfficialHapiError('contract_invalid', true)
    for (const field of ['nextAfterSeq', 'nextAfterAt', 'snapshotHeadSeq', 'snapshotHeadAt']) if (value.page[field] !== null && !Number.isSafeInteger(value.page[field])) throw new OfficialHapiError('contract_invalid', true)
    if (typeof value.page.reset !== 'boolean' || typeof value.page.hasMore !== 'boolean') throw new OfficialHapiError('contract_invalid', true)
    return value as OfficialMessagesPage
  }

  async *events(lastEventId: string | undefined, signal: AbortSignal): AsyncGenerator<OfficialStreamItem> {
    const headers: Record<string, string> = { Accept: 'text/event-stream', 'Accept-Encoding': 'identity' }
    if (lastEventId) headers['Last-Event-ID'] = lastEventId
    const response = await this.request('/api/events?all=true&visibility=hidden', { headers, signal }, true, true)
    if (!response.body || !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) throw new OfficialHapiError('contract_invalid', true)
    const parser = new OfficialSSEParser(), reader = response.body.getReader(); let first = true
    try {
      while (true) {
        const next = await withInactivityTimeout(reader.read(), this.inactivityMs)
        if (next.done) throw new OfficialHapiError('stream_ended')
        for (const frame of parser.append(next.value)) {
          const event = parseSyncEvent(frame.data)
          if (first) {
            first = false
            if (frame.id || event.type !== 'connection-changed' || !isObject(event.data) || event.data.status !== 'connected' || !['ok', 'gap'].includes(String(event.data.resume))) throw new OfficialHapiError('contract_invalid', true)
            yield { type: 'connected', connected: { resume: event.data.resume as ResumeVerdict, subscriptionId: typeof event.data.subscriptionId === 'string' ? event.data.subscriptionId : undefined } }
          } else if (event.type !== 'heartbeat' && event.type !== 'connection-changed') {
            if (!frame.id) throw new OfficialHapiError('contract_invalid', true)
            yield { type: 'event', frame: { id: frame.id, event } }
          }
        }
      }
    } finally { await reader.cancel().catch(() => undefined) }
  }
}

async function withInactivityTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new OfficialHapiError('stream_ended')), milliseconds) })
    ])
  } finally { if (timer) clearTimeout(timer) }
}

export type RawSSEFrame = { id?: string; data: string }
export class OfficialSSEParser {
  private buffer = ''
  private decoder = new TextDecoder()
  append(chunk: Uint8Array): RawSSEFrame[] {
    this.buffer += this.decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    if (this.buffer.length > 8 * 1024 * 1024) throw new OfficialHapiError('contract_invalid', true)
    const result: RawSSEFrame[] = []
    let boundary: number
    while ((boundary = this.buffer.indexOf('\n\n')) >= 0) {
      const block = this.buffer.slice(0, boundary); this.buffer = this.buffer.slice(boundary + 2)
      let id: string | undefined; const data: string[] = []
      for (const line of block.split('\n')) {
        if (!line || line.startsWith(':')) continue
        if (line.startsWith('id:')) id = line.slice(3).trim()
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (data.length) result.push({ id, data: data.join('\n') })
    }
    return result
  }
}

function parseSyncEvent(data: string): OfficialSyncEvent {
  let value: unknown
  try { value = JSON.parse(data) } catch { throw new OfficialHapiError('contract_invalid', true) }
  if (!isObject(value) || typeof value.type !== 'string') throw new OfficialHapiError('contract_invalid', true)
  if (value.sessionId !== undefined && (typeof value.sessionId !== 'string' || !value.sessionId || value.sessionId.length > 512)) throw new OfficialHapiError('contract_invalid', true)
  return value as OfficialSyncEvent
}

function parseSessionSummary(value: unknown): OfficialSessionSummary {
  if (!isObject(value) || typeof value.id !== 'string' || !value.id || value.id.length > 512) throw new OfficialHapiError('contract_invalid', true)
  return value as OfficialSessionSummary
}
function parseSession(value: unknown): OfficialSession { return parseSessionSummary(value) as OfficialSession }
const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
