import { describe, expect, test } from 'bun:test'
import { EventInterpreter, extractTask } from '../src/interpreter'

const session = (overrides: Record<string, unknown> = {}) => ({ id: 's/1', title: '项目开发', active: true, thinking: false, metadata: { agent: 'Codex' }, ...overrides })

describe('EventInterpreter', () => {
  test('baseline does not notify old requests and only emits new input/permission IDs', () => {
    const i = new EventInterpreter('https://hapi.example', 'ns', () => 10_000)
    i.baseline([session({ agentState: { requests: { old: { tool: 'Bash' } } } })])
    const out = i.observeSession(session({ agentState: { requests: { old: { tool: 'Bash' }, ask: { tool: 'functions.request_user_input' }, edit: { tool: 'Edit' } } } }), 'e1')
    expect(out.map(x => x.event.kind)).toEqual(['input-request', 'permission-request'])
    expect(out.map(x => x.event.requestId)).toEqual(['ask', 'edit'])
    expect(i.observeSession(session({ agentState: { requests: { ask: { tool: 'request_user_input' } } } }), 'e2')).toEqual([])
  })

  test('emits ready with exact encoded URL, deterministic ID and known duration', () => {
    let now = 10_000; const i = new EventInterpreter('https://hapi.example', 'ns', () => now)
    i.baseline([session({ thinking: true, activeTurnStartedAt: 1_000 })])
    now = 11_000; i.observeSession(session({ thinking: false, activeTurnStartedAt: null }), 'state')
    const message = { content: { type: 'event', data: { type: 'ready' } } }
    const first = i.observe({ type: 'message-received', sessionId: 's/1', message }, 'epoch:1')
    expect(first[0].event).toMatchObject({ kind: 'ready', url: '/sessions/s%2F1', durationMs: 10_000 })
    expect(first[0].event.eventId).toBe(i.observe({ type: 'message-received', sessionId: 's/1', message }, 'epoch:1')[0]?.event.eventId ?? first[0].event.eventId)
  })

  test('suppresses generic completion after richer completed task', () => {
    let now = 20_000; const i = new EventInterpreter('https://hapi.example', 'ns', () => now); i.baseline([session()])
    const task = { content: { type: 'output', data: { type: 'system', subtype: 'task_notification', summary: 'Done', status: 'completed' } } }
    expect(i.observe({ type: 'message-received', sessionId: 's/1', message: task }, 'm1')[0].event.kind).toBe('task-notification')
    now += 5_000; expect(i.observe({ type: 'session-ended', sessionId: 's/1', reason: 'completed' }, 'e2')).toEqual([])
    now += 6_000; expect(i.observe({ type: 'session-ended', sessionId: 's/1', reason: 'completed' }, 'e3')[0].event.kind).toBe('session-completed')
  })

  test('extracts wrapped task notification', () => {
    expect(extractTask({ content: { content: { type: 'output', data: { type: 'user', content: '<task-notification><summary>Child done</summary><status>success</status></task-notification>' } } } })).toEqual({ summary: 'Child done', status: 'success' })
  })
})
