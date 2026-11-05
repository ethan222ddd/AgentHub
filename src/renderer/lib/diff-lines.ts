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

// Git C-quotes paths using octal UTF-8 bytes, not JavaScript Unicode escapes.
function unquote(path: string): string {
  if (!path.startsWith('"') || !path.endsWith('"')) return path
  const chars = [...path.slice(1, -1)]
  const encoder = new TextEncoder()
  const bytes: number[] = []
  const escapes: Record<string, number> = {
    a: 7,
    b: 8,
    t: 9,
    n: 10,
    v: 11,
    f: 12,
    r: 13,
    '"': 34,
    '\\': 92,
  }
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] !== '\\' || i + 1 === chars.length) {
      bytes.push(...encoder.encode(chars[i]))
      continue
    }
    const next = chars[++i]
    if (/[0-7]/.test(next)) {
      let octal = next
      while (octal.length < 3 && i + 1 < chars.length && /[0-7]/.test(chars[i + 1]))
        octal += chars[++i]
      bytes.push(parseInt(octal, 8))
    } else if (next in escapes) bytes.push(escapes[next])
    else bytes.push(...encoder.encode('\\' + next))
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}
const prefixedPath = (path: string) => unquote(path).replace(/^[ab]\//, '')

/** Parses `git diff` output into files and lines with old/new line numbers. */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | undefined
  let oldLine = 0,
    newLine = 0
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (line.startsWith('diff --git ')) {
      const match = /^diff --git ("(?:\\.|[^"\\])*"|a\/.*?) ("(?:\\.|[^"\\])*"|b\/.*)$/.exec(line)
      file = {
        path: prefixedPath(match?.[2] || line.slice(11)),
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
      else if (line.startsWith('rename to ')) {
        file.status = 'renamed'
        file.path = unquote(line.slice(10))
      } else if (line.startsWith('Binary files')) file.status = 'binary'
      else if (line.startsWith('--- ') && line !== '--- /dev/null')
        file.path = prefixedPath(line.slice(4).split('\t')[0])
      else if (line.startsWith('+++ ') && line !== '+++ /dev/null')
        file.path = prefixedPath(line.slice(4).split('\t')[0])
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
