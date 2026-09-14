import { describe, expect, test } from 'bun:test'
import fixtures from '../../contracts/reminder-policy-fixtures.json'
import { clickUrl, evaluate } from '../src/policy'
import { config, event, policy } from './helpers'

describe('policy parity fixtures', () => {
  for (const item of fixtures.cases) test(item.name, () => {
    const c = config({ policy: policy(item.policy as any) })
    expect(evaluate(event(item.event as any), c, item.now)).toBe(item.decision as 'sound' | 'quiet' | 'suppress')
  })
  test('constructs exact encoded same-origin URL', () => expect(clickUrl(config(), 'a/b ?'),).toBe('https://hapi.example/sessions/a%2Fb%20%3F'))
  test('rejects non-HTTPS origin and control session id', () => {
    expect(() => clickUrl(config({ hapiOrigin: 'http://hapi.example' }), 'x')).toThrow()
    expect(() => clickUrl(config(), 'x\n')).toThrow()
  })
})
