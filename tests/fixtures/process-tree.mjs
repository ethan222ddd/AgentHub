// Generated lifecycle fixtures only. Never used as an Agent runtime.
import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { setInterval, setTimeout } from 'node:timers'
const [mode, marker] = process.argv.slice(2)
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n')
setTimeout(() => process.exit(0), 15000)
if (mode === 'echo') {
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (text) => {
    input += text
  })
  process.stdin.on('end', () => {
    send({ args: process.argv.slice(3), input })
    process.exit(0)
  })
} else if (mode === 'leaf' || mode === 'outsider') {
  send({ role: mode, pid: process.pid })
  appendFileSync(marker, 'ready\n')
  setInterval(() => appendFileSync(marker, 'tick\n'), 20)
} else {
  send({ role: 'root', pid: process.pid })
  const leaf = spawn(process.execPath, [fileURLToPath(import.meta.url), 'leaf', marker], {
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  leaf.stdout.pipe(process.stdout)
  leaf.stderr.pipe(process.stderr)
  if (mode === 'root-exit') leaf.stdout.once('data', () => setTimeout(() => process.exit(0), 30))
}
