import { lstat, readFile } from 'node:fs/promises'
import { compareSnapshotFiles, type ContinuityEvidence } from './phase-b-compare'
import { readContinuityEvidence } from './source-continuity'

// Offline snapshots only. Errors are deliberately fixed codes; never print paths or raw exceptions.
const fail = (reason: string) => { process.stdout.write(`${JSON.stringify({ version: 1, verdict: 'INDETERMINATE', reason })}\n`); process.exitCode = 2 }
try {
  const args = process.argv.slice(2)
  if (args.length !== 7) throw new Error('arguments')
  const [sidecar, hub, keyPath, continuityPath, fromRaw, throughRaw, toleranceRaw] = args
  const from = Number(fromRaw), through = Number(throughRaw), toleranceMs = Number(toleranceRaw)
  if (toleranceMs !== 5_000) throw new Error('tolerance')
  for (const path of [sidecar, hub, keyPath, continuityPath]) {
    if (!path?.startsWith('/')) throw new Error('path')
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 ||
      (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw new Error('file')
  }
  const key = await readFile(keyPath!), continuity = readContinuityEvidence(continuityPath!, from, through) ?? { sourceState: 'unverified', gapCount: -1, observedFrom: 0, observedThrough: 0 } satisfies ContinuityEvidence
  const result = compareSnapshotFiles(sidecar!, hub!, { from, through, toleranceMs, key, continuity })
  key.fill(0)
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (result.verdict !== 'PASS') process.exitCode = 2
} catch { fail('invalid_inputs') }
