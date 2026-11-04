// Deliberately launched outside the supervisor: the test kills THIS parent only.
import process from 'node:process'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { setInterval } from 'node:timers'
import {
  spawnOwned,
  startApplicationOwnership,
  processSupervisor,
} from '../../src/main/agents/process-owner.ts'
const [mode, marker] = process.argv.slice(2)
if (mode === 'app') await startApplicationOwnership()
const args = [resolve('tests/fixtures/process-tree.mjs'), 'tree', marker]
const child =
  mode === 'app'
    ? spawn(process.execPath, args, { windowsHide: true, stdio: 'pipe' })
    : spawnOwned(process.execPath, args)
child.stdout.pipe(process.stdout)
child.stderr.pipe(process.stderr)
process.stdout.write(
  JSON.stringify({
    role: 'host',
    pid: process.pid,
    child: child.pid,
    appGuard: processSupervisor.inspect().appGuardPid,
  }) + '\n',
)
setInterval(() => {}, 1000)
