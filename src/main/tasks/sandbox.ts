import { JsonProcess, findRuntime } from '../agents/process'
import { version } from '../../../package.json'
export async function testSandbox(
  cwd: string,
  factory?: (cwd: string) => JsonProcess,
): Promise<JsonProcess> {
  const executable = factory ? undefined : await findRuntime('codex')
  if (!factory && !executable)
    throw new Error(
      'Automatic executable tests require an installed official Codex command sandbox. Use explicit approved test controls if unavailable; no unsandboxed fallback was run.',
    )
  return factory
    ? factory(cwd)
    : new JsonProcess(executable!, ['app-server'], cwd, undefined, {
        stage: 'automatic-test-sandbox',
      })
}
export async function initializeSandbox(proc: JsonProcess, fixture = false) {
  await proc.request('initialize', {
    clientInfo: { name: 'agenthub', title: 'AgentHub', version },
    capabilities: { experimentalApi: true },
  })
  proc.send({ method: 'initialized', params: {} })
  if (process.platform === 'win32' && !fixture) {
    const ready = await proc.request<{ status: string }>('windowsSandbox/readiness', undefined)
    if (ready.status !== 'ready')
      throw new Error(
        'Official Windows command sandbox is not ready. Complete official Codex sandbox setup or run explicitly approved tests; no unsafe fallback was used.',
      )
  }
}
