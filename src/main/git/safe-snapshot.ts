import { lstat, mkdir, readFile, rm } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { withinWorkspace } from '../permissions/paths'
import { git } from './command'

export interface SafeFile {
  path: string
  hash: string
  blobs?: string[]
  deleted: boolean
}
export interface Scan {
  files: SafeFile[]
  excluded: string[]
  review: string[]
}
export const author = [
  '-c',
  'user.name=AgentHub',
  '-c',
  'user.email=local@agenthub.invalid',
  '-c',
  'commit.gpgsign=false',
]
export async function rejectExecutableFilters(root: string, paths: string[], source?: string) {
  for (let n = 0; n < paths.length; n += 64) {
    const result = await git(root, [
      'check-attr',
      ...(source ? ['--source', source] : []),
      'filter',
      'merge',
      '--',
      ...paths.slice(n, n + 64),
    ])
    if (
      result.split('\n').some((line) => {
        const value = /: filter: (.+)$/.exec(line)?.[1]
        return value && !['unspecified', 'unset'].includes(value)
      })
    )
      throw new Error(
        'Git clean/smudge filter requires explicit review before automatic execution. No filter command was run; files were preserved.',
      )
    if (
      result.split('\n').some((line) => {
        const value = /: merge: (.+)$/.exec(line)?.[1]
        return value && !['unspecified', 'unset', 'set', 'text', 'binary', 'union'].includes(value)
      })
    )
      throw new Error(
        'Git custom merge driver requires explicit review before automatic execution; files were preserved.',
      )
  }
  const defaultMerge = await git(root, ['config', '--get', 'merge.default']).catch(() => '')
  if (defaultMerge && !['text', 'binary', 'union'].includes(defaultMerge))
    throw new Error(
      'Custom default merge driver requires explicit review before automatic Git operations.',
    )
}
export async function assertSafeGitAttributes(root: string) {
  const paths = (
    (await git(root, ['ls-files', '-z'], false)) +
    (await git(root, ['ls-files', '--others', '--exclude-standard', '-z'], false))
  )
    .split('\0')
    .filter(Boolean)
  await rejectExecutableFilters(root, [...new Set(paths)])
  const head = await git(root, ['rev-parse', '--verify', 'HEAD']).catch(() => '')
  if (head)
    await rejectExecutableFilters(
      root,
      (await git(root, ['ls-tree', '-r', '--name-only', '-z', head], false))
        .split('\0')
        .filter(Boolean),
      head,
    )
}
const secretPath =
  /(^|\/)(\.env(?:\..*)?|\.npmrc|\.pypirc|credentials(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|ed25519)|.*\.(?:pem|key|p12|pfx|keystore|sqlite|db))$/i
