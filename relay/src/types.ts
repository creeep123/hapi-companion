export type QuietMode = 'mute' | 'suppress'
export type ReminderPolicy = {
  scope: 'all' | 'specified'; selectedSessionIds: string[]; keywords: string[]
  durationEnabled: boolean; minimumMinutes: number
  quietEnabled: boolean; quietStartMinutes: number; quietEndMinutes: number
  quietMode: QuietMode; timeZone: string
}
export type RelayConfig = {
  receiverId: string; ntfyBaseUrl: string; topic: string; hapiOrigin: string
  policy: ReminderPolicy; revision: number; contentMode: 'fixed' | 'eventPreview'
}
export type HubCredential = { deviceId: string; token: string }
export type Activation = {
  activationId: string; installationId: string; status: 'committed' | 'rejected'
  deviceId?: string; requestFingerprint: string; rejectionCode?: string
}
export type HealthState = {
  stream: 'stopped' | 'connecting' | 'connected' | 'attention'
  lastAckSeq?: number; latestNtfyAcceptanceAt?: number; attentionCode?: AttentionCode
}
export type AttentionCode = 'hub_unauthorized' | 'hub_contract_invalid' | 'hub_stream_unavailable' | 'hub_stream_ended' | 'hub_ack_conflict' | 'hub_ack_unavailable' | 'ntfy_invalid_url' | 'ntfy_rate_limited' | 'ntfy_temporary_failure' | 'ntfy_configuration_error' | 'ntfy_invalid_response' | 'network_temporary_failure'
export type PersistedState = {
  schemaVersion: 1; managementTokenHash?: string
  sourceMode?: 'patchedHub' | 'officialHapi'
  officialCutoverAt?: number
  bootstrap?: { hash: string; expiresAt: number; failures: number; sources: Record<string, number> }
  config?: RelayConfig; credential?: HubCredential; activation?: Activation
  enabled: boolean; paused: boolean; handled: Record<string, { seq: number; at: number; reason: 'posted' | 'suppressed' | 'paused' }>
  health: HealthState
}
export type CompanionEvent = {
  version: 1; eventId: string; createdAt: number
  kind: 'ready' | 'permission-request' | 'input-request' | 'task-notification' | 'session-completed'
  title: string; body: string; severity: 'info' | 'success' | 'warning' | 'error'
  sessionId: string; sessionName: string; machineId?: string; url: string
  requestId?: string; tag?: string; durationMs?: number
}
export type StreamEvent = { seq: number; event: CompanionEvent }

export type OfficialSessionSummary = {
  id: string; title?: string; active?: boolean; thinking?: boolean
  activeTurnStartedAt?: number | null; activeAt?: number; updatedAt?: number
  pendingRequestsCount?: number; machineId?: string
  metadata?: { name?: string; machineId?: string; flavor?: string | null; path?: string } | null
}
export type OfficialRequest = { id: string; tool?: string; arguments?: unknown }
export type OfficialSession = OfficialSessionSummary & {
  metadataVersion?: number
  agentStateVersion?: number
  agentState?: { requests?: Record<string, unknown> | OfficialRequest[] } | null
}
export type OfficialSyncEvent = {
  type: string; sessionId?: string; reason?: string; data?: unknown
  message?: unknown; namespace?: string
}
export type OfficialFrame = { id?: string; event: OfficialSyncEvent }
export type OfficialMessage = { id?: string; seq: number; createdAt: number; invokedAt?: number | null; content: unknown }
export type OfficialMessagesPage = {
  messages: OfficialMessage[]
  page: { epoch: number; reset: boolean; nextAfterSeq: number | null; nextAfterAt: number | null; snapshotHeadSeq: number | null; snapshotHeadAt: number | null; hasMore: boolean }
}

export function isOfficialSession(value: unknown, expectedId?: string): value is OfficialSession {
  if (!record(value) || typeof value.id !== 'string' || !value.id || value.id.length > 512 || (expectedId !== undefined && value.id !== expectedId)) return false
  if (!optionalString(value.title) || !optionalBoolean(value.active) || !optionalBoolean(value.thinking)) return false
  if (!optionalTime(value.activeAt) || !optionalTime(value.updatedAt) || !optionalTime(value.metadataVersion) || !optionalTime(value.agentStateVersion)) return false
  if (value.activeTurnStartedAt !== undefined && value.activeTurnStartedAt !== null && !time(value.activeTurnStartedAt)) return false
  if (!optionalString(value.machineId) || !metadata(value.metadata) || !agentState(value.agentState)) return false
  return true
}

function metadata(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (!record(value)) return false
  return ['name', 'machineId', 'path'].every(key => optionalString(value[key]))
    && (value.flavor === undefined || value.flavor === null || typeof value.flavor === 'string')
}
function agentState(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (!record(value) || value.requests === undefined) return record(value)
  if (Array.isArray(value.requests)) return value.requests.every(request => record(request) && typeof request.id === 'string' && optionalString(request.tool))
  return record(value.requests) && Object.values(value.requests).every(request => record(request) && optionalString(request.tool))
}
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const optionalString = (value: unknown) => value === undefined || typeof value === 'string'
const optionalBoolean = (value: unknown) => value === undefined || typeof value === 'boolean'
const time = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const optionalTime = (value: unknown) => value === undefined || time(value)
