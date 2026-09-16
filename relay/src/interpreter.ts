import { createHash } from 'node:crypto'
import type { CompanionEvent, OfficialMessage, OfficialMessagesPage, OfficialRequest, OfficialSession, OfficialSyncEvent } from './types'

const INPUT_TOOLS = new Set(['request_user_input', 'AskUserQuestion', 'ask_user_question', 'CursorAskQuestion'])
const COMPLETE = new Set(['completed', 'complete', 'done', 'success'])
const FAILURE = new Set(['failed', 'error', 'killed', 'aborted'])

type Snapshot = {
  session: OfficialSession; requestIds: Set<string>; turnStartedAt?: number
  frozenDurationMs?: number; lastReadyAt?: number; lastTaskCompletionAt?: number
  messageEpoch?: number; messageAt?: number; messageSeq?: number
}
export type Candidate = { sourceKey: string; event: CompanionEvent }
export type InterpreterState = { version: 1; sessions: Array<{
  session: OfficialSession; requestIds: string[]; turnStartedAt?: number
  frozenDurationMs?: number; lastReadyAt?: number; lastTaskCompletionAt?: number
  messageEpoch?: number; messageAt?: number; messageSeq?: number
}> }

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
    return { version: 1, sessions: [...this.snapshots.values()].map(snapshot => ({
      session: persistedSession(snapshot.session), requestIds: [...snapshot.requestIds],
      ...(snapshot.turnStartedAt !== undefined ? { turnStartedAt: snapshot.turnStartedAt } : {}),
      ...(snapshot.frozenDurationMs !== undefined ? { frozenDurationMs: snapshot.frozenDurationMs } : {}),
      ...(snapshot.lastReadyAt !== undefined ? { lastReadyAt: snapshot.lastReadyAt } : {}),
      ...(snapshot.lastTaskCompletionAt !== undefined ? { lastTaskCompletionAt: snapshot.lastTaskCompletionAt } : {})
      , ...(snapshot.messageEpoch !== undefined ? { messageEpoch: snapshot.messageEpoch } : {})
      , ...(snapshot.messageAt !== undefined ? { messageAt: snapshot.messageAt } : {})
      , ...(snapshot.messageSeq !== undefined ? { messageSeq: snapshot.messageSeq } : {})
    })) }
  }

  messageCursor(sessionId: string): { epoch: number; at: number; seq: number } | undefined {
    const value = this.snapshots.get(sessionId)
    return value?.messageEpoch !== undefined && value.messageAt !== undefined && value.messageSeq !== undefined
      ? { epoch: value.messageEpoch, at: value.messageAt, seq: value.messageSeq } : undefined
  }

  sessionPatchNeedsRefresh(sessionId: string, data: unknown): boolean {
    const snapshot = this.snapshots.get(sessionId)
    if (!snapshot || !isObject(data)) return true
    const ignored = new Set(['updatedAt', 'activeAt', 'collaborationMode', 'effort', 'model', 'modelReasoningEffort', 'permissionMode', 'serviceTier'])
    const compared = new Set(['active', 'thinking', 'activeTurnStartedAt'])
    for (const [key, value] of Object.entries(data)) {
      if (ignored.has(key)) continue
      if (compared.has(key)) { if ((snapshot.session as Record<string, unknown>)[key] !== value) return true; continue }
      return true
    }
    return false
  }

  baselineMessages(sessionId: string, page: OfficialMessagesPage): void {
    const snapshot = this.snapshots.get(sessionId); if (!snapshot) return
    snapshot.messageEpoch = page.page.epoch
    if (page.page.snapshotHeadAt !== null && page.page.snapshotHeadSeq !== null) {
      snapshot.messageAt = page.page.snapshotHeadAt; snapshot.messageSeq = page.page.snapshotHeadSeq
    } else { snapshot.messageAt = 0; snapshot.messageSeq = 0 }
  }

  observeMessages(sessionId: string, page: OfficialMessagesPage): Candidate[] {
    const snapshot = this.snapshots.get(sessionId); if (!snapshot) return []
    const current = this.messageCursor(sessionId)
    if (page.page.reset || (current && current.epoch !== page.page.epoch)) { this.baselineMessages(sessionId, page); return [] }
    const candidates: Candidate[] = []
    for (const message of page.messages) {
      const at = message.invokedAt ?? message.createdAt
      candidates.push(...this.observe({ type: 'message-received', sessionId, message }, `message:${page.page.epoch}:${at}:${message.seq}`))
    }
    const at = page.page.nextAfterAt ?? page.page.snapshotHeadAt
    const seq = page.page.nextAfterSeq ?? page.page.snapshotHeadSeq
    snapshot.messageEpoch = page.page.epoch
    if (at !== null && seq !== null) { snapshot.messageAt = at; snapshot.messageSeq = seq }
    return candidates
  }

  liveMessageIdentity(sessionId: string, message: unknown, fallback: string): string {
    if (!isObject(message) || !Number.isSafeInteger(message.seq) || !Number.isSafeInteger(message.createdAt)) return fallback
    const snapshot = this.snapshots.get(sessionId), at = Number.isSafeInteger(message.invokedAt) ? Number(message.invokedAt) : Number(message.createdAt)
    if (snapshot?.messageEpoch !== undefined) { snapshot.messageAt = at; snapshot.messageSeq = Number(message.seq) }
    return `message:${snapshot?.messageEpoch ?? 'live'}:${at}:${message.seq}`
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
    ...(session.machineId !== undefined ? { machineId: session.machineId } : {}),
    ...(session.metadata ? { metadata: {
      ...(session.metadata.name !== undefined ? { name: session.metadata.name } : {}),
      ...(session.metadata.machineId !== undefined ? { machineId: session.metadata.machineId } : {}),
      ...(session.metadata.flavor !== undefined ? { flavor: session.metadata.flavor } : {})
    } } : {}),
    ...(pending.length ? { agentState: { requests: pending } } : {})
  }
}
function sessionName(session: OfficialSession) { return session.metadata?.name?.trim() || session.title?.trim() || 'HAPI session' }
function agentName(session: OfficialSession) { const value = session.metadata?.flavor ?? (session as any).agent ?? 'HAPI'; return typeof value === 'string' && value.trim() ? value.trim() : 'HAPI' }
function truncate(value: string, limit: number) { const text = value.trim(); return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...` }
function deterministicUUID(value: string): string { const h = createHash('sha256').update(value).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}` }
function validTime(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
