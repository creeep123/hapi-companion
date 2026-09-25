import { createHash } from 'node:crypto'
import { isOfficialSession, type CompanionEvent, type OfficialMessage, type OfficialRequest, type OfficialSession, type OfficialSyncEvent } from './types'

const INPUT_TOOLS = new Set(['request_user_input', 'AskUserQuestion', 'ask_user_question', 'CursorAskQuestion'])
const COMPLETE = new Set(['completed', 'complete', 'done', 'success'])
const FAILURE = new Set(['failed', 'error', 'killed', 'aborted'])

type Snapshot = {
  session: OfficialSession; requestIds: Set<string>; turnStartedAt?: number
  frozenDurationMs?: number; lastReadyAt?: number; lastTaskCompletionAt?: number
  messageEpoch?: number; messageAt?: number; messageSeq?: number
}
export type Candidate = { sourceKey: string; event: CompanionEvent }
export type SessionUpdateResult =
  | { status: 'applied'; candidates: Candidate[]; session: OfficialSession }
  | { status: 'needs-detail' }
export type InterpreterSessionState = {
  session: OfficialSession; requestIds: string[]; turnStartedAt?: number
  frozenDurationMs?: number; lastReadyAt?: number; lastTaskCompletionAt?: number
  messageEpoch?: number; messageAt?: number; messageSeq?: number
}
export type InterpreterState = { version: 1; sessions: InterpreterSessionState[] }

export class EventInterpreter {
  private snapshots = new Map<string, Snapshot>()
  constructor(private readonly publicOrigin: string, private readonly namespaceHash: string, private readonly now = () => Date.now()) {
    const url = new URL(publicOrigin)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error('invalid_public_origin')
  }

  baseline(sessions: OfficialSession[]): void {
    this.snapshots.clear()
    for (const session of sessions) this.snapshots.set(session.id, this.makeSnapshot(session))
  }

  exportState(): InterpreterState {
    return { version: 1, sessions: [...this.snapshots.values()].map(snapshot => this.persistSnapshot(snapshot)) }
  }

  private persistSnapshot(snapshot: Snapshot): InterpreterSessionState {
    return {
      session: persistedSession(snapshot.session), requestIds: [...snapshot.requestIds],
      ...(snapshot.turnStartedAt !== undefined ? { turnStartedAt: snapshot.turnStartedAt } : {}),
      ...(snapshot.frozenDurationMs !== undefined ? { frozenDurationMs: snapshot.frozenDurationMs } : {}),
      ...(snapshot.lastReadyAt !== undefined ? { lastReadyAt: snapshot.lastReadyAt } : {}),
      ...(snapshot.lastTaskCompletionAt !== undefined ? { lastTaskCompletionAt: snapshot.lastTaskCompletionAt } : {})
      , ...(snapshot.messageEpoch !== undefined ? { messageEpoch: snapshot.messageEpoch } : {})
      , ...(snapshot.messageAt !== undefined ? { messageAt: snapshot.messageAt } : {})
      , ...(snapshot.messageSeq !== undefined ? { messageSeq: snapshot.messageSeq } : {})
    }
  }

  clearMessageWatermarks(): void {
    for (const snapshot of this.snapshots.values()) {
      delete snapshot.messageEpoch
      delete snapshot.messageAt
      delete snapshot.messageSeq
    }
  }