const textTypes = new Set(
  '.js .mjs .cjs .jsx .ts .tsx .html .htm .css .scss .less .json .md .txt .yaml .yml .toml .xml .svg .py .rs .go .cs .sln .csproj .fs .fsproj .sql .graphql .gql .gitignore .gitattributes .editorconfig .lock .cfg .ini .sh .ps1 .bat .cmd .vue .svelte .java .kt .c .cpp .h .hpp .rb .php .ipynb'.split(
    ' ',
  ),
)
export function hasSecret(text: string): boolean {
  return (
    /-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----|\bAKIA[A-Z0-9]{16}\b|\b(?:sk-[a-zA-Z0-9_-]{20,}|AIza[a-zA-Z0-9_-]{25,}|gh[pousr]_[a-zA-Z0-9]{25,})\b/.test(
      text,
    ) ||
    /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*["']?\s*[:=]\s*["'](?!\$|\{|<|YOUR_|your_|example|placeholder|changeme|process\.env)[^"'\r\n]{1,}["']/i.test(
      text,
    )
  )
}
export async function scanFiles(root: string, paths: string[]): Promise<Scan> {
  const scan: Scan = { files: [], excluded: [], review: [] }
  const unique = [...new Set(paths)]
  if (unique.length > 5000)
    throw new Error(
      'Too many files for automatic safety review; add ignore rules or review the project first.',
    )
  let total = 0
  for (const path of unique) {
    if (secretPath.test(path)) {
      scan.excluded.push(path)
      continue
    }
    try {
      const absolute = await withinWorkspace(root, path, true)
      let stat
      try {
        stat = await lstat(join(root, path))
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
        scan.files.push({ path, hash: '', deleted: true })
        continue
      }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        scan.review.push(`${path} (not a regular file)`)
        continue
      }
      if (stat.size > 5 * 1024 * 1024 || (total += stat.size) > 64 * 1024 * 1024) {
        scan.review.push(`${path} (size limit)`)
        continue
      }
      const data = await readFile(absolute)
      const extension = extname(path).toLowerCase()
      const text =
        textTypes.has(extension) ||
        /^\.(?:gitignore|gitattributes|editorconfig)$|^(?:Dockerfile|LICENSE|Makefile)$/i.test(
          basename(path),
        )
      if (text) {
        if (data.includes(0) || hasSecret(data.toString('utf8'))) {
          scan.review.push(`${path} (binary or possible secret)`)
          continue
        }
      } else if (!(
        (extension === '.png' &&
          data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
        (/^\.jpe?g$/.test(extension) && data[0] === 255 && data[1] === 216) ||
        (extension === '.webp' && data.toString('ascii', 8, 12) === 'WEBP')
      )) {
        scan.review.push(`${path} (unknown file type)`)
        continue
      }
      scan.files.push({
        path,
        hash: createHash('sha256').update(data).digest('hex'),
        blobs: [
          data,
          ...(text ? [Buffer.from(data.toString('utf8').replaceAll('\r\n', '\n'))] : []),
        ].flatMap((bytes) =>
          ['sha1', 'sha256'].map((algorithm) =>
            createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),
          ),
        ),
        deleted: false,
      })
    } catch {
      scan.review.push(`${path} (unreadable or outside workspace)`)
    }
  }
  return scan
}
export async function changedFiles(root: string, initial = false): Promise<string[]> {
  const tracked = initial
    ? await git(root, ['ls-files', '-z'], false)
    : await git(
        root,
        ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', 'HEAD', '--name-only', '-z'],
        false,
      )
  const others = await git(root, ['ls-files', '--others', '--exclude-standard', '-z'], false)
  return [...new Set((tracked + others).split('\0').filter(Boolean))]
}
// An alternate index keeps unrelated user staging intact. No add-all/reset/clean commands.
export async function safeCommit(
  root: string,
  scan: Scan,
  directory: string,
  message: string,
): Promise<string> {
  await mkdir(directory, { recursive: true })
  const index = join(directory, `index-${randomUUID()}`)
  const env = { GIT_INDEX_FILE: index }
  const targetRef = await git(root, ['symbolic-ref', 'HEAD'])
  if (!targetRef.startsWith('refs/heads/'))
    throw new Error('A checked-out branch is required for safe automatic snapshots.')
  const realIndex = resolve(root, await git(root, ['rev-parse', '--git-path', 'index']))
  const indexHash = async () =>
    readFile(realIndex)
      .then((bytes) => createHash('sha256').update(bytes).digest('hex'))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
  let expectedIndex = await indexHash()
  let head = ''
  try {
    head = await git(root, ['rev-parse', '--verify', 'HEAD'])
  } catch {
    /* unborn */
  }
  const staged = new Set(
    (await git(root, ['diff', '--no-renames', '--cached', '--name-only', '-z'], false))
      .split('\0')
      .filter(Boolean),
  )
  try {
    await rejectExecutableFilters(
      root,
      scan.files.map((f) => f.path),
    )
    await git(root, ['read-tree', head || '--empty'], true, env)
    for (let n = 0; n < scan.files.length; n += 64) {
      const files = scan.files.slice(n, n + 64)
      for (const file of files) {
        const path = await withinWorkspace(root, file.path, true)
        if (
          !file.deleted &&
          createHash('sha256')
            .update(await readFile(path))
            .digest('hex') !== file.hash
        )
          throw new Error('File changed during safe snapshot; retry preparation.')
      }
      if (files.length) await git(root, ['add', '--', ...files.map((f) => f.path)], true, env)
      const entries = new Map(
        (
          await git(
            root,
            ['ls-files', '--stage', '-z', '--', ...files.map((f) => f.path)],
            false,
            env,
          )
        )
          .split('\0')
          .filter(Boolean)
          .map((entry) => {
            const match = /^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(entry)
            return [
              match?.[4] || '',
              { mode: match?.[1], blob: match?.[2], stage: match?.[3] },
            ] as const
          }),
      )
      for (const file of files.filter((f) => !f.deleted)) {
        const entry = entries.get(file.path)
        if (
          !entry?.blob ||
          !file.blobs?.includes(entry.blob) ||
          !/^100(?:644|755)$/.test(entry.mode || '') ||
          entry.stage !== '0'
        )
          throw new Error('Staged file changed during safety review; no commit was created.')
      }
    }
    const tree = await git(root, ['write-tree'], true, env)
    if (head && tree === (await git(root, ['rev-parse', 'HEAD^{tree}']))) return head
    const commit = await git(root, [
      ...author,
      'commit-tree',
      tree,
      ...(head ? ['-p', head] : []),
      '-m',
      message,
    ])
    const objectFormat = await git(root, ['rev-parse', '--show-object-format'])
    if (
      (await git(root, ['symbolic-ref', 'HEAD'])) !== targetRef ||
      (await indexHash()) !== expectedIndex
    )
      throw new Error(
        'Branch or staging area changed during snapshot; no user staging was overwritten.',
      )
    await git(root, [
      'update-ref',
      targetRef,
      commit,
      head || '0'.repeat(objectFormat === 'sha256' ? 64 : 40),
    ])
    // Never rewrite an existing staged entry. New safe paths can match their new HEAD version.
    const sync = scan.files.filter((f) => !staged.has(f.path)).map((f) => f.path)
    for (let n = 0; n < sync.length; n += 64) {
      if (
        (await git(root, ['symbolic-ref', 'HEAD'])) !== targetRef ||
        (await indexHash()) !== expectedIndex
      )
        throw new Error(
          'Snapshot committed but branch/staging changed externally; state preserved for inspection.',
        )
      await git(root, ['restore', `--source=${commit}`, '--staged', '--', ...sync.slice(n, n + 64)])
      expectedIndex = await indexHash()
    }
    return commit
  } finally {
    // Only this call's exact, app-owned temporary index files are removed.
    await rm(index, { force: true })
    await rm(index + '.lock', { force: true })
  }
}
