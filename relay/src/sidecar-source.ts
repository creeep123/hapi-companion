import type { ConsumerBroker } from './consumer-broker'
import { EventInterpreter } from './interpreter'
import { OfficialHapiClient, OfficialHapiError, type OfficialStreamItem } from './official-hapi'
import { SidecarStorageLimitError, type SidecarStore } from './sidecar-store'
import type { OfficialSession, OfficialSessionSummary } from './types'
import type { ConsumerKind } from './sidecar-store'

type SourceClient = Pick<OfficialHapiClient, 'catalog' | 'session' | 'messages' | 'events'>

export class SidecarSourceEngine {
  private controller?: AbortController
  private task?: Promise<void>
  private baselineReady = false
  private deliveryKinds: ConsumerKind[]
  private mutationTail: Promise<void> = Promise.resolve()
  private pendingCursor?: string
  private pendingCursorCount = 0
  private pendingCatalogTouches = new Map<string, number>()
  private lastCursorFlushAt = 0
  constructor(
    private readonly store: SidecarStore,
    private readonly interpreter: EventInterpreter,
    private readonly broker: ConsumerBroker,
    private readonly client: SourceClient,
    private readonly sleep = abortableSleep,
    private readonly onEvent: () => void = () => {},
    targetKinds: ConsumerKind[] = ['mac', 'ntfy']
  ) { this.deliveryKinds = [...targetKinds] }
  setDeliveryActive(active: boolean) { this.deliveryKinds = active ? ['mac', 'ntfy'] : [] }
  async activateDelivery(commit: () => Promise<void>) {
    await this.exclusive(async () => { if (!this.isLive()) throw new Error('official_source_not_live'); await commit(); this.setDeliveryActive(true) })
  }
  isLive() { return this.store.sourceStatus().state === 'live' }
  start() { if (!this.task) { this.controller = new AbortController(); const task = this.run(this.controller.signal); this.task = task; task.finally(() => { if (this.task === task) this.task = undefined }).catch(() => undefined) } }
  async stop() { this.controller?.abort(); await this.task?.catch(() => undefined); this.controller = undefined }

  private async run(signal: AbortSignal) {
    let attempt = 0
    while (!signal.aborted) {
      if (!this.store.ensureCapacity()) { this.store.sourceHealth('attention', 'storage_limit'); await this.sleep(30_000, signal); continue }
      this.store.sourceHealth('connecting')
      try { await this.connection(signal); attempt = 0 }
      catch (error) {
        if (signal.aborted) return
        const permanent = error instanceof OfficialHapiError && error.permanent
        const code = error instanceof SidecarStorageLimitError ? 'storage_limit' : error instanceof SidecarReconcileOverflowError ? 'source_reconcile_overflow' : error instanceof OfficialHapiError ? `source_${error.code}` : 'source_unavailable'
        const requiresAttention = permanent || error instanceof SidecarStorageLimitError || error instanceof SidecarReconcileOverflowError
        this.store.sourceHealth(requiresAttention ? 'attention' : 'connecting', code)
        if (permanent) return
        await this.sleep(Math.min(30_000, 1000 * 2 ** Math.min(attempt++, 5)) + Math.floor(Math.random() * 250), signal)
      }
    }
  }

