import { randomSecret, secretHash, secretMatches } from './crypto'
import { RelayEngine } from './engine'
import { NtfyClient } from './ntfy'
import { clickUrl } from './policy'
import { StateStore } from './state'
import type { CompanionEvent, RelayConfig } from './types'
import { parseConfig } from './validation'

export class RelayManager {
  constructor(readonly store: StateStore, readonly engine: RelayEngine, private ntfy = new NtfyClient(), private now = () => Date.now()) {}
  async createPairCode(): Promise<string> {
    const code = randomSecret(24)
    await this.store.update(s => { s.bootstrap = { hash: secretHash(code), expiresAt: this.now() + 600_000, failures: 0, sources: {} } })
    return code
  }
  async pair(code: string, source = 'unknown'): Promise<string> {
    const sourceKey = secretHash(source)
    const result = await this.store.update(s => {
      if (!s.bootstrap || s.bootstrap.expiresAt < this.now() || s.bootstrap.failures >= 20 || (s.bootstrap.sources[sourceKey] ?? 0) >= 5 || !secretMatches(code, s.bootstrap.hash)) {
        if (s.bootstrap) { s.bootstrap.failures++; s.bootstrap.sources[sourceKey] = (s.bootstrap.sources[sourceKey] ?? 0) + 1 }
        return null
      }
      delete s.bootstrap; const token = randomSecret(); s.managementTokenHash = secretHash(token); return token
    })
    if (!result) throw new Error('invalid pairing code')
    return result
  }
  async authorized(token: string): Promise<boolean> { return secretMatches(token, (await this.store.load()).managementTokenHash) }
  async configure(input: unknown, expectedRevision: number): Promise<RelayConfig> {
    const config = parseConfig(input)
    const result = await this.store.update(s => {
      const current = s.config?.revision ?? 0
      if (current !== expectedRevision || config.revision !== expectedRevision + 1) throw new ConflictError(current)
      if (s.config && s.config.receiverId !== config.receiverId) throw new ConflictError(current)
      if (s.activation?.status === 'committed' && s.config?.hapiOrigin !== config.hapiOrigin) throw new ConflictError(current)
      s.config = config; return config
    })
    if ((await this.store.load()).enabled) await this.engine.restart()
    return result
  }
  async test(sessionId: string): Promise<void> {
    const s = await this.store.load(); if (!s.config) throw new Error('not configured')
    const event: CompanionEvent = { version: 1, eventId: crypto.randomUUID(), createdAt: this.now(), kind: 'session-completed', title: '', body: '', severity: 'success', sessionId, sessionName: '', url: '' }
    await this.ntfy.post({ ...s.config, contentMode: 'fixed' }, event, clickUrl(s.config, event.sessionId), false)
    await this.store.update(x => { x.health.latestNtfyAcceptanceAt = this.now() })
  }
  async activate(input: any): Promise<'committed'> {
    if (!input || !uuid(input.activationId) || !uuid(input.installationId) || !uuid(input.deviceId) || typeof input.token !== 'string' || input.token.length < 32 || input.token.length > 4096) throw new Error('invalid activation')
    if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw new Error('invalid activation')
    const fingerprint = secretHash(JSON.stringify([input.activationId, input.installationId, input.deviceId, secretHash(input.token), input.revision]))
    await this.store.update(s => {
      if (s.activation) {
        if (s.activation.activationId !== input.activationId || s.activation.requestFingerprint !== fingerprint) throw new ConflictError(s.config?.revision ?? 0)
        if (s.activation.status === 'committed') return
        throw new Error(s.activation.rejectionCode ?? 'activation_rejected')
      }
      if (!s.config || s.config.revision !== input.revision) throw new ConflictError(s.config?.revision ?? 0)
      s.credential = { deviceId: input.deviceId, token: input.token }
      s.activation = { activationId: input.activationId, installationId: input.installationId, status: 'committed', deviceId: input.deviceId, requestFingerprint: fingerprint }
      s.enabled = true; s.paused = false; s.health.stream = 'connecting'
    })
    await this.engine.start(); return 'committed'
  }
  async repair(input: any): Promise<void> {
    if (!input || !uuid(input.activationId) || !uuid(input.installationId) || !uuid(input.deviceId) || typeof input.token !== 'string' || input.token.length < 32 || input.token.length > 4096) throw new Error('invalid repair')
    await this.engine.stop()
    await this.store.update(s => {
      if (!s.activation || s.activation.status !== 'committed' || s.activation.activationId !== input.activationId || s.activation.installationId !== input.installationId) throw new ConflictError(s.config?.revision ?? 0)
      s.credential = { deviceId: input.deviceId, token: input.token }; s.activation.deviceId = input.deviceId; s.health = { stream: 'connecting' }
    })
    await this.engine.start()
  }
  async pause(paused: boolean): Promise<void> { await this.store.update(s => { if (!s.activation) throw new Error('not activated'); s.paused = paused }); await this.engine.start() }
  async resume(): Promise<void> { const s = await this.store.load(); if (!s.enabled || !s.activation) throw new Error('not activated'); await this.engine.restart() }
  async remove(): Promise<void> {
    await this.engine.stop()
    await this.store.update(s => { s.enabled = false; s.paused = false; delete s.config; delete s.credential; delete s.activation; s.handled = {}; s.health = { stream: 'stopped' } })
  }
  async unpair(): Promise<void> { await this.remove(); await this.store.update(s => { delete s.managementTokenHash; delete s.bootstrap }) }
}
export class ConflictError extends Error { constructor(readonly revision: number) { super('revision conflict') } }
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
