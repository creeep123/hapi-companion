import type { CompanionEvent, RelayConfig } from './types'

export type PolicyDecision = 'sound' | 'quiet' | 'suppress'
const normalizeKeyword = (s: string) => s.trim().toLocaleLowerCase()
function minutesAt(epochMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epochMs))
  return Number(parts.find(p => p.type === 'hour')!.value) * 60 + Number(parts.find(p => p.type === 'minute')!.value)
}
function isQuiet(epochMs: number, config: RelayConfig): boolean {
  const p = config.policy, value = minutesAt(epochMs, p.timeZone), start = p.quietStartMinutes, end = p.quietEndMinutes
  if (start === end) return true
  return start < end ? value >= start && value < end : value >= start || value < end
}
export function evaluate(event: CompanionEvent, config: RelayConfig, now = Date.now()): PolicyDecision {
  const p = config.policy
  if (p.scope === 'specified') {
    const name = event.sessionName.toLocaleLowerCase()
    const selected = p.selectedSessionIds.includes(event.sessionId) || p.keywords.map(normalizeKeyword).filter(Boolean).some(k => name.includes(k))
    if (!selected) return 'suppress'
  }
  if (p.durationEnabled && event.kind !== 'permission-request' && typeof event.durationMs === 'number' && Number.isFinite(event.durationMs) && event.durationMs >= 0 && event.durationMs <= p.minimumMinutes * 60_000) return 'suppress'
  if (p.quietEnabled && (isQuiet(now, config) || isQuiet(event.createdAt, config))) return p.quietMode === 'mute' ? 'quiet' : 'suppress'
  return 'sound'
}

export function clickUrl(config: RelayConfig, sessionId: string): string {
  if (!sessionId || sessionId.length > 512 || /[\u0000-\u001f\u007f]/.test(sessionId)) throw new Error('invalid session id')
  const origin = new URL(config.hapiOrigin)
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error('invalid HAPI origin')
  return new URL(`/sessions/${encodeURIComponent(sessionId)}`, origin.origin).href
}