  private async connection(signal: AbortSignal) {
    const saved = this.store.interpreterState()
    if (saved && !this.baselineReady) { this.interpreter.restoreState(saved); this.baselineReady = true }
    const local = new AbortController(), activeSignal = AbortSignal.any([signal, local.signal])
    const iterator = this.client.events(this.store.sourceCursor(), activeSignal)[Symbol.asyncIterator]()
    const first = await iterator.next()
    if (first.done || first.value.type !== 'connected') throw new OfficialHapiError('contract_invalid', true)
    const queue = new BoundedEventQueue(2048, 8 * 1024 * 1024, () => local.abort())
    const pump = this.pump(iterator, queue, activeSignal)
    try {
      if (first.value.connected.resume === 'gap') this.discardPendingCursor()
      if (first.value.connected.resume === 'gap' || !this.baselineReady) await this.exclusive(() => this.resync(activeSignal))
      this.store.sourceHealth('live')
      for await (const item of queue.items(activeSignal)) await this.exclusive(() => this.apply(item, activeSignal))
      await pump
    } catch (error) { queue.throwIfFailed(); throw error }
    finally {
      local.abort(); queue.close(); await iterator.return?.(undefined).catch(() => undefined)
      await this.exclusive(async () => this.flushPendingCursor())
    }
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
    const hadState = this.baselineReady
    const before = hadState ? this.interpreter.exportState() : undefined
    const catalog = await this.client.catalog(signal)
    const details: OfficialSession[] = []
    for (let start = 0; start < catalog.length; start += 8) {
      details.push(...await Promise.all(catalog.slice(start, start + 8).map(summary =>
        summary.active || (summary.pendingRequestsCount ?? 0) > 0 ? this.client.session(summary.id, signal) : Promise.resolve(summary)
      )))
    }
    try {
      const candidates = []
      if (!hadState) this.interpreter.baseline(details)
      else for (const detail of details) candidates.push(...this.interpreter.observeSession(detail, `reconcile:${detail.id}`))
      const requestSessionIds = [...new Set(candidates
        .filter(candidate => candidate.event.kind === 'input-request' || candidate.event.kind === 'permission-request')
        .map(candidate => candidate.event.sessionId))]
      if (requestSessionIds.length) {
        await this.sleep(500, signal)
        const pending = new Map<string, Set<string>>()
        for (let start = 0; start < requestSessionIds.length; start += 8) {
          const refreshed = await Promise.all(requestSessionIds.slice(start, start + 8).map(id => this.client.session(id, signal)))
          for (const session of refreshed) {
            pending.set(session.id, new Set(requestIds(session)))
            candidates.push(...this.interpreter.observeSession(session, `reconcile:${session.id}`))
          }
        }
        for (let index = candidates.length - 1; index >= 0; index--) {
          const event = candidates[index].event
          if (event.requestId && !pending.get(event.sessionId)?.has(event.requestId)) candidates.splice(index, 1)
        }
      }
      this.interpreter.clearMessageWatermarks()
      if (!hadState) this.store.commitBaseline(catalog.map(catalogItem), this.interpreter.exportState())
      else this.store.commitReconciliation(candidates, catalog.map(catalogItem), this.interpreter.exportState(), this.deliveryKinds)
      this.baselineReady = true
      if (candidates.length) { this.broker.signal(); this.onEvent() }
    } catch (error) { if (before) this.interpreter.restoreState(before); throw error }
  }

  private async apply(item: Extract<OfficialStreamItem, { type: 'event' }>, signal: AbortSignal) {
    const { id, event } = item.frame
    if (!id) throw new OfficialHapiError('contract_invalid', true)
    if (event.type === 'session-updated' && event.sessionId && !this.interpreter.sessionPatchNeedsRefresh(event.sessionId, event.data)) {
      const updatedAt = event.data && typeof event.data === 'object' && Number.isSafeInteger((event.data as any).updatedAt) ? Number((event.data as any).updatedAt) : undefined
      this.pendingCursor = id; this.pendingCursorCount++
      if (updatedAt !== undefined) this.pendingCatalogTouches.set(event.sessionId, updatedAt)
      if (this.lastCursorFlushAt === 0 || this.pendingCursorCount >= 64 || Date.now() - this.lastCursorFlushAt >= 5_000) this.flushPendingCursor()
      return
    }
    this.flushPendingCursor()
    const before = this.interpreter.exportState()
    let candidates, catalog: ReturnType<typeof catalogItem>[] | undefined
    if ((event.type === 'session-added' || event.type === 'session-updated') && event.sessionId) {
      let session = await this.client.session(event.sessionId, signal)
      candidates = this.interpreter.observeSession(session, id)
      if (candidates.some(candidate => candidate.event.kind === 'input-request' || candidate.event.kind === 'permission-request')) {
        await this.sleep(500, signal)
        const pending = new Set(requestIds(session = await this.client.session(event.sessionId, signal)))
        candidates = candidates.filter(candidate => !candidate.event.requestId || pending.has(candidate.event.requestId))
        this.interpreter.observeSession(session, id)
      }
      catalog = await this.refreshCatalog(signal)
    } else {
      candidates = this.interpreter.observe(event, id)
      if (event.sessionId && candidates.some(candidate => candidate.event.kind === 'ready')) {
        const latest = await this.client.messages(event.sessionId, { limit: 50 }, signal)
        candidates = this.interpreter.enrichReady(candidates, latest.messages)
      }
      if (event.type === 'session-removed' || event.type === 'session-ended') catalog = await this.refreshCatalog(signal)
    }
    try { this.store.commitObservation(candidates, id, this.interpreter.exportState(), this.deliveryKinds, catalog) }
    catch (error) { this.interpreter.restoreState(before); throw error }
    this.broker.signal(); if (candidates.length) this.onEvent()
  }
  private flushPendingCursor() {
    if (!this.pendingCursor) return
    const cursor = this.pendingCursor
    const touches = [...this.pendingCatalogTouches].map(([sessionId, updatedAt]) => ({ sessionId, updatedAt }))
    this.store.advanceCursor(cursor, touches)
    this.pendingCursor = undefined; this.pendingCursorCount = 0; this.pendingCatalogTouches.clear(); this.lastCursorFlushAt = Date.now()
  }
  private discardPendingCursor() { this.pendingCursor = undefined; this.pendingCursorCount = 0; this.pendingCatalogTouches.clear() }
  private async refreshCatalog(signal: AbortSignal) { return (await this.client.catalog(signal)).map(catalogItem) }
  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail
    let release!: () => void
    this.mutationTail = new Promise<void>(resolve => { release = resolve })
    await previous
    try { return await operation() } finally { release() }
  }
}

