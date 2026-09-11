import { describe, expect, test } from 'bun:test'
import { notificationContent, NTFY_MESSAGE_MAX_BYTES, NTFY_TITLE_MAX_BYTES, truncateUtf8 } from '../src/notification-content'
import { config, event } from './helpers'

describe('notification content boundary', () => {
  test('fixed mode ignores event-controlled title and body', () => {
    expect(notificationContent(config(), event({ title: 'SECRET title', body: 'SECRET body' }))).toEqual({ title: 'HAPI 任务已完成', message: '请打开 HAPI 查看结果' })
  })

  test('eventPreview uses only sanitized title and body', () => {
    const result = notificationContent(config({ contentMode: 'eventPreview' }), event({ title: '  A\r\nB\u0000\u0085C  ', body: ' one\r\ntwo\rthree\u0000\u009f ' }))
    expect(result.title).toContain('A'); expect(result.title).toContain('C')
    expect(result.title).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/)
    expect(result.message).toBe('one\ntwo\nthree')
  })

  test('replaces isolated surrogates and preserves complete emoji', () => {
    const result = notificationContent(config({ contentMode: 'eventPreview' }), event({ title: `left\ud800right\udc00`, body: `ok😀end` }))
    expect(result.title).toBe('left�right�'); expect(result.message).toBe('ok😀end')
    expect(truncateUtf8('ab😀c', 5)).toBe('ab')
    expect(truncateUtf8('ab😀c', 6)).toBe('ab😀')
  })

  test('caps UTF-8 bytes without cutting a code point', () => {
    const result = notificationContent(config({ contentMode: 'eventPreview' }), event({ title: '界'.repeat(1000), body: '😀'.repeat(5000) }))
    expect(new TextEncoder().encode(result.title).byteLength).toBeLessThanOrEqual(NTFY_TITLE_MAX_BYTES)
    expect(new TextEncoder().encode(result.message).byteLength).toBeLessThanOrEqual(NTFY_MESSAGE_MAX_BYTES)
    expect(result.title.endsWith('界')).toBeTrue(); expect(result.message.endsWith('😀')).toBeTrue()
  })

  test('falls back field-by-field when sanitized preview is empty', () => {
    expect(notificationContent(config({ contentMode: 'eventPreview' }), event({ title: '\u0000\u0001', body: '\u007f\u009f' }))).toEqual({ title: 'HAPI 任务已完成', message: '请打开 HAPI 查看结果' })
  })
})
