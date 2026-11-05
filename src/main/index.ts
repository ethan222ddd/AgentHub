import { app, BrowserWindow, ipcMain, Menu, session, dialog } from 'electron'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Store } from './database/store'
import { CodexAdapter } from './agents/codex'
import { ClaudeAdapter } from './agents/claude'
import { AntigravityAdapter } from './agents/antigravity'
import type { AgentAdapter } from './agents/adapter'
import { Orchestrator } from './orchestrator/orchestrator'
import { WorkspaceManager } from './git/workspaces'
import { Credentials } from './app/credentials'
import { makeHandler } from './ipc/handlers'
import { redact } from './permissions/paths'
import { TestRunner } from './tasks/tests'
import { AutomaticProjects } from './git/automatic'
import { mkdirSync } from 'node:fs'
import { configureDiagnostics, trace, traceError } from './app/diagnostics'
import { runtimeEnv } from './agents/process'
import { processSupervisor, startApplicationOwnership } from './agents/process-owner'
import { applyPendingRestore } from './database/backup'
import { DesktopNotifications } from './app/notifications'
import { WindowsNotificationSink } from './app/notifications-native'
import { WorkflowService } from './workflows/service'
import { OverlapMonitor } from './git/overlaps'
import type { AppEvent, Conversation, Task } from '../shared/types'
const dataDirectory =
  app.commandLine.getSwitchValue('user-data-dir') ||
  (!app.isPackaged ? process.env.AGENTHUB_DATA_DIR : undefined) ||
  (app.isPackaged && process.env.PORTABLE_EXECUTABLE_DIR
    ? join(process.env.PORTABLE_EXECUTABLE_DIR, 'AgentHubData')
    : undefined)
