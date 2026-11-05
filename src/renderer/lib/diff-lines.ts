export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk' | 'meta'
  text: string
  /** Line number in the new (working tree) version; comments anchor here. */
  newLine?: number
  oldLine?: number
}
export interface DiffFile {
  path: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'binary'
  lines: DiffLine[]
  additions: number
  deletions: number
}

const unquote = (path: string) =>
  path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1).replace(/\\(.)/g, '$1') : path

/** Parses `git diff` output into files and lines with old/new line numbers. */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | undefined
  let oldLine = 0,
    newLine = 0
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith('diff --git ')) {
      const match = /^diff --git (?:"?a\/)(.+?)"? (?:"?b\/)(.+?)"?$/.exec(line)
      file = {
        path: unquote(match?.[2] || line.slice(11)),
        status: 'modified',
        lines: [],
        additions: 0,
        deletions: 0,
      }
      files.push(file)
      continue
    }
    if (!file) continue
    if (line.startsWith('@@')) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      oldLine = Number(match?.[1] || 0)
      newLine = Number(match?.[2] || 0)
      file.lines.push({ kind: 'hunk', text: line })
      continue
    }
    if (!file.lines.some((l) => l.kind === 'hunk')) {
      if (line.startsWith('new file mode')) file.status = 'added'
      else if (line.startsWith('deleted file mode')) file.status = 'deleted'
      else if (line.startsWith('rename to ')) file.status = 'renamed'
      else if (line.startsWith('Binary files')) file.status = 'binary'
      else if (line.startsWith('+++ ') && line !== '+++ /dev/null')
        file.path = unquote(line.slice(4).replace(/^b\//, ''))
      continue
    }
    if (line.startsWith('+')) {
      file.lines.push({ kind: 'add', text: line.slice(1), newLine: newLine++ })
      file.additions++
    } else if (line.startsWith('-')) {
      file.lines.push({ kind: 'del', text: line.slice(1), oldLine: oldLine++ })
      file.deletions++
    } else if (line.startsWith(' ')) {
      file.lines.push({ kind: 'ctx', text: line.slice(1), oldLine: oldLine++, newLine: newLine++ })
    } else if (line.startsWith('\\')) {
      file.lines.push({ kind: 'meta', text: line })
    }
  }
  return files
}
