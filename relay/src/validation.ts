import type { RelayConfig, ReminderPolicy } from './types'

export const defaultPolicy = (): ReminderPolicy => ({ scope: 'all', selectedSessionIds: [], keywords: [], durationEnabled: false, minimumMinutes: 1, quietEnabled: false, quietStartMinutes: 1320, quietEndMinutes: 480, quietMode: 'mute', timeZone: 'UTC' })
export function parseConfig(input: any): RelayConfig {
  if (!input || typeof input !== 'object') throw new Error('invalid config')
  const hapi = new URL(input.hapiOrigin), ntfy = new URL(input.ntfyBaseUrl)
  if (hapi.protocol !== 'https:' || hapi.origin + '/' !== hapi.href || hapi.username || hapi.password) throw new Error('invalid HAPI origin')
  if (ntfy.protocol !== 'https:' || ntfy.username || ntfy.password || ntfy.search || ntfy.hash) throw new Error('invalid ntfy base URL')
  if (typeof input.topic !== 'string' || input.topic.length < 22 || input.topic.length > 256 || !/^[A-Za-z0-9_-]+$/.test(input.topic)) throw new Error('invalid topic')
  if (typeof input.receiverId !== 'string' || !input.receiverId || input.receiverId.length > 512 || /[\u0000-\u001f\u007f]/.test(input.receiverId) || typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) || input.revision < 1) throw new Error('invalid identity/revision')
  const contentMode = input.contentMode === undefined ? 'fixed' : input.contentMode
  if (contentMode !== 'fixed' && contentMode !== 'eventPreview') throw new Error('invalid content mode')
  const p = { ...defaultPolicy(), ...(input.policy ?? {}) }
  if (!['all', 'specified'].includes(p.scope) || !Array.isArray(p.selectedSessionIds) || p.selectedSessionIds.length > 10_000 || !Array.isArray(p.keywords) || p.keywords.length > 1_000 || p.selectedSessionIds.some((x: any) => typeof x !== 'string' || !x || x.length > 512 || /[\u0000-\u001f\u007f]/.test(x)) || p.keywords.some((x: any) => typeof x !== 'string' || x.length > 512 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(x))) throw new Error('invalid scope')
  if (typeof p.durationEnabled !== 'boolean' || typeof p.quietEnabled !== 'boolean' || !Number.isFinite(p.minimumMinutes) || p.minimumMinutes < 0 || p.minimumMinutes > 525_600 || !Number.isInteger(p.quietStartMinutes) || !Number.isInteger(p.quietEndMinutes) || p.quietStartMinutes < 0 || p.quietStartMinutes > 1439 || p.quietEndMinutes < 0 || p.quietEndMinutes > 1439 || !['mute', 'suppress'].includes(p.quietMode)) throw new Error('invalid policy')
  if (typeof p.timeZone !== 'string' || p.timeZone.length > 128) throw new Error('invalid time zone')
  try { new Intl.DateTimeFormat('en', { timeZone: p.timeZone }).format() } catch { throw new Error('invalid time zone') }
  return { receiverId: input.receiverId, ntfyBaseUrl: ntfy.href.replace(/\/$/, ''), topic: input.topic, hapiOrigin: hapi.origin, revision: input.revision, contentMode, policy: p }
}