if (dataDirectory) {
  mkdirSync(resolve(dataDirectory), { recursive: true })
  app.setPath('userData', resolve(dataDirectory))
}
app.setName('AgentHub')
if (process.platform === 'win32') app.setAppUserModelId('org.agenthub.desktop')
let win: BrowserWindow | undefined
let store: Store
let orchestrator: Orchestrator
let tests: TestRunner
let workflows: WorkflowService | undefined
let quitting = false
let notifications: DesktopNotifications | undefined
let overlaps: OverlapMonitor | undefined
let closeServices = async () => {}
const single = app.requestSingleInstanceLock()
if (!single) app.quit()
else {
  app.on('second-instance', () => {
    win?.restore()
    win?.focus()
  })
  void app
    .whenReady()
    .then(async () => {
      await startApplicationOwnership()
      Menu.setApplicationMenu(null)
      const directory = app.getPath('userData')
      await applyPendingRestore(directory)
      configureDiagnostics(join(directory, 'logs', 'diagnostics.jsonl'))
      trace('app.ownership.ready', {
        pid: processSupervisor.inspect().appGuardPid,
        stage: 'windows-app-job',
      })
      trace('app.started', {
        pid: process.pid,
        packaged: app.isPackaged,
        version: app.getVersion(),
        cwd: process.cwd(),
        pathEntries: (process.env.Path || process.env.PATH || '').split(';'),
        environmentKeys: Object.keys(runtimeEnv()),
      })
      store = new Store(join(directory, 'agenthub.sqlite'))
      store.recover()
      const credentials = new Credentials(directory)
      const adapters = new Map<string, AgentAdapter>([
        ['codex', new CodexAdapter()],
        ['claude', new ClaudeAdapter(() => credentials.get())],
        ['antigravity', new AntigravityAdapter()],
      ])
      orchestrator = new Orchestrator(store, adapters, (event) => {
        notifications?.accept(event)
        if (event.type === 'changed') overlaps?.observe()
        if (win && !win.isDestroyed()) win.webContents.send('agenthub:event', event)
      })
      const manager = new WorkspaceManager(store, join(directory, 'workspaces'))
      orchestrator.setWorkspaceManager(manager)
      tests = new TestRunner(store, () => orchestrator.changed())
      orchestrator.automatic = new AutomaticProjects(store, manager, tests, () =>
        orchestrator.changed(),
      )
      workflows = new WorkflowService(store, orchestrator)
      overlaps = new OverlapMonitor(store, () => orchestrator.changed())
      overlaps.start()
      overlaps.observe()
      for (const project of store.snapshot().projects) {
        if (project.autoManaged === undefined)
          store.put('projects', { ...project, autoManaged: true })
      }
      const rendererUrl =
        process.env.ELECTRON_RENDERER_URL && !app.isPackaged
          ? process.env.ELECTRON_RENDERER_URL
          : pathToFileURL(join(import.meta.dirname, '../renderer/index.html')).href
      const allowed = new URL(rendererUrl)
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      )
      session.defaultSession.setPermissionCheckHandler(() => false)
      win = new BrowserWindow({
        width: 1320,
        height: 860,
        minWidth: 760,
        minHeight: 560,
        backgroundColor: '#111212',
        title: 'AgentHub',
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
          preload: join(import.meta.dirname, '../preload/index.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
        },
      })
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      win.webContents.on('will-navigate', (event, url) => {
        if (url !== rendererUrl) event.preventDefault()
      })
      win.webContents.on('will-attach-webview', (event) => event.preventDefault())
      let coldActivation: string | undefined
      const publish = (event: AppEvent) => {
        if (win && !win.isDestroyed()) win.webContents.send('agenthub:event', event)
      }
      const sink = new WindowsNotificationSink(
        () => win,
        publish,
        (id) => {
          if (notifications) notifications.activate(id)
          else coldActivation = id
        },
      )
      notifications = new DesktopNotifications(
        () => ({
          settings: store.settings(),
          tasks: store.list<Task>('tasks'),
          conversations: store.list<Conversation>('conversations'),
        }),
        sink,
      )
      if (coldActivation) notifications.activate(coldActivation)
      win.webContents.on('did-start-loading', () => notifications?.rendererLoading())
      const handler = makeHandler(
        store,
        orchestrator,
        manager,
        credentials,
        tests,
        () => win!,
        notifications,
        workflows,
        overlaps,
      )
      closeServices = handler.dispose
      ipcMain.handle('agenthub:invoke', async (event, raw: unknown) => {
        const frame = event.senderFrame
        if (event.sender !== win?.webContents || !frame || frame !== event.sender.mainFrame)
          throw new Error('Untrusted IPC sender')
        const origin = new URL(frame.url)
        if (
          allowed.protocol === 'file:'
            ? origin.href !== allowed.href
            : origin.origin !== allowed.origin
        )
          throw new Error('Untrusted IPC origin')
        try {
          const operation = (raw as { op?: unknown })?.op
          trace('ipc.request', {
            method:
              typeof operation === 'string' && /^[a-z.]+$/.test(operation) ? operation : 'invalid',
            stage: 'renderer-preload-main',
          })
          return { ok: true, value: await handler(raw) }
        } catch (error) {
          trace('ipc.failed', traceError(error))
          return {
            ok: false,
            error: redact(error instanceof Error ? error.message : String(error)),
          }
        }
      })
      win.once('ready-to-show', () => {
        if (!quitting) {
          win?.show()
          notifications?.refreshBadge()
        }
      })
      win.webContents.on('render-process-gone', (_event, details) => {
        if (quitting) return
        trace('renderer.exited', { reason: details.reason, code: details.exitCode })
        // Close through the same ownership gate. Restart restores interrupted work without replay.
        app.quit()
      })
      await win.loadURL(rendererUrl)
    })
    .catch((error) => {
      // Closing during loadURL aborts navigation. It is expected shutdown,
      // not a startup failure requiring a blocking native error dialog.
      if (quitting) {
        trace('app.startup.cancelled', { reason: 'shutdown' })
        return
      }
      console.error(redact(String(error)))
      dialog.showErrorBox(
        'AgentHub 啟動失敗 / Startup failed',
        redact(String(error)) +
          '\n\n資料已保留。請檢查資料夾權限或使用相容版本還原 SQLite 備份。Data is preserved; check folder permissions or restore a compatible SQLite backup.',
      )
      app.quit()
    })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', (event) => {
    if (quitting || !orchestrator) return
    event.preventDefault()
    quitting = true
    notifications?.dispose()
    overlaps?.dispose()
    processSupervisor.stopAccepting()
    const drain = async (stage: string, work: Promise<unknown>) => {
      trace('app.shutdown.stage', { stage, status: 'started' })
      try {
        await work
        trace('app.shutdown.stage', { stage, status: 'completed' })
      } catch (error) {
        trace('app.shutdown.stage', { stage, status: 'failed', ...traceError(error) })
        throw error
      }
    }
    void Promise.allSettled([
      drain('ipc-services', closeServices()),
      drain('orchestrator', orchestrator.dispose()),
      drain('workflows', workflows?.dispose() || Promise.resolve()),
      drain('test-runner', tests.dispose()),
      drain('owned-processes', processSupervisor.shutdown()),
    ]).then(() => {
      try {
        store?.close()
        trace('app.shutdown.database', { status: 'closed' })
      } catch (error) {
        trace('app.shutdown.database', { status: 'failed', ...traceError(error) })
      } finally {
        // Electron can leave an initial, not-yet-shown window open when quit
        // races loadURL/ready-to-show. Work has drained; close it synchronously.
        if (win && !win.isDestroyed()) win.destroy()
        app.quit()
      }
    })
  })
}