  /**
   * Reduce the official HAPI structured SessionPatch into the local aggregate.
   * This mirrors the official Web reducer: scalar fields apply in place and
   * metadata/agentState apply only when their version is newer. Unknown wire
   * shapes are returned to the source adapter for one targeted detail fetch.
   */
  observeSessionUpdate(sessionId: string, data: unknown, sourceIdentity: string): SessionUpdateResult {
    const snapshot = this.snapshots.get(sessionId)
    if (!isObject(data) || Object.keys(data).length === 0) return { status: 'needs-detail' }

    // Some legacy/full-session broadcasts use Session rather than SessionPatch.
    if (typeof data.id === 'string') {
      return this.observeSessionSnapshot(sessionId, data, sourceIdentity)
    }
    if (!snapshot) return { status: 'needs-detail' }

    const known = new Set([
      'active', 'thinking', 'activeTurnStartedAt', 'activeAt', 'updatedAt',
      'metadata', 'agentState', 'todos', 'teamState', 'model',
      'modelReasoningEffort', 'effort', 'serviceTier', 'permissionMode',
      'collaborationMode', 'copilotAgentMode', 'backgroundTaskCount',
      'scratchlistUpdatedAt'
    ])
    if (Object.keys(data).some(key => !known.has(key))) return { status: 'needs-detail' }
    if (!validOptionalBoolean(data.active) || !validOptionalBoolean(data.thinking)) return { status: 'needs-detail' }
    if (!validOptionalTime(data.activeAt) || !validOptionalTime(data.updatedAt)) return { status: 'needs-detail' }
    if (data.activeTurnStartedAt !== undefined && data.activeTurnStartedAt !== null && !validTime(data.activeTurnStartedAt)) return { status: 'needs-detail' }
    if (data.metadata !== undefined && (!isVersionedValue(data.metadata) || !isMetadataValue(data.metadata.value))) return { status: 'needs-detail' }
    if (data.agentState !== undefined && (!isVersionedValue(data.agentState) || !isAgentStateValue(data.agentState.value))) return { status: 'needs-detail' }
    if (data.todos !== undefined && !isVersionedValue(data.todos)) return { status: 'needs-detail' }
    if (data.teamState !== undefined && !isVersionedValue(data.teamState)) return { status: 'needs-detail' }

    const next: OfficialSession = { ...snapshot.session }
    if (data.active !== undefined) next.active = data.active
    if (data.thinking !== undefined) next.thinking = data.thinking
    if (data.activeTurnStartedAt !== undefined) next.activeTurnStartedAt = data.activeTurnStartedAt
    if (data.activeAt !== undefined) next.activeAt = data.activeAt
    if (data.updatedAt !== undefined) next.updatedAt = Math.max(next.updatedAt ?? 0, data.updatedAt)

    if (data.metadata !== undefined && data.metadata.version > (next.metadataVersion ?? -1)) {
      next.metadata = data.metadata.value
      next.metadataVersion = data.metadata.version
    }
    if (data.agentState !== undefined && data.agentState.version > (next.agentStateVersion ?? -1)) {
      next.agentState = data.agentState.value as OfficialSession['agentState']
      next.agentStateVersion = data.agentState.version
    }

    const candidates = this.observeSession(next, sourceIdentity)
    return { status: 'applied', candidates, session: next }
  }

  observeSessionSnapshot(sessionId: string, data: unknown, sourceIdentity: string): SessionUpdateResult {
    if (!isOfficialSession(data, sessionId)) return { status: 'needs-detail' }
    const session = { ...data }
    return { status: 'applied', candidates: this.observeSession(session, sourceIdentity), session }
  }

  enrichReady(candidates: Candidate[], messages: OfficialMessage[]): Candidate[] {
    const text = [...messages].reverse().map(message => extractAssistantText(message)).find(Boolean)
    if (!text) return candidates
    const summary = extractNotifySummary(text)
    return candidates.map(candidate => candidate.event.kind !== 'ready' ? candidate : ({ ...candidate, event: {
      ...candidate.event, title: `${agentName(this.snapshots.get(candidate.event.sessionId)?.session ?? { id: candidate.event.sessionId })} - ${candidate.event.sessionName}`,
      body: summary ? [truncate(summary.summary, 280), summary.action ? truncate(`-> ${summary.action}`, 280) : ''].filter(Boolean).join('\n') : truncate(text, 280)
    } }))
  }

