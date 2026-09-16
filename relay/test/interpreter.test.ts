import { describe, expect, test } from 'bun:test'
import { EventInterpreter, extractTask } from '../src/interpreter'

const session = (overrides: Record<string, unknown> = {}) => ({ id: 's/1', active: true, thinking: false, metadata: { name: '项目开发', flavor: 'codex' }, ...overrides })

describe('EventInterpreter', () => {
  test('filters session patches that cannot change notification semantics', () => {
    const i = new EventInterpreter('https://hapi.example', 'ns', () => 20_000)
    i.baseline([session({ active: true, thinking: true, activeTurnStartedAt: 10_000 })])
    expect(i.sessionPatchNeedsRefresh('s/1', { updatedAt: 20_000, model: 'new-model', copilotAgentMode: 'plan', thinking: true, activeTurnStartedAt: 10_000 })).toBeFalse()
    expect(i.sessionPatchNeedsRefresh('s/1', { thinking: false })).toBeTrue()
    expect(i.sessionPatchNeedsRefresh('s/1', { agentState: { version: 2, value: {} } })).toBeTrue()
    expect(i.sessionPatchNeedsRefresh('s/1', { unknownFutureField: true })).toBeTrue()
    expect(i.sessionPatchNeedsRefresh('missing', { updatedAt: 20_000 })).toBeTrue()
  })
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
    expect(first[0].event).toMatchObject({ kind: 'ready', url: 'https://hapi.example/sessions/s%2F1', durationMs: 10_000 })
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
  test('official-shaped fixtures cover all five semantic notification kinds', () => {
    let now = 20_000; const i = new EventInterpreter('https://hapi.example', 'ns', () => now)
    i.baseline([session({ thinking: true, activeTurnStartedAt: 10_000, agentState: { requests: {} } })])
    let output = i.observeSession(session({ thinking: false, agentState: { requests: { input: { tool: 'request_user_input' }, permission: { tool: 'Bash' } } } }), 'state:1')
    expect(output.map(item => item.event.kind)).toEqual(['input-request', 'permission-request'])
    output = i.observe({ type: 'message-received', sessionId: 's/1', message: { seq: 1, createdAt: now, content: { type: 'event', data: { type: 'ready' } } } }, 'message:1')
    expect(output[0]?.event.kind).toBe('ready')
    now += 6_000
    output = i.observe({ type: 'message-received', sessionId: 's/1', message: { seq: 2, createdAt: now, content: { type: 'output', data: { type: 'system', subtype: 'task_notification', summary: 'Indexed', status: 'completed' } } } }, 'message:2')
    expect(output[0]?.event.kind).toBe('task-notification')
    now += 11_000
    output = i.observe({ type: 'session-ended', sessionId: 's/1', reason: 'completed' }, 'event:3')
    expect(output[0]?.event.kind).toBe('session-completed')
  })

  test('durable checkpoint excludes request arguments and unrelated session metadata', () => {
    const i = new EventInterpreter('https://hapi.example', 'ns')
    i.baseline([session({
      machineId: 'machine', metadata: { name: 'Project', flavor: 'codex', machineId: 'metadata-machine', path: '/secret/path' },
      agentState: { requests: { request: { tool: 'Bash', arguments: { token: 'must-not-persist' } } } },
      unrelated: { transcript: 'must-not-persist' }
    })])
    const encoded = JSON.stringify(i.exportState())
    expect(encoded).not.toContain('must-not-persist'); expect(encoded).not.toContain('/secret/path')
    expect(i.exportState().sessions[0]?.session).toMatchObject({ id: 's/1', metadata: { name: 'Project', flavor: 'codex', machineId: 'metadata-machine' }, agentState: { requests: [{ id: 'request', tool: 'Bash' }] } })

    const restored = new EventInterpreter('https://hapi.example', 'ns'); restored.restoreState(i.exportState())
    expect(restored.observeSession(session({ agentState: { requests: { request: { tool: 'Bash' }, new: { tool: 'Edit' } } } }), 'next').map(value => value.event.requestId)).toEqual(['new'])
  })

  test('enriches a ready event from the latest assistant summary without persisting the message', () => {
    const i = new EventInterpreter('https://hapi.example', 'ns', () => 20_000); i.baseline([session()])
    const candidates = i.observe({ type: 'message-received', sessionId: 's/1', message: { content: { type: 'event', data: { type: 'ready' } } } }, 'ready:1')
    const enriched = i.enrichReady(candidates, [{ seq: 1, createdAt: 19_000, content: { role: 'agent', content: 'Finished indexing' } }])
    expect(enriched[0]?.event).toMatchObject({ title: 'codex - 项目开发', body: 'Finished indexing' })
    expect(JSON.stringify(i.exportState())).not.toContain('Finished indexing')
  })
})
