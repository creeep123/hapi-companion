import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConsumerBroker } from '../src/consumer-broker'
import { EventInterpreter } from '../src/interpreter'
import { SidecarSourceEngine } from '../src/sidecar-source'
import { SidecarStore } from '../src/sidecar-store'

const stores: SidecarStore[] = []
async function setup(client: any) { const root = await mkdtemp(join(tmpdir(), 'source-')); const dir = join(root, 'state'); await mkdir(dir, { mode: 0o700 }); const store = new SidecarStore(join(dir, 'db')); stores.push(store); store.bindSource('https://hapi.example', 'ns'); const credential = store.createConsumer('mac'); const broker = new ConsumerBroker(store); return { store, credential, engine: new SidecarSourceEngine(store, new EventInterpreter('https://hapi.example', 'ns', () => 20_000), broker, client, async () => { throw new DOMException('aborted', 'AbortError') }) } }
afterEach(() => { while (stores.length) stores.pop()!.close() })

describe('SidecarSourceEngine', () => {
  test('gap snapshots before applying buffered live event and commits it', async () => {
    let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve })
    const client = {
      catalog: async () => { await hold; return [{ id: 's1', title: 'One', active: true }] },
      session: async () => ({ id: 's1', title: 'One', active: true }),
      events: async function* () { yield { type: 'connected', connected: { resume: 'gap' } }; yield { type: 'event', frame: { id: 'epoch:1', event: { type: 'session-ended', sessionId: 's1', reason: 'completed' } } } }
    }
    const { store, credential, engine } = await setup(client); engine.start(); await Bun.sleep(10); expect(store.pending(credential.consumerId)).toEqual([])
    release(); for (let i = 0; i < 20 && !store.pending(credential.consumerId).length; i++) await Bun.sleep(5)
    expect(store.pending(credential.consumerId)[0]?.event.kind).toBe('session-completed'); expect(store.sourceCursor()).toBe('epoch:1'); await engine.stop()
  })
  test('does not notify existing state on cold gap baseline', async () => {
    const client = {
      catalog: async () => [{ id: 's1', title: 'One', active: true, pendingRequestsCount: 1 }],
      session: async () => ({ id: 's1', title: 'One', active: true, agentState: { requests: { old: { tool: 'Bash' } } } }),
      events: async function* () { yield { type: 'connected', connected: { resume: 'gap' } } }
    }
    const { store, credential, engine } = await setup(client); engine.start(); await Bun.sleep(20); expect(store.pending(credential.consumerId)).toEqual([]); expect(store.catalog().sessions).toHaveLength(1); await engine.stop()
  })
})
