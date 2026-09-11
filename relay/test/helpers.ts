import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CompanionEvent, RelayConfig, ReminderPolicy } from '../src/types'

export async function statePath() { return join(await mkdtemp(join(tmpdir(), 'hapi-relay-')), 'state.json') }
export const policy = (overrides: Partial<ReminderPolicy> = {}): ReminderPolicy => ({ scope: 'all', selectedSessionIds: [], keywords: [], durationEnabled: false, minimumMinutes: 1, quietEnabled: false, quietStartMinutes: 1320, quietEndMinutes: 480, quietMode: 'mute', timeZone: 'UTC', ...overrides })
export const config = (overrides: Partial<RelayConfig> = {}): RelayConfig => ({ receiverId: 'phone', ntfyBaseUrl: 'https://ntfy.sh', topic: 'abcdefghijklmnopqrstuv', hapiOrigin: 'https://hapi.example', revision: 1, contentMode: 'fixed', policy: policy(), ...overrides })
export const event = (overrides: Partial<CompanionEvent> = {}): CompanionEvent => ({ version: 1, eventId: crypto.randomUUID(), createdAt: Date.now(), kind: 'ready', title: 'Ready', body: 'Done', severity: 'success', sessionId: 'session/id', sessionName: '项目开发', url: '/sessions/session%2Fid', ...overrides })
