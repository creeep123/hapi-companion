import type { AttentionCode, CompanionEvent, HubCredential, StreamEvent } from './types'
import type { Fetcher } from './ntfy'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const KINDS = new Set(['ready', 'permission-request', 'task-notification', 'session-completed'])
const SEVERITIES = new Set(['info', 'success', 'warning', 'error'])
export class HubError extends Error { constructor(readonly code: Extract<AttentionCode, `hub_${string}`>, readonly permanent = false) { super(code) } }

export function parseHubEvent(value: unknown): CompanionEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HubError('hub_contract_invalid', true)
  const e = value as Record<string, unknown>
  if (e.version !== 1 || typeof e.eventId !== 'string' || !UUID.test(e.eventId)
    || typeof e.createdAt !== 'number' || !Number.isSafeInteger(e.createdAt) || e.createdAt < 0
    || typeof e.kind !== 'string' || !KINDS.has(e.kind)
    || typeof e.title !== 'string' || e.title.length > 4096
    || typeof e.body !== 'string' || e.body.length > 65_536
    || typeof e.severity !== 'string' || !SEVERITIES.has(e.severity)
    || typeof e.sessionId !== 'string' || !e.sessionId || e.sessionId.length > 512 || /[\u0000-\u001f\u007f]/.test(e.sessionId)
    || typeof e.sessionName !== 'string' || e.sessionName.length > 4096
    || typeof e.url !== 'string' || e.url.length > 4096
    || (e.durationMs !== undefined && (typeof e.durationMs !== 'number' || !Number.isSafeInteger(e.durationMs) || e.durationMs < 0))
    || (e.machineId !== undefined && (typeof e.machineId !== 'string' || e.machineId.length > 512))
    || (e.requestId !== undefined && (typeof e.requestId !== 'string' || e.requestId.length > 512))
    || (e.tag !== undefined && (typeof e.tag !== 'string' || e.tag.length > 512))) throw new HubError('hub_contract_invalid', true)
  return e as unknown as CompanionEvent
}

export class HubClient {
  constructor(private readonly origin: string, private readonly credential: HubCredential, private readonly fetcher: Fetcher = fetch, private readonly requestTimeoutSignal: () => AbortSignal = () => AbortSignal.timeout(15_000)) {}
  private headers() { return { Authorization: `Bearer ${this.credential.token}`, 'X-Hapi-Device-Id': this.credential.deviceId } }
  async *events(signal: AbortSignal, onConnected?: () => void | Promise<void>): AsyncGenerator<StreamEvent> {
    const response = await this.fetcher(new URL('/companion/events', this.origin), { headers: { ...this.headers(), Accept: 'text/event-stream' }, signal })
    if (response.status === 401 || response.status === 403) throw new HubError('hub_unauthorized', true)
    if (!response.ok || !response.body) throw new HubError('hub_stream_unavailable')
    if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) throw new HubError('hub_contract_invalid', true)
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', firstFrame = true
    try {
      while (true) {
        const next = await reader.read(); if (next.done) throw new HubError('hub_stream_ended')
        buffer += decoder.decode(next.value, { stream: true }).replace(/\r\n/g, '\n')
        if (buffer.length > 1_048_576) throw new HubError('hub_contract_invalid', true)
        let boundary: number
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2)
          let type = 'message', id = ''; const dataLines: string[] = []
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) type = line.slice(6).trim()
            else if (line.startsWith('id:')) id = line.slice(3).trim()
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
          }
          const data = dataLines.join('\n')
          if (firstFrame) {
            firstFrame = false
            if (type !== 'connected' || id || data !== '{}') throw new HubError('hub_contract_invalid', true)
            await onConnected?.()
            continue
          }
          if (type === 'heartbeat' || type === 'connected') continue
          if (type !== 'notification' || new TextEncoder().encode(data).byteLength > 131_072) throw new HubError('hub_contract_invalid', true)
          const seq = Number(id)
          if (!Number.isSafeInteger(seq) || seq <= 0) throw new HubError('hub_contract_invalid', true)
          let decoded: unknown
          try { decoded = JSON.parse(data) } catch { throw new HubError('hub_contract_invalid', true) }
          yield { seq, event: parseHubEvent(decoded) }
        }
      }
    } finally { await reader.cancel().catch(() => undefined) }
  }
  async ack(seq: number, eventId: string, signal?: AbortSignal): Promise<void> {
    const timeout = this.requestTimeoutSignal()
    const response = await this.fetcher(new URL('/companion/ack', this.origin), { method: 'POST', signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: { ...this.headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ seq, eventId }) })
    if (response.status === 401 || response.status === 403) throw new HubError('hub_unauthorized', true)
    if (!response.ok) throw new HubError(response.status === 409 ? 'hub_ack_conflict' : 'hub_ack_unavailable', response.status === 409)
  }
}
