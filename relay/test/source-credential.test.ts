import { describe, expect, test } from 'bun:test'
import { explicitCredentialMetadataSafe, systemdCredentialMetadataSafe } from '../src/source-credential'

const metadata = (kind: 'file' | 'directory', mode: number, uid: number, gid: number, symlink = false) => ({
  mode, uid, gid,
  isFile: () => kind === 'file',
  isDirectory: () => kind === 'directory',
  isSymbolicLink: () => symlink
})

describe('source credential permissions', () => {
  test('accepts the observed private systemd credential mount', () => {
    expect(systemdCredentialMetadataSafe(metadata('directory', 0o40550, 0, 0), metadata('file', 0o100440, 0, 0))).toBeTrue()
  })

  test('rejects a systemd credential outside the root-owned read-only mount model', () => {
    const directory = metadata('directory', 0o40550, 0, 0)
    expect(systemdCredentialMetadataSafe(metadata('directory', 0o40750, 1, 1), metadata('file', 0o100440, 0, 0))).toBeFalse()
    expect(systemdCredentialMetadataSafe(directory, metadata('file', 0o100460, 0, 0))).toBeFalse()
    expect(systemdCredentialMetadataSafe(directory, metadata('file', 0o100444, 0, 0))).toBeFalse()
    expect(systemdCredentialMetadataSafe(directory, metadata('file', 0o100440, 1, 1))).toBeFalse()
    expect(systemdCredentialMetadataSafe(directory, metadata('file', 0o100440, 0, 0, true))).toBeFalse()
  })

  test('keeps explicit files private and owned by the service uid', () => {
    expect(explicitCredentialMetadataSafe(metadata('file', 0o100600, 501, 20), 501)).toBeTrue()
    expect(explicitCredentialMetadataSafe(metadata('file', 0o100600, 0, 0), 501)).toBeFalse()
    expect(explicitCredentialMetadataSafe(metadata('file', 0o100640, 501, 20), 501)).toBeFalse()
  })
})
