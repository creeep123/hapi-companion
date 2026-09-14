import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

const installer = resolve(import.meta.dir, '../../scripts/install-mobile-relay.sh')
describe('Linux installer validation', () => {
  test.each(['..', '../1.2.3', '01.2.3', '1.02.3', '1.2.03', '1.2', '1.2.3-..'])('rejects unsafe/non-semver version %s', async version => {
    const process = Bun.spawn([installer, '/bin/ls', version, 'a'.repeat(64)], { stdout: 'pipe', stderr: 'pipe' })
    expect(await process.exited).toBe(2); expect(await new Response(process.stderr).text()).toContain('strict semver')
  })
  test('systemd unit keeps loopback service under a dedicated hardened identity', async () => {
    const unit = await Bun.file(resolve(import.meta.dir, '../packaging/hapi-mobile-relay.service')).text()
    expect(unit).toContain('User=hapi-mobile-relay'); expect(unit).toContain('HAPI_MOBILE_RELAY_HOST=127.0.0.1')
    expect(unit).toContain('ProtectSystem=strict'); expect(unit).toContain('ReadWritePaths=/var/lib/hapi-mobile-relay')
  })
})
