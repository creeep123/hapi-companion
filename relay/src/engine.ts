import { HubClient, HubError } from './hub'
import { NtfyClient, NtfyError } from './ntfy'
import { clickUrl, evaluate } from './policy'
import { StateStore } from './state'
import type { AttentionCode } from './types'

export class RelayEngine {
  private controller?: AbortController; private task?: Promise<void>
  constructor(private store: StateStore, private ntfy = new NtfyClient(), private hubFactory = (o: string, c: any) => new HubClient(o, c), private sleep = abortableSleep) {}
  async start(): Promise<void> { if (this.task) return; const controller = new AbortController(); this.controller = controller; const task = this.run(controller.signal); this.task = task; task.finally(() => { if (this.task === task) this.task = undefined }).catch(() => undefined) }
  async stop(): Promise<void> { this.controller?.abort(); await this.task?.catch(() => undefined); this.controller = undefined }
  async restart(): Promise<void> { await this.stop(); await this.start() }
  private async run(signal: AbortSignal): Promise<void> {
    let attempt = 0
    while (!signal.aborted) {
      const state = await this.store.load()
      if (!state.enabled || !state.config || !state.credential) return
      await this.health('connecting')
      const hub = this.hubFactory(state.config.hapiOrigin, state.credential)
      try {
        for await (const item of hub.events(signal, () => this.health('connected'))) {
          await this.processHead(item.seq, item.event, hub, signal); attempt = 0
        }
      } catch (error) {
        if (signal.aborted) return
        if ((error instanceof HubError && error.permanent) || (error instanceof NtfyError && error.permanent)) { await this.health('attention', error.code); return }
        const requested = error instanceof NtfyError ? error.retryAfterMs : undefined
        const delay = requested ?? Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5)) + Math.floor(Math.random() * 250)
        const code: AttentionCode = error instanceof HubError ? error.code : error instanceof NtfyError ? error.code : 'network_temporary_failure'
        await this.health('connecting', code); await this.sleep(delay, signal)
      }
    }
  }
  private async processHead(seq: number, event: any, hub: HubClient, signal: AbortSignal): Promise<void> {
    const state = await this.store.load(); const existing = state.handled[event.eventId]
    if (existing ? existing.seq !== seq : seq <= (state.health.lastAckSeq ?? 0)) throw new HubError('hub_contract_invalid', true)
    if (!existing) {
      let reason: 'posted' | 'suppressed' | 'paused' = 'suppressed'
      if (!state.paused) {
        const decision = evaluate(event, state.config!)
        if (decision !== 'suppress') {
          await this.ntfy.post(state.config!, event, clickUrl(state.config!, event.sessionId), decision === 'quiet', signal)
          reason = 'posted'
        }
      } else reason = 'paused'
      await this.store.update(s => { s.handled[event.eventId] = { seq, at: Date.now(), reason }; if (reason === 'posted') s.health.latestNtfyAcceptanceAt = Date.now(); prune(s.handled) })
    }
    await hub.ack(seq, event.eventId, signal)
    await this.store.update(s => { s.health.stream = 'connected'; s.health.lastAckSeq = seq; delete s.health.attentionCode })
  }
  private health(stream: 'connecting' | 'connected' | 'attention', attentionCode?: AttentionCode) { return this.store.update(s => { s.health.stream = stream; if (attentionCode) s.health.attentionCode = attentionCode; else delete s.health.attentionCode }) }
}
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('aborted', 'AbortError'))
    const timer = setTimeout(done, ms)
    function done() { signal.removeEventListener('abort', aborted); clearTimeout(timer); resolve() }
    function aborted() { signal.removeEventListener('abort', aborted); clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')) }
    signal.addEventListener('abort', aborted, { once: true })
  })
}
function prune(handled: Record<string, { seq: number; at: number; reason: 'posted' | 'suppressed' | 'paused' }>) {
  const cutoff = Date.now() - 35 * 24 * 3600_000
  for (const [id, value] of Object.entries(handled)) if (value.at < cutoff) delete handled[id]
}
