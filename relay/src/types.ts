export type QuietMode = 'mute' | 'suppress'
export type ReminderPolicy = {
  scope: 'all' | 'specified'; selectedSessionIds: string[]; keywords: string[]
  durationEnabled: boolean; minimumMinutes: number
  quietEnabled: boolean; quietStartMinutes: number; quietEndMinutes: number
  quietMode: QuietMode; timeZone: string
}
export type RelayConfig = {
  receiverId: string; ntfyBaseUrl: string; topic: string; hapiOrigin: string
  policy: ReminderPolicy; revision: number
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
  bootstrap?: { hash: string; expiresAt: number; failures: number; sources: Record<string, number> }
  config?: RelayConfig; credential?: HubCredential; activation?: Activation
  enabled: boolean; paused: boolean; handled: Record<string, { seq: number; at: number; reason: 'posted' | 'suppressed' | 'paused' }>
  health: HealthState
}
export type CompanionEvent = {
  version: 1; eventId: string; createdAt: number
  kind: 'ready' | 'permission-request' | 'task-notification' | 'session-completed'
  title: string; body: string; severity: 'info' | 'success' | 'warning' | 'error'
  sessionId: string; sessionName: string; machineId?: string; url: string
  requestId?: string; tag?: string; durationMs?: number
}
export type StreamEvent = { seq: number; event: CompanionEvent }
