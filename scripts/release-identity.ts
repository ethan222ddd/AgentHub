import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
// External native resources are part of the tested release, not just app.asar.
export async function guardIdentity(executable?: string) {
  const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
  const path = resolve(
    executable ||
      process.env.AGENTHUB_PACKAGED_EXE ||
      `release/${version}/win-unpacked/AgentHub.exe`,
    '..',
    'resources/native/agenthub-process-guard.exe',
  )
  return {
    processGuardSha256: createHash('sha256')
      .update(await readFile(path))
      .digest('hex'),
  }
}
