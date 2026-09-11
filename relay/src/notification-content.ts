import type { CompanionEvent, RelayConfig } from './types'

export const NTFY_TITLE_MAX_BYTES = 256
export const NTFY_MESSAGE_MAX_BYTES = 4096

const fixedContent = (event: CompanionEvent) => event.kind === 'permission-request'
  ? { title: 'HAPI 需要你处理', message: '请打开 HAPI 处理请求' }
  : { title: 'HAPI 任务已完成', message: '请打开 HAPI 查看结果' }

function normalizeUnicode(value: string, multiline: boolean): string {
  const normalizedNewlines = multiline ? value.replace(/\r\n?/g, '\n') : value
  let result = ''
  for (let index = 0; index < normalizedNewlines.length; index++) {
    const unit = normalizedNewlines.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = normalizedNewlines.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) { result += normalizedNewlines[index] + normalizedNewlines[++index]; continue }
      result += '\ufffd'; continue
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) { result += '\ufffd'; continue }
    const control = unit <= 0x1f || (unit >= 0x7f && unit <= 0x9f)
    if (!control) result += normalizedNewlines[index]
    else if (multiline && unit === 0x0a) result += '\n'
    else result += ' '
  }
  return result.trim()
}

export function truncateUtf8(value: string, maxBytes: number): string {
  if (new TextEncoder().encode(value).byteLength <= maxBytes) return value
  let result = '', used = 0
  for (const scalar of value) {
    const size = new TextEncoder().encode(scalar).byteLength
    if (used + size > maxBytes) break
    result += scalar; used += size
  }
  return result
}

export function notificationContent(config: RelayConfig, event: CompanionEvent): { title: string; message: string } {
  const fixed = fixedContent(event)
  if (config.contentMode !== 'eventPreview') return fixed
  const title = truncateUtf8(normalizeUnicode(event.title, false), NTFY_TITLE_MAX_BYTES)
  const message = truncateUtf8(normalizeUnicode(event.body, true), NTFY_MESSAGE_MAX_BYTES)
  return { title: title || fixed.title, message: message || fixed.message }
}