  restoreState(state: InterpreterState): void {
    if (state.version !== 1 || !Array.isArray(state.sessions)) throw new Error('invalid_interpreter_state')
    const restored = new Map<string, Snapshot>()
    for (const value of state.sessions) {
      if (!value?.session || typeof value.session.id !== 'string' || !Array.isArray(value.requestIds)) throw new Error('invalid_interpreter_state')
      restored.set(value.session.id, { ...value, requestIds: new Set(value.requestIds) })
    }
    this.snapshots = restored
  }

  observeSession(session: OfficialSession, sourceIdentity: string): Candidate[] {
    const prior = this.snapshots.get(session.id)
    const next = this.makeSnapshot(session, prior)
    this.snapshots.set(session.id, next)
    if (!session.active) return []
    const oldIds = prior?.requestIds ?? new Set<string>()
    return requests(session).filter(request => !oldIds.has(request.id)).map(request => this.requestCandidate(session, request, sourceIdentity))
  }

  observe(event: OfficialSyncEvent, sourceIdentity: string): Candidate[] {
    const id = event.sessionId
    if (!id) return []
    const snapshot = this.snapshots.get(id)
    if (event.type === 'session-removed') { this.snapshots.delete(id); return [] }
    if (event.type === 'session-updated' || event.type === 'session-added') {
      if (isObject(event.data)) return this.observeSession({ ...(snapshot?.session ?? { id }), ...event.data, id }, sourceIdentity)
      return []
    }
    if (!snapshot) return []
    if (event.type === 'session-ended') {
      if (event.reason !== 'completed' || this.now() - (snapshot.lastTaskCompletionAt ?? 0) < 10_000) return []
      return [this.candidate(snapshot.session, 'session-completed', sourceIdentity, 'Session completed', `${agentName(snapshot.session)} · ${sessionName(snapshot.session)} · Session finished`, 'success', snapshot.frozenDurationMs)]
    }
    if (event.type !== 'message-received') return []
    const task = extractTask(event.message)
    if (task) {
      if (task.status && COMPLETE.has(task.status.toLowerCase())) snapshot.lastTaskCompletionAt = this.now()
      const failed = !!task.status && FAILURE.has(task.status.toLowerCase())
      return [this.candidate(snapshot.session, 'task-notification', sourceIdentity, failed ? 'Task failed' : 'Task completed', `${agentName(snapshot.session)} · ${sessionName(snapshot.session)} · ${truncate(task.summary, 280)}`, failed ? 'error' : 'success')]
    }
    if (extractMessageEventType(event.message) !== 'ready' || !snapshot.session.active) return []
    if (this.now() - (snapshot.lastReadyAt ?? 0) < 5_000) return []
    snapshot.lastReadyAt = this.now()
    const text = extractAssistantText(event.message)
    const summary = text ? extractNotifySummary(text) : undefined
    const title = summary || text ? `${agentName(snapshot.session)} - ${sessionName(snapshot.session)}` : 'Ready for input'
    const body = summary ? [truncate(summary.summary, 280), summary.action ? truncate(`-> ${summary.action}`, 280) : ''].filter(Boolean).join('\n')
      : text ? truncate(text, 280) : `${agentName(snapshot.session)} is waiting in ${sessionName(snapshot.session)}`
    return [this.candidate(snapshot.session, 'ready', sourceIdentity, title, body, 'info', snapshot.frozenDurationMs)]
  }

  private makeSnapshot(session: OfficialSession, prior?: Snapshot): Snapshot {
    let turnStartedAt = prior?.turnStartedAt, frozenDurationMs = prior?.frozenDurationMs
    if (session.thinking && validTime(session.activeTurnStartedAt)) { turnStartedAt = session.activeTurnStartedAt; frozenDurationMs = undefined }
    else if (prior?.session.thinking && !session.thinking && prior.turnStartedAt !== undefined) { frozenDurationMs = Math.max(0, this.now() - prior.turnStartedAt); turnStartedAt = undefined }
    return { session, requestIds: new Set(requests(session).map(r => r.id)), turnStartedAt, frozenDurationMs, lastReadyAt: prior?.lastReadyAt, lastTaskCompletionAt: prior?.lastTaskCompletionAt, messageEpoch: prior?.messageEpoch, messageAt: prior?.messageAt, messageSeq: prior?.messageSeq }
  }

