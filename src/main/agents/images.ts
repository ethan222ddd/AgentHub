import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RuntimeImage } from '../../shared/types'
import { withinWorkspace } from '../permissions/paths'
export function claudeImageContent(prompt: string, images: RuntimeImage[] = []) {
  return [
    { type: 'text' as const, text: prompt },
    ...images.map((image) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: image.mime, data: image.data },
    })),
  ]
}
export async function localImageInputs(images: RuntimeImage[] = [], workspace?: string) {
  if (!images.length)
    return { inputs: [] as { type: 'localImage'; path: string }[], dispose: async () => {} }
  const parent = workspace ? await withinWorkspace(workspace, workspace) : tmpdir()
  const directory = await mkdtemp(
    join(parent, workspace ? '.agenthub-images-' : 'agenthub-images-'),
  )
  const paths: string[] = []
  const dispose = async () => {
    // Never walk a directory the runtime replaced with a symlink/junction.
    if (workspace) {
      try {
        if ((await withinWorkspace(workspace, directory)) !== directory) return
      } catch {
        return
      }
    }
    for (const path of paths) await unlink(path).catch(() => {})
    await rmdir(directory).catch(() => {})
  }
  try {
    for (const [index, image] of images.entries()) {
      const extension =
        image.mime === 'image/jpeg' ? 'jpg' : image.mime === 'image/webp' ? 'webp' : 'png'
      const path = join(directory, `${index}.${extension}`)
      if (workspace) await withinWorkspace(workspace, path, true)
      await writeFile(path, Buffer.from(image.data, 'base64'), { flag: 'wx', mode: 0o600 })
      paths.push(path)
    }
    return { inputs: paths.map((path) => ({ type: 'localImage' as const, path })), dispose }
  } catch (error) {
    await dispose()
    throw error
  }
}
