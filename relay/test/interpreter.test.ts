import { describe, expect, test } from 'bun:test'
import { EventInterpreter, extractTask } from '../src/interpreter'

const session = (overrides: Record<string, unknown> = {}) => ({ id: 's/1', active: true, thinking: false, metadata: { name: '项目开发', flavor: 'codex' }, ...overrides })

describe('EventInterpreter', () => {
  test('applies official versioned metadata and agent-state patches without a detail refresh', () => {
    const i = new EventInterpreter('https://hapi.example', 'ns', () => 20_000)
    i.baseline([session({ metadataVersion: 1, agentStateVersion: 1, agentState: { requests: {} } })])

    const result = i.observeSessionUpdate('s/1', {
      metadata: { version: 2, value: { name: '新标题', flavor: 'codex', machineId: 'machine-2' } },
      agentState: { version: 2, value: { requests: { ask: { tool: 'request_user_input' } } } },
      updatedAt: 19_000
    }, 'patch:2')

    expect(result.status).toBe('applied')
    if (result.status !== 'applied') throw new Error('expected applied patch')
    expect(result.candidates.map(item => [item.event.kind, item.event.requestId])).toEqual([['input-request', 'ask']])
    expect(result.session).toMatchObject({
      metadataVersion: 2,
      agentStateVersion: 2,
      metadata: { name: '新标题', machineId: 'machine-2' },
      updatedAt: 19_000
    })
  })

  test('rejects stale versioned patches and falls back only for unknown shapes', () => {
    const i = new EventInterpreter('https://hapi.example', 'ns', () => 20_000)
    i.baseline([session({
      metadataVersion: 4,
      agentStateVersion: 4,
      metadata: { name: 'Current', flavor: 'codex' },
      agentState: { requests: { existing: { tool: 'Bash' } } }
    })])

    const stale = i.observeSessionUpdate('s/1', {
      metadata: { version: 3, value: { name: 'Stale', flavor: 'codex' } },
      agentState: { version: 3, value: { requests: { duplicate: { tool: 'Write' } } } }
    }, 'patch:stale')
    expect(stale.status).toBe('applied')
    if (stale.status !== 'applied') throw new Error('expected applied patch')
    expect(stale.candidates).toEqual([])
    expect(stale.session).toMatchObject({ metadataVersion: 4, agentStateVersion: 4, metadata: { name: 'Current' } })

    expect(i.observeSessionUpdate('s/1', { futureField: true }, 'patch:future')).toEqual({ status: 'needs-detail' })
    expect(i.observeSessionUpdate('missing', { updatedAt: 1 }, 'patch:missing')).toEqual({ status: 'needs-detail' })
  })

  test('falls back for malformed metadata and request values inside valid version wrappers', () => {
    const i = new EventInterpreter('https://hapi.example', 'ns', () => 20_000)
    i.baseline([session({ metadataVersion: 1, agentStateVersion: 1, agentState: { requests: {} } })])

    expect(i.observeSessionUpdate('s/1', {
      metadata: { version: 2, value: { name: 42 } }
    }, 'patch:bad-metadata')).toEqual({ status: 'needs-detail' })
    expect(i.observeSessionUpdate('s/1', {
      agentState: { version: 2, value: { requests: { ask: { tool: 42 } } } }
    }, 'patch:bad-request')).toEqual({ status: 'needs-detail' })
    expect(i.exportState().sessions[0]?.session).toMatchObject({ metadataVersion: 1, agentStateVersion: 1 })
  })

  test('applies version zero without a watermark and replaces from a full Session snapshot', () => {
    const i = new EventInterpreter('https://hapi.example', 'ns', () => 20_000)
    i.baseline([session({ metadata: { name: 'Old', flavor: 'codex' }, agentState: { requests: { old: { tool: 'Bash' } } } })])
    const zero = i.observeSessionUpdate('s/1', {
      metadata: { version: 0, value: { name: 'Zero', flavor: 'codex' } },
      agentState: { version: 0, value: { requests: { fresh: { tool: 'Write' } } } }
    }, 'patch:zero')
    expect(zero.status).toBe('applied')
    if (zero.status !== 'applied') throw new Error('expected applied patch')
    expect(zero.session).toMatchObject({ metadataVersion: 0, agentStateVersion: 0, metadata: { name: 'Zero' } })
    expect(zero.candidates.map(item => item.event.requestId)).toEqual(['fresh'])

    const full = i.observeSessionUpdate('s/1', { id: 's/1', active: true, thinking: false, title: 'Replacement' }, 'full:1')
    expect(full.status).toBe('applied')
    if (full.status !== 'applied') throw new Error('expected full snapshot')
    expect(full.session).toEqual({ id: 's/1', active: true, thinking: false, title: 'Replacement' })
    expect(i.exportState().sessions[0]?.requestIds).toEqual([])
  })

  test('falls back instead of accepting a malformed full Session payload', () => {
    const i = new EventInterpreter('https://hapi.example', 'ns')
    i.baseline([session()])
    expect(i.observeSessionSnapshot('s/1', { id: 's/1', active: true, metadata: { name: 42 } }, 'full:bad')).toEqual({ status: 'needs-detail' })
    expect(i.observeSessionSnapshot('s/1', { id: 's/1', active: 'yes' }, 'full:bad-active')).toEqual({ status: 'needs-detail' })
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

  test('freezes turn duration when an official structured patch ends thinking', () => {
    let now = 10_000
    const i = new EventInterpreter('https://hapi.example', 'ns', () => now)
    i.baseline([session({ thinking: true, activeTurnStartedAt: 1_000 })])
    now = 12_000
    const update = i.observeSessionUpdate('s/1', { thinking: false, activeTurnStartedAt: null, updatedAt: 12_000 }, 'state:done')
    expect(update.status).toBe('applied')
    const ready = i.observe({ type: 'message-received', sessionId: 's/1', message: { content: { type: 'event', data: { type: 'ready' } } } }, 'ready:done')
    expect(ready[0]?.event.durationMs).toBe(11_000)
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