  private requestCandidate(session: OfficialSession, request: OfficialRequest, _sourceIdentity: string): Candidate {
    const tool = (request.tool ?? '').replace(/^functions\./, '')
    const kind = INPUT_TOOLS.has(tool) ? 'input-request' : 'permission-request'
    const title = kind === 'input-request' ? 'Input requested' : 'Permission Request'
    const body = [agentName(session), tool].filter(Boolean).join(' ') || `${agentName(session)} - ${sessionName(session)}`
    return this.candidate(session, kind, `request:${request.id}`, title, body, 'warning', undefined, request.id)
  }

  private candidate(session: OfficialSession, kind: CompanionEvent['kind'], sourceIdentity: string, title: string, body: string, severity: CompanionEvent['severity'], durationMs?: number, requestId?: string): Candidate {
    const sourceKey = `${this.namespaceHash}/${session.id}/${sourceIdentity}/${kind}`
    return { sourceKey, event: {
      version: 1, eventId: deterministicUUID(sourceKey), createdAt: this.now(), kind,
      title: truncate(title, 4096), body: truncate(body, 65_536), severity,
      sessionId: session.id, sessionName: truncate(sessionName(session), 4096),
      ...(session.metadata?.machineId || session.machineId ? { machineId: session.metadata?.machineId ?? session.machineId } : {}),
      url: new URL(`/sessions/${encodeURIComponent(session.id)}`, this.publicOrigin).toString(),
      ...(requestId ? { requestId } : {}), ...(durationMs !== undefined ? { durationMs: Math.floor(durationMs) } : {})
    } }
  }
}

export function extractMessageEventType(message: unknown): string | undefined {
  for (const value of messageCandidates(message)) {
    if (value.type === 'event' && isObject(value.data) && typeof value.data.type === 'string') return value.data.type
  }
}
export function extractTask(message: unknown): { summary: string; status?: string } | undefined {
  for (const value of messageCandidates(message)) {
    if (value.type !== 'output' || !isObject(value.data)) continue
    const data = value.data
    if (data.type === 'system' && data.subtype === 'task_notification' && typeof data.summary === 'string' && data.summary.trim()) return { summary: data.summary.trim(), ...(typeof data.status === 'string' ? { status: data.status.trim() } : {}) }
    if (data.type === 'user') {
      const content = typeof data.content === 'string' ? data.content : isObject(data.message) && typeof data.message.content === 'string' ? data.message.content : undefined
      if (content?.trimStart().startsWith('<task-notification>')) {
        const summary = content.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim()
        const status = content.match(/<status>([\s\S]*?)<\/status>/)?.[1]?.trim()
        if (summary) return { summary, ...(status ? { status } : {}) }
      }
    }
  }
}

