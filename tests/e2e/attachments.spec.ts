import { test, expect, _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, writeFile, unlink, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
test('real Electron imports immutable images, previews, exports and restores after restart', async () => {
  const base = resolve('.local/e2e-images')
  await mkdir(base, { recursive: true })
  const profile = await mkdtemp(join(base, 'profile-'))
  const project = await mkdtemp(join(base, 'project-'))
  const path = join(project, 'visual.png')
  const env = Object.fromEntries(
    Object.entries(process.env).filter((v): v is [string, string] => typeof v[1] === 'string'),
  )
  delete env.ELECTRON_RUN_AS_NODE
  env.AGENTHUB_DATA_DIR = profile
  const launch = () =>
    electron.launch(
      process.env.AGENTHUB_IMAGES_E2E_PACKAGED_EXE
        ? {
            executablePath: resolve(process.env.AGENTHUB_IMAGES_E2E_PACKAGED_EXE),
            args: [`--user-data-dir=${profile}`],
            env,
          }
        : { args: ['.'], env },
    )
  let app = await launch()
  let page = await app.firstWindow()
  try {
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, project)
    await page.getByRole('button', { name: '選擇專案資料夾' }).click()
    const data = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 300
      canvas.height = 160
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#147bea'
      ctx.fillRect(0, 0, 300, 160)
      ctx.fillStyle = 'white'
      ctx.font = 'bold 40px sans-serif'
      ctx.fillText('IMAGE TEST', 25, 95)
      return canvas.toDataURL('image/png').split(',')[1]
    })
    await writeFile(path, Buffer.from(data, 'base64'))
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, path)
    await page.getByTitle('附加專案檔案').click()
    await expect(page.locator('.attachments img')).toBeVisible()
    await unlink(path)
    await page.locator('.mention-container > button').click()
    await page.getByRole('button', { name: '僅儲存筆記' }).click()
    await page.getByRole('textbox', { name: 'Message' }).fill('Persist actual image bytes')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(page.locator('.message-attachments img')).toBeVisible()
    await page.locator('.message-attachments button').click()
    await expect(
      page.getByRole('dialog', { name: 'Image attachment' }).locator('img'),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Close / 關閉', exact: true }).click()
    const exportPath = join(profile, 'conversation.json')
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, exportPath)
    await page.evaluate(async () => {
      const state = await window.agenthub.invoke<{ conversations: { id: string }[] }>({
        op: 'snapshot',
      })
      await window.agenthub.invoke({
        op: 'export',
        conversationId: state.conversations[0].id,
        format: 'json',
      })
    })
    const exported = JSON.parse(await readFile(exportPath, 'utf8'))
    expect(exported.attachments[0].data).toBe(data)
    expect(exported.messages[0].attachments[0].kind).toBe('image')
    // Fake only the OS clipboard boundary, retaining actual Electron Blob decoding, IPC and SQLite.
    await app.evaluate(({ clipboard, ClipboardItem }, base64) => {
      const bytes = Uint8Array.from(Buffer.from(base64, 'base64'))
      clipboard.read = async () => [
        new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) }),
      ]
    }, data)
    const pasted = await page.evaluate(async () => {
      const state = await window.agenthub.invoke<{ projects: { id: string }[] }>({ op: 'snapshot' })
      return window.agenthub.invoke<{ kind: string; sha256: string }>({
        op: 'attachment.clipboard',
        projectId: state.projects[0].id,
      })
    })
    expect(pasted.kind).toBe('image')
    expect(pasted.sha256).toBe(exported.attachments[0].sha256)
    for (const format of ['jpeg', 'webp']) {
      const binary = await page.evaluate((format) => {
        const canvas = document.createElement('canvas')
        canvas.width = 40
        canvas.height = 30
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = 'blue'
        ctx.fillRect(0, 0, 40, 30)
        return canvas.toDataURL(`image/${format}`).split(',')[1]
      }, format)
      const file = join(project, `format.${format}`)
      await writeFile(file, Buffer.from(binary, 'base64'))
      const imported = await page.evaluate(async (path) => {
        const s = await window.agenthub.invoke<{ projects: { id: string }[] }>({ op: 'snapshot' })
        return window.agenthub.invoke<{ mime: string; preview: string }[]>({
          op: 'attachment.read',
          projectId: s.projects[0].id,
          paths: [path],
        })
      }, file)
      expect(imported[0].mime).toBe(`image/${format}`)
      expect(imported[0].preview).toMatch(/^data:image\/jpeg;base64,/)
    }
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await expect(page.locator('.message-attachments img')).toBeVisible()
    await page.locator('.message-attachments button').click()
    await expect(
      page.getByRole('dialog', { name: 'Image attachment' }).locator('img'),
    ).toBeVisible()
    await page.screenshot({ path: '.local/agenthub-image-viewer.png' })
    await page.getByRole('button', { name: 'Close / 關閉', exact: true }).click()
    await page.getByTitle('Reply').first().click()
    await expect(page.locator('.attachments img')).toBeVisible()
    await page.evaluate(async () => {
      const value = await window.agenthub.invoke<{ projects: { id: string }[] }>({ op: 'snapshot' })
      await window.agenthub.invoke({
        op: 'project.automation',
        projectId: value.projects[0].id,
        enabled: false,
      })
    })
    await page.getByRole('textbox', { name: 'Message' }).fill('@All Inspect the image')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    // This CI fixture has no worktrees: routing succeeds, then preflight fails visibly before any paid runtime.
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(() =>
              window.agenthub.invoke<{ tasks: { status: string }[] }>({ op: 'snapshot' }),
            )
          ).tasks.filter((t) => t.status === 'failed').length,
      )
      .toBe(3)
    await expect(page.getByText(/WORKSPACE_NOT_READY/).first()).toBeVisible()
    await expect(page.locator('.message-attachments img')).toHaveCount(2)
  } finally {
    await app.close()
  }
})
