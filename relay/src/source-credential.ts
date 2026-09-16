import { isAbsolute, join } from 'node:path'
import { lstat, readFile } from 'node:fs/promises'

type Metadata = { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean; mode: number; uid: number; gid: number }

export function explicitCredentialMetadataSafe(file: Metadata, currentUid: number): boolean {
  return file.isFile() && !file.isSymbolicLink() && file.uid === currentUid && (file.mode & 0o077) === 0
}

export function systemdCredentialMetadataSafe(directory: Metadata, file: Metadata): boolean {
  const privateDirectory = directory.isDirectory() && !directory.isSymbolicLink() && directory.uid === 0 && directory.gid === 0 && (directory.mode & 0o027) === 0
  const readOnlyCredential = file.isFile() && !file.isSymbolicLink() && file.uid === 0 && file.gid === 0 && (file.mode & 0o027) === 0 && (file.mode & 0o700) === 0o400
  return privateDirectory && readOnlyCredential
}

export async function readSourceToken(environment: NodeJS.ProcessEnv = process.env): Promise<string> {
  const explicitPath = environment.HAPI_SIDECAR_ACCESS_TOKEN_FILE
  const credentialsDirectory = environment.CREDENTIALS_DIRECTORY
  let path: string
  if (explicitPath) {
    if (!isAbsolute(explicitPath)) throw new Error('source_credential_path')
    path = explicitPath
    const file = await lstat(path)
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : file.uid
    if (!explicitCredentialMetadataSafe(file, currentUid)) throw new Error('source_credential_permissions')
  } else {
    if (!credentialsDirectory || !isAbsolute(credentialsDirectory)) throw new Error('HAPI_SIDECAR_ACCESS_TOKEN_FILE_required')
    path = join(credentialsDirectory, 'hapi-access-token')
    const [directory, file] = await Promise.all([lstat(credentialsDirectory), lstat(path)])
    if (!systemdCredentialMetadataSafe(directory, file)) throw new Error('source_credential_permissions')
  }
  const token = (await readFile(path, 'utf8')).trim()
  if (token.length < 16 || token.length > 4096 || /[\r\n]/.test(token)) throw new Error('source_credential_invalid')
  return token
}
