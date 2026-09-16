import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { SidecarStore } from '../src/sidecar-store'
import { event } from './helpers'

const stores: SidecarStore[] = []
afterEach(() => { while (stores.length) stores.pop()!.close() })

describe('deployed shadow report permissions', () => {
  test('runs as the state/key owner with private unit-equivalent paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shadow-report-')), stateDir = join(root, 'state')
    await mkdir(stateDir, { mode: 0o700 }); const dbPath = join(stateDir, 'sidecar.sqlite'), statePath = join(stateDir, 'state.json'), keyPath = join(stateDir, 'shadow-report.key')
    const store = new SidecarStore(dbPath); store.bindSource('https://hapi.example', 'namespace'); store.append({ sourceKey: 'one', event: event({ sessionId: 'private-session', body: 'private-body' }) }, 'cursor', []); store.close()
    await Bun.write(keyPath, crypto.getRandomValues(new Uint8Array(32))); await chmod(keyPath, 0o600)
    const child = Bun.spawn([process.execPath, 'run', resolve(import.meta.dir, '../src/main.ts'), 'sidecar-shadow-report', keyPath], {
      cwd: resolve(import.meta.dir, '..'), env: { ...process.env, HAPI_MOBILE_RELAY_STATE: statePath, HAPI_SIDECAR_DB: dbPath }, stdout: 'pipe', stderr: 'pipe'
    })
    expect(await child.exited).toBe(0); const output = await new Response(child.stdout).text(), report = JSON.parse(output)
    expect(report).toMatchObject({ version: 1, highWaterSeq: 1, observations: [{ kind: 'ready', count: 1 }] }); expect(output).not.toContain('private-session'); expect(output).not.toContain('private-body')
  })
})
