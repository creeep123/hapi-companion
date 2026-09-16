import type { RelayManager } from './manager'
import type { SidecarStore } from './sidecar-store'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export class SidecarManager {
  constructor(private legacy: RelayManager, private store: SidecarStore, private publicOrigin: string, private sidecarOrigin: string, private sourceReady = () => true, private activateDelivery = () => {}) {}
  authorized(token: string) { return this.legacy.authorized(token) }
  async status() { const state = await this.legacy.store.load(); return { version: 2, source: this.store.sourceStatus(), delivery: { enabled: state.enabled && state.sourceMode === 'officialHapi', cutoverAt: state.officialCutoverAt ?? null } } }
  configure(input: unknown, expectedRevision: number) { return this.legacy.configure(input, expectedRevision) }
  activateNtfy(receiverId: string) { return this.legacy.activateOfficial(receiverId, this.sourceReady, this.activateDelivery) }
  createConsumer(input: unknown) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_consumer')
    const value = input as Record<string, unknown>
    if (typeof value.installationId !== 'string' || !UUID.test(value.installationId) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120) throw new Error('invalid_consumer')
    if (typeof value.publicHapiOrigin !== 'string' || normalize(value.publicHapiOrigin) !== normalize(this.publicOrigin)) throw new Error('source_binding_mismatch')
    const credential = this.store.createConsumer('mac')
    return { ...credential, publicHapiOrigin: normalize(this.publicOrigin), sidecarAPIOrigin: normalize(this.sidecarOrigin), contractVersion: 1 }
  }
  revoke(id: string) { if (!UUID.test(id)) throw new Error('invalid_consumer'); this.store.revokeConsumer(id) }
}
function normalize(value: string) { const url = new URL(value); if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error('invalid_origin'); return `${url.protocol}//${url.host}` }