function messageCandidates(message: unknown): Record<string, any>[] {
  if (!isObject(message)) return []
  const content = isObject(message.content) ? message.content : undefined
  const inner = content && isObject(content.content) ? content.content : undefined
  return [message, content, inner].filter(isObject)
}
function extractAssistantText(message: unknown): string | undefined {
  for (const value of messageCandidates(message)) {
    if (value.role === 'agent' && typeof value.content === 'string' && value.content.trim()) return value.content.trim()
    if (value.role === 'agent' && isObject(value.content) && typeof value.content.text === 'string' && value.content.text.trim()) return value.content.text.trim()
  }
}
function extractNotifySummary(text: string): { summary: string; action?: string } | undefined {
  const match = text.match(/AGENT_NOTIFY_SUMMARY\s+(\{[^\n]+\})\s*$/)
  if (!match) return
  try { const value = JSON.parse(match[1]); if (typeof value.summary === 'string' && value.summary.trim()) return { summary: value.summary.trim(), ...(typeof value.action === 'string' && value.action.trim() ? { action: value.action.trim() } : {}) } } catch {}
}
function requests(session: OfficialSession): OfficialRequest[] {
  const value = session.agentState?.requests
  if (Array.isArray(value)) return value.filter(x => isObject(x) && typeof x.id === 'string') as OfficialRequest[]
  if (!isObject(value)) return []
  return Object.entries(value).map(([id, item]) => ({ id, ...(isObject(item) ? item : {}) })) as OfficialRequest[]
}
function persistedSession(session: OfficialSession): OfficialSession {
  const pending = requests(session).map(request => ({ id: request.id, ...(request.tool ? { tool: request.tool } : {}) }))
  return {
    id: session.id,
    ...(session.title !== undefined ? { title: session.title } : {}),
    ...(session.active !== undefined ? { active: session.active } : {}),
    ...(session.thinking !== undefined ? { thinking: session.thinking } : {}),
    ...(session.activeTurnStartedAt !== undefined ? { activeTurnStartedAt: session.activeTurnStartedAt } : {}),
    ...(session.activeAt !== undefined ? { activeAt: session.activeAt } : {}),
    ...(session.updatedAt !== undefined ? { updatedAt: session.updatedAt } : {}),
    ...(session.machineId !== undefined ? { machineId: session.machineId } : {}),
    ...(session.metadataVersion !== undefined ? { metadataVersion: session.metadataVersion } : {}),
    ...(session.agentStateVersion !== undefined ? { agentStateVersion: session.agentStateVersion } : {}),
    ...(session.metadata === null ? { metadata: null } : session.metadata ? { metadata: {
      ...(session.metadata.name !== undefined ? { name: session.metadata.name } : {}),
      ...(session.metadata.machineId !== undefined ? { machineId: session.metadata.machineId } : {}),
      ...(session.metadata.flavor !== undefined ? { flavor: session.metadata.flavor } : {})
    } } : {}),
    ...(pending.length || session.agentState !== undefined ? { agentState: session.agentState === null ? null : { requests: pending } } : {})
  }
}
function sessionName(session: OfficialSession) { return session.metadata?.name?.trim() || session.title?.trim() || 'HAPI session' }
function agentName(session: OfficialSession) { const value = session.metadata?.flavor ?? (session as any).agent ?? 'HAPI'; return typeof value === 'string' && value.trim() ? value.trim() : 'HAPI' }
function truncate(value: string, limit: number) { const text = value.trim(); return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...` }
function deterministicUUID(value: string): string { const h = createHash('sha256').update(value).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}` }
function validTime(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
function validOptionalTime(value: unknown): value is number | undefined { return value === undefined || validTime(value) }
function validOptionalBoolean(value: unknown): value is boolean | undefined { return value === undefined || typeof value === 'boolean' }
function isVersionedValue(value: unknown): value is { version: number; value: any } {
  return isObject(value) && validTime(value.version) && Object.prototype.hasOwnProperty.call(value, 'value')
}
function isMetadataValue(value: unknown): boolean {
  if (value === null) return true
  if (!isObject(value)) return false
  return ['name', 'machineId', 'path'].every(key => value[key] === undefined || typeof value[key] === 'string')
    && (value.flavor === undefined || value.flavor === null || typeof value.flavor === 'string')
}
function isAgentStateValue(value: unknown): boolean {
  if (value === null) return true
  if (!isObject(value)) return false
  const pending = value.requests
  if (pending === undefined) return true
  if (Array.isArray(pending)) return pending.every(request => isObject(request) && typeof request.id === 'string' && (request.tool === undefined || typeof request.tool === 'string'))
  if (!isObject(pending)) return false
  return Object.values(pending).every(request => isObject(request) && (request.tool === undefined || typeof request.tool === 'string'))
}
const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
