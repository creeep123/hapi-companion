import type { ConsumerBroker } from './consumer-broker'
import { EventInterpreter } from './interpreter'
import { OfficialHapiClient, OfficialHapiError, type OfficialStreamItem } from './official-hapi'
import type { SidecarStore } from './sidecar-store'
import type { OfficialSession, OfficialSessionSummary } from './types'

type SourceClient = Pick<OfficialHapiClient, 'catalog' | 'session' | 'events'>

export class SidecarSourceEngine {
  private controller?: AbortController
  private task?: Promise<void>
  constructor(
    private readonly store: SidecarStore,
    private readonly interpreter: EventInterpreter,
    private readonly broker: ConsumerBroker,
    private readonly client: SourceClient,
    private readonly sleep = abortableSleep,
    private readonly onEvent: () => void = () => {}
  ) {}
  start() { if (!this.task) { this.controller = new AbortController(); const task = this.run(this.controller.signal); this.task = task; task.finally(() => { if (this.task === task) this.task = undefined }).catch(() => undefined) } }
  async stop() { this.controller?.abort(); await this.task?.catch(() => undefined); this.controller = undefined }

  private async run(signal: AbortSignal) {
    let attempt = 0
    while (!signal.aborted) {
      this.store.sourceHealth('connecting')
      try { await this.connection(signal); attempt = 0 }
      catch (error) {
        if (signal.aborted) return
        const permanent = error instanceof OfficialHapiError && error.permanent
        this.store.sourceHealth(permanent ? 'attention' : 'connecting', error instanceof OfficialHapiError ? `source_${error.code}` : 'source_unavailable')
        if (permanent) return
        await this.sleep(Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5)) + Math.floor(Math.random() * 250), signal)
      }
    }
  }

  private async connection(signal: AbortSignal) {
    const iterator = this.client.events(this.store.sourceCursor(), signal)[Symbol.asyncIterator]()
    const first = await iterator.next()
    if (first.done || first.value.type !== 'connected') throw new OfficialHapiError('contract_invalid', true)
    const queue = new BoundedEventQueue(2048, 8 * 1024 * 1024)
    const pump = this.pump(iterator, queue, signal)
    try {
      if (first.value.connected.resume === 'gap') await this.resync(signal)
      this.store.sourceHealth('live')
      for await (const item of queue.items(signal)) await this.apply(item)
      await pump
    } finally { queue.close(); await iterator.return?.(undefined).catch(() => undefined) }
  }

  private async pump(iterator: AsyncIterator<OfficialStreamItem>, queue: BoundedEventQueue, signal: AbortSignal) {
    try {
      while (!signal.aborted) {
        const next = await iterator.next()
        if (next.done) throw new OfficialHapiError('stream_ended')
        if (next.value.type === 'event') queue.push(next.value)
      }
    } catch (error) { queue.fail(error) }
  }

  private async resync(signal: AbortSignal) {
    const catalog = await this.client.catalog(signal)
    const details: OfficialSession[] = []
    for (const summary of catalog) {
      if (summary.active || (summary.pendingRequestsCount ?? 0) > 0) details.push(await this.client.session(summary.id, signal))
      else details.push(summary)
    }
    this.store.replaceCatalog(catalog.map(catalogItem))
    this.interpreter.baseline(details)
  }

  private async apply(item: Extract<OfficialStreamItem, { type: 'event' }>) {
    const { id, event } = item.frame
    if (!id) throw new OfficialHapiError('contract_invalid', true)
    let candidates
    if ((event.type === 'session-added' || event.type === 'session-updated') && event.sessionId) {
      const session = await this.client.session(event.sessionId)
      candidates = this.interpreter.observeSession(session, id)
      await this.refreshCatalog()
    } else candidates = this.interpreter.observe(event, id)
    if (!candidates.length) this.store.advanceCursor(id)
    else for (const candidate of candidates) this.store.append(candidate, id)
    this.broker.signal(); if (candidates.length) this.onEvent()
  }
  private async refreshCatalog() { const catalog = await this.client.catalog(); this.store.replaceCatalog(catalog.map(catalogItem)) }
}

function catalogItem(item: OfficialSessionSummary) { return { id: item.id, title: item.title, updatedAt: item.updatedAt, active: item.active, machineName: (item as any).machineName } }

class BoundedEventQueue {
  private queue: Array<Extract<OfficialStreamItem, { type: 'event' }>> = []
  private bytes = 0; private waiter?: () => void; private error?: unknown; private ended = false
  constructor(private maxItems: number, private maxBytes: number) {}
  push(item: Extract<OfficialStreamItem, { type: 'event' }>) {
    const size = new TextEncoder().encode(JSON.stringify(item)).byteLength
    if (this.queue.length >= this.maxItems || this.bytes + size > this.maxBytes) { const error = new OfficialHapiError('unavailable'); this.fail(error); throw error }
    this.queue.push(item); this.bytes += size; this.waiter?.(); this.waiter = undefined
  }
  fail(error: unknown) { this.error = error; this.ended = true; this.waiter?.(); this.waiter = undefined }
  close() { this.ended = true; this.waiter?.(); this.waiter = undefined }
  async *items(signal: AbortSignal) {
    while (true) {
      while (this.queue.length) { const item = this.queue.shift()!; this.bytes -= new TextEncoder().encode(JSON.stringify(item)).byteLength; yield item }
      if (this.error) throw this.error
      if (this.ended) return
      await new Promise<void>((resolve, reject) => {
        this.waiter = resolve
        const abort = () => { this.waiter = undefined; reject(new DOMException('aborted', 'AbortError')) }
        signal.addEventListener('abort', abort, { once: true })
      })
    }
  }
}
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> { return new Promise((resolve, reject) => { const timer = setTimeout(done, ms); function done() { signal.removeEventListener('abort', abort); resolve() } function abort() { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')) } signal.addEventListener('abort', abort, { once: true }) }) }
