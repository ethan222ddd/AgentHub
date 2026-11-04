import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
if (process.platform === 'win32') {
  const source = resolve('src/native/process-guard.cs'),
    directory = resolve('.native')
  const binary = join(directory, 'agenthub-process-guard.exe'),
    stamp = join(directory, 'guard-source.sha256')
  const hash = createHash('sha256')
    .update(await readFile(source))
    .digest('hex')
  await mkdir(directory, { recursive: true })
  if (!existsSync(binary) || !existsSync(stamp) || (await readFile(stamp, 'utf8')) !== hash) {
    const compiler = join(
      process.env.WINDIR || 'C:\\Windows',
      'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
    )
    if (!existsSync(compiler))
      throw new Error(
        'Windows .NET Framework compiler unavailable; cannot build required process ownership guard.',
      )
    execFileSync(
      compiler,
      [
        '/nologo',
        '/target:exe',
        '/platform:x64',
        '/optimize+',
        '/reference:System.Web.Extensions.dll',
        `/out:${binary}`,
        source,
      ],
      { windowsHide: true, stdio: 'inherit' },
    )
    await writeFile(stamp, hash)
  }
  console.log('Windows process ownership guard ready')
}
