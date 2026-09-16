import { NtfyClient, NtfyError } from './ntfy'
import { clickUrl, evaluate } from './policy'
import type { SidecarStore } from './sidecar-store'
import type { StateStore } from './state'

export class NtfyConsumer {
  private running = false; private pending = false; private timer?: ReturnType<typeof setTimeout>
  constructor(private sidecar: SidecarStore, private legacy: StateStore, private client = new NtfyClient(), readonly consumerId = '00000000-0000-4000-8000-000000000001') { sidecar.ensureInternalConsumer(consumerId, 'ntfy') }
  start() { this.signal() }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = undefined; this.pending = false }
  signal() { this.pending = true; if (!this.running) void this.drain() }
  private async drain() {
    this.running = true
    try {
      while (this.pending) {
        this.pending = false
        const state = await this.legacy.load()
        if (!state.enabled || state.paused || !state.config) return
        for (const item of this.sidecar.pending(this.consumerId, 100)) {
          const decision = evaluate(item.event, state.config)
          if (decision === 'suppress') { this.sidecar.markNtfy(this.consumerId, item.seq, 'suppressed', 'policy'); continue }
          try {
            await this.client.post(state.config, item.event, clickUrl(state.config, item.event.sessionId), decision === 'quiet')
            this.sidecar.markNtfy(this.consumerId, item.seq, 'accepted')
            await this.legacy.update(s => { s.health.latestNtfyAcceptanceAt = Date.now() })
          } catch (error) {
            if (error instanceof NtfyError && error.permanent) { this.sidecar.markNtfy(this.consumerId, item.seq, 'failed', error.code); await this.legacy.update(s => { s.health.stream = 'attention'; s.health.attentionCode = error.code }); return }
            const delay = error instanceof NtfyError && error.retryAfterMs ? error.retryAfterMs : 5_000
            this.timer = setTimeout(() => { this.timer = undefined; this.signal() }, delay); return
          }
        }
      }
    } finally { this.running = false; if (this.pending) this.signal() }
  }
}
