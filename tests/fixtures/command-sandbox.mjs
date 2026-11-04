// Protocol fixture ONLY. Executes generated CI commands; does NOT emulate OS isolation.
// Real Windows sandbox enforcement is verified separately with the official App Server.
import { createInterface } from 'node:readline'
import { spawn, execFile } from 'node:child_process'
import { resolve } from 'node:path'
import process from 'node:process'
const children = new Map()
const send = (id, result) => process.stdout.write(JSON.stringify({ id, result }) + '\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line)
  if (m.method === 'initialize') return send(m.id, {})
  if (m.method === 'initialized') return
  if (m.method === 'command/exec/terminate') {
    const child = children.get(m.params.processId)
    if (child && process.platform === 'win32')
      execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], () => send(m.id, {}))
    else {
      child?.kill()
      send(m.id, {})
    }
    return
  }
  if (m.method !== 'command/exec') return
  if (
    resolve(m.params.cwd) !== resolve(process.cwd()) ||
    resolve(m.params.command[0]).toLowerCase() !== resolve(process.execPath).toLowerCase() ||
    m.params.sandboxPolicy.type !== 'workspaceWrite'
  )
    process.exit(9)
  const env = { ...process.env, ...m.params.env }
  for (const key of Object.keys(env)) if (env[key] === null) delete env[key]
  const child = spawn(m.params.command[0], m.params.command.slice(1), {
    cwd: m.params.cwd,
    env,
    shell: false,
    windowsHide: true,
    stdio: 'pipe',
  })
  children.set(m.params.processId, child)
  let stdout = '',
    stderr = ''
  child.stdout.on('data', (data) => {
    stdout = (stdout + data).slice(-100000)
  })
  child.stderr.on('data', (data) => {
    stderr = (stderr + data).slice(-100000)
  })
  child.on('error', () => {})
  child.once('close', (code) => {
    children.delete(m.params.processId)
    send(m.id, { exitCode: code ?? 1, stdout, stderr })
  })
})
