import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { findRuntime } from '../src/main/agents/process'
const selected = await findRuntime('codex')
const shim = join(process.env.APPDATA || '', 'npm', 'codex.cmd')
let shimResult: object
try {
  shimResult = await new Promise((resolve) => {
    const child = spawn(shim, ['--version'], { shell: false, windowsHide: true, stdio: 'ignore' })
    child.on('error', (error: NodeJS.ErrnoException) =>
      resolve({ event: 'spawn.error', code: error.code }),
    )
    child.on('close', (code, signal) => resolve({ event: 'process.close', code, signal }))
  })
} catch (error) {
  shimResult = { event: 'spawn.throw', code: (error as NodeJS.ErrnoException).code }
}
const result = { selectedRuntime: selected, npmShim: shim, directSpawnWithoutShell: shimResult }
mkdirSync(resolve('.local/codex-debug'), { recursive: true })
writeFileSync(resolve('.local/codex-debug/baseline-launch.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
