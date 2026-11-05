import { guardIdentity } from './release-identity'
// Actual portable launcher, default beside-executable data location, no profile override.
import { chromium, expect } from '@playwright/test'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { killTree, spawnOwned } from '../src/main/agents/process'
import { cleanupTestDirectories, directory as fixtureDirectory } from '../tests/helpers'
import type { Snapshot } from '../src/shared/types'
const { version } = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
const base = resolve('.local/portable-acceptance')
await mkdir(base, { recursive: true })
const directory = await mkdtemp(join(base, 'portable-'))
const executablePath = join(directory, `AgentHub-${version}-portable.exe`)
await copyFile(resolve(`release/${version}/AgentHub-${version}-portable.exe`), executablePath)
const env = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
)
delete env.ELECTRON_RUN_AS_NODE
delete env.AGENTHUB_DATA_DIR
delete env.PORTABLE_EXECUTABLE_DIR
async function freePort() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No local port')
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  return address.port
}
// NSIS does not forward the stdout expected by electron.launch; connect to our child directly.
async function launch() {
  const port = await freePort(),
    remote = await freePort()
  const child = spawnOwned(
    executablePath,
    [`--inspect=127.0.0.1:${port}`, `--remote-debugging-port=${remote}`],
    {
      env,
      windowsHide: true,
    },
  )
  child.stdin.end()
  child.stdout.resume()
  child.stderr.resume()
  let launchError: Error | undefined
  child.on('error', (error) => {
    launchError = error
  })
  const exited = new Promise<void>((resolve) => child.once('close', () => resolve()))
  let inspector: WebSocket | undefined
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined
  try {
    let endpoint = ''
    await expect
      .poll(
        async () => {
          if (launchError) throw launchError
          try {
            const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as {
              webSocketDebuggerUrl: string
            }[]
            endpoint = targets[0]?.webSocketDebuggerUrl || ''
          } catch {
            /* wait for extraction */
          }
          return !!endpoint
        },
        { timeout: 90000, intervals: [500] },
      )
      .toBe(true)
    inspector = new WebSocket(endpoint)
    const ws = inspector
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true })
      ws.addEventListener('error', () => reject(new Error('Inspector connection failed')), {
        once: true,
      })
    })
    let sequence = 0
    const pending = new Map<
      number,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >()
    ws.addEventListener('message', (event) => {
      const reply = JSON.parse(String(event.data)) as {
        id?: number
        error?: unknown
        result?: { exceptionDetails?: unknown; result?: { value?: unknown } }
      }
      const entry = reply.id ? pending.get(reply.id) : undefined
      if (!entry) return
      pending.delete(reply.id!)
      if (reply.error || reply.result?.exceptionDetails)
        entry.reject(new Error(JSON.stringify(reply.error || reply.result?.exceptionDetails)))
      else entry.resolve(reply.result?.result?.value)
    })
    ws.addEventListener('close', () => {
      for (const entry of pending.values()) entry.reject(new Error('Inspector closed'))
      pending.clear()
    })
    const evaluate = <R, A>(fn: (electron: typeof import('electron'), arg: A) => R, arg?: A) =>
      new Promise<Awaited<R>>((resolve, reject) => {
        const id = ++sequence
        pending.set(id, { resolve: (value) => resolve(value as Awaited<R>), reject })
        ws.send(
          JSON.stringify({
            id,
            method: 'Runtime.evaluate',
            params: {
              expression: `(async()=>{const {createRequire}=process.getBuiltinModule('module');const e=createRequire(process.cwd()+'/agenthub-portable-test.cjs')('electron');return await (${fn.toString()})(e,${JSON.stringify(arg)})})()`,
              awaitPromise: true,
              returnByValue: true,
            },
          }),
        )
      })
    // Main Inspector starts before Chromium is ready to accept CDP connections.
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(`http://127.0.0.1:${remote}/json/version`)).ok
          } catch {
            return false
          }
        },
        { timeout: 30000, intervals: [300] },
      )
      .toBe(true)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${remote}`)
    const context = browser.contexts()[0]
    // Job ownership setup can finish after Chromium exposes CDP, before the
    // first BrowserWindow exists. Wait for that real page rather than assuming it.
    const page = context.pages()[0] || (await context.waitForEvent('page', { timeout: 30000 }))
    await page.waitForLoadState('domcontentloaded')
    let closed = false
    return {
      evaluate,
      firstWindow: async () => page,
      close: async () => {
        if (closed) return
        closed = true
        await page.close().catch(() => {})
        ws.close()
        await browser!.close().catch(() => {})
        await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 15000))])
        if (child.exitCode === null) await killTree(child)
        await exited
      },
    }
  } catch (error) {
    inspector?.close()
    await browser?.close().catch(() => {})
    await killTree(child)
    await exited
    throw error
  }
}
let app = await launch()
const report: Record<string, unknown> = { version, passed: false, directory }
try {
  let page = await app.firstWindow()
  const runtime = await app.evaluate(async ({ app }) => {
    const { readFile } = process.getBuiltinModule('fs/promises')
    const { join } = process.getBuiltinModule('path')
    const resources = process.resourcesPath
    const guide = await readFile(join(resources, 'docs', 'USER_GUIDE.html'), 'utf8')
    return {
      version: app.getVersion(),
      packaged: app.isPackaged,
      data: app.getPath('userData'),
      guidePresent: guide.includes('AgentHub') && guide.includes(app.getVersion()),
      resources,
    }
  })
  expect(runtime.version).toBe(version)
  expect(runtime.packaged).toBe(true)
  expect(runtime.data.toLowerCase()).toBe(join(directory, 'AgentHubData').toLowerCase())
  expect(runtime.guidePresent).toBe(true)
  const expectedAsar = createHash('sha256')
    .update(await readFile(resolve(`release/${version}/win-unpacked/resources/app.asar`)))
    .digest('hex')
  // Read raw ASAR through host Node, not Electron's virtual ASAR filesystem.
  const actualAsar = createHash('sha256')
    .update(await readFile(join(runtime.resources, 'app.asar')))
    .digest('hex')
  expect(actualAsar).toBe(expectedAsar)
  expect(
    await page.evaluate(() => typeof (window as unknown as { require: unknown }).require),
  ).toBe('undefined')
  expect(await page.evaluate(() => typeof window.agenthub?.invoke)).toBe('function')
  expect(
    await page.evaluate(async () => {
      try {
        await window.agenthub.invoke({ op: 'shell', command: 'whoami' })
        return false
      } catch {
        return true
      }
    }),
  ).toBe(true)
  // The selected folder must sit outside AgentHub's own Git repository, or automatic setup
  // correctly refuses to initialise a nested repository and reports attention.
  const project = await fixtureDirectory('portable-project-')
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, project)
  await page.getByRole('button', { name: '選擇專案資料夾' }).click()
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.agenthub.invoke<Snapshot>({ op: 'snapshot' })))
          .projects[0]?.setup?.state,
    )
    .toBe('ready')
  await page.locator('.mention-container > button').click()
  await page.getByRole('button', { name: '僅儲存筆記' }).click()
  const note = 'PORTABLE_RESTART_' + randomUUID()
  await page.getByRole('textbox', { name: 'Message' }).fill(note)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByTestId('message')).toContainText(note)
  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await expect(page.getByTestId('message')).toContainText(note)
  await page.screenshot({ path: join(base, 'portable-restart.png') })
  Object.assign(report, {
    passed: true,
    packaged: true,
    ...(await guardIdentity(join(runtime.resources, '..', 'AgentHub.exe'))),
    appAsarSha256: actualAsar,
    besideExecutableData: true,
    historyRestored: true,
    guidePresent: true,
    securePreload: true,
    launcherSha256: createHash('sha256')
      .update(await readFile(executablePath))
      .digest('hex'),
  })
  console.log(
    'PASS: actual portable launcher, beside-executable data, secure IPC, bundled guide and restart history.',
  )
} catch (error) {
  report.error = String(error)
  throw error
} finally {
  await app.close()
  await writeFile(join(base, 'report.json'), JSON.stringify(report, null, 2))
  await cleanupTestDirectories()
}
