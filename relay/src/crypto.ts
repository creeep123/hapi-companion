import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const randomSecret = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const secretHash = (value: string) => createHash('sha256').update(value).digest('hex')
export function secretMatches(value: string, expected?: string): boolean {
  if (!expected) return false
  const a = Buffer.from(secretHash(value), 'hex'); const b = Buffer.from(expected, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}
