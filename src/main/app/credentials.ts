import { safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
export class Credentials {
  private file: string
  constructor(directory: string) {
    this.file = join(directory, 'claude-key.dpapi')
  }
  get(): string | undefined {
    if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
    if (!existsSync(this.file) || !safeStorage.isEncryptionAvailable()) return undefined
    try {
      return safeStorage.decryptString(readFileSync(this.file))
    } catch {
      return undefined
    }
  }
  save(value: string): void {
    if (!value) {
      if (existsSync(this.file)) unlinkSync(this.file)
      return
    }
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('Operating system credential encryption unavailable. Key was not saved.')
    writeFileSync(this.file, safeStorage.encryptString(value), { mode: 0o600 })
  }
}
