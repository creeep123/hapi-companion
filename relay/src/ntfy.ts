import type { AttentionCode, CompanionEvent, RelayConfig } from './types'

export class NtfyError extends Error { constructor(readonly code: Extract<AttentionCode, `ntfy_${string}`>, readonly permanent: boolean, readonly retryAfterMs?: number) { super(code) } }
export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
export class NtfyClient {
  constructor(private readonly fetcher: Fetcher = fetch, private readonly timeoutSignal: () => AbortSignal = () => AbortSignal.timeout(15_000)) {}
  async post(config: RelayConfig, event: CompanionEvent, click: string, quiet: boolean, signal?: AbortSignal): Promise<void> {
    const base = new URL(config.ntfyBaseUrl)
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new NtfyError('ntfy_invalid_url', true)
    const endpoint = new URL(base.pathname.replace(/\/$/, '') || '/', base)
    const response = await this.fetcher(endpoint, {
      method: 'POST', redirect: 'manual', signal: signal ? AbortSignal.any([signal, this.timeoutSignal()]) : this.timeoutSignal(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: config.topic, title: event.kind === 'permission-request' ? 'HAPI 需要你处理' : 'HAPI 任务已完成', message: event.kind === 'permission-request' ? '请打开 HAPI 处理请求' : '请打开 HAPI 查看结果', click, ...(quiet ? { priority: 2 } : {}) })
    })
    if (response.status === 429) throw new NtfyError('ntfy_rate_limited', false, parseRetryAfter(response.headers.get('retry-after')))
    if (response.status >= 500 || response.status === 408) throw new NtfyError('ntfy_temporary_failure', false)
    if (!response.ok || response.status >= 300) throw new NtfyError('ntfy_configuration_error', true)
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().includes('application/json')) throw new NtfyError('ntfy_invalid_response', true)
    const body = await response.json().catch(() => null) as any
    if (!body || body.event !== 'message' || body.topic !== config.topic || typeof body.id !== 'string' || !body.id) throw new NtfyError('ntfy_invalid_response', true)
  }
}
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value); if (Number.isFinite(seconds)) return Math.min(300_000, Math.max(0, seconds * 1000))
  const date = Date.parse(value); return Number.isFinite(date) ? Math.min(300_000, Math.max(0, date - Date.now())) : undefined
}