function catalogItem(item: OfficialSessionSummary) { return { id: item.id, title: item.metadata?.name ?? item.title, updatedAt: item.updatedAt, active: item.active, machineName: item.metadata?.machineId ?? item.machineId } }
function requestIds(session: OfficialSession): string[] {
  const value = session.agentState?.requests
  if (Array.isArray(value)) return value.map(item => item.id)
  return value && typeof value === 'object' ? Object.keys(value) : []
}

class BoundedEventQueue {
  private queue: Array<Extract<OfficialStreamItem, { type: 'event' }>> = []
  private bytes = 0; private waiter?: () => void; private waiterCleanup?: () => void; private error?: unknown; private ended = false
  constructor(private maxItems: number, private maxBytes: number, private onOverflow = () => {}) {}
  push(item: Extract<OfficialStreamItem, { type: 'event' }>) {
    const size = new TextEncoder().encode(JSON.stringify(item)).byteLength
    if (this.queue.length >= this.maxItems || this.bytes + size > this.maxBytes) { const error = new SidecarReconcileOverflowError(); this.fail(error); this.onOverflow(); throw error }
    this.queue.push(item); this.bytes += size; this.waiterCleanup?.(); this.waiterCleanup = undefined; this.waiter?.(); this.waiter = undefined
  }
  fail(error: unknown) { this.error = error; this.ended = true; this.waiterCleanup?.(); this.waiterCleanup = undefined; this.waiter?.(); this.waiter = undefined }
  close() { this.ended = true; this.waiterCleanup?.(); this.waiterCleanup = undefined; this.waiter?.(); this.waiter = undefined }
  throwIfFailed() { if (this.error) throw this.error }
  async *items(signal: AbortSignal) {
    while (true) {
      while (this.queue.length) { const item = this.queue.shift()!; this.bytes -= new TextEncoder().encode(JSON.stringify(item)).byteLength; yield item }
      if (this.error) throw this.error
      if (this.ended) return
      await new Promise<void>((resolve, reject) => {
        this.waiter = resolve
        const abort = () => { this.waiter = undefined; reject(new DOMException('aborted', 'AbortError')) }
        signal.addEventListener('abort', abort, { once: true })
        this.waiterCleanup = () => signal.removeEventListener('abort', abort)
      })
    }
  }
}
class SidecarReconcileOverflowError extends Error { constructor() { super('source_reconcile_overflow') } }
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> { return new Promise((resolve, reject) => { const timer = setTimeout(done, ms); function done() { signal.removeEventListener('abort', abort); resolve() } function abort() { clearTimeout(timer); reject(new DOMException('aborted', 'AbortError')) } signal.addEventListener('abort', abort, { once: true }) }) }
