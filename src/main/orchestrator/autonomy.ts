/**
 * Host policy for autonomous rooms. Routine development inside the agent's own workspace is
 * approved without stopping the team; anything that publishes, rewrites history, touches
 * credentials, changes the system or deletes outside the workspace is denied. Every decision
 * is recorded as task activity so the user can audit it afterwards.
 */
export interface AutoDecision {
  allow: boolean
  reason: string
}

const deny: [RegExp, string][] = [
  [/\bgit\b[^\n"]*\bpush\b/i, 'publishing to a remote needs the user'],
  [/--force\b|\bpush\s+-f\b/i, 'force operations need the user'],
  [
    /\breset\s+--hard\b|\bgit\b[^\n"]*\bclean\s+-[a-z]*f|\bfilter-branch\b|\bbranch\s+-D\b|\bcheckout\s+--\s+\.|\brebase\b/i,
    'rewrites or discards Git history',
  ],
  [/\bworktree\s+(?:remove|prune|move)\b/i, 'changes AgentHub worktree registration'],
  [
    /\.ssh\b|\.aws\b|\.npmrc\b|\.pypirc\b|\bid_rsa\b|\bid_ed25519\b|credentials?\b(?![-\w]*\.(?:ts|tsx|js|md))|\.env\b(?!\.example)/i,
    'touches credentials',
  ],
  [
    /\bnpm\s+(?:publish|login|adduser|token)\b|\bnpm\s+config\s+set\b/i,
    'publishes or changes package-manager accounts',
  ],
  [
    /\bshutdown\b|\bformat\s+[a-z]:|\breg\s+(?:add|delete)\b|Set-ExecutionPolicy|\bnetsh\b|\bsc\s+(?:stop|delete|config)\b|\bbcdedit\b|\bschtasks\b/i,
    'changes the operating system',
  ],
  [/\bsudo\b|\brunas\b|Start-Process[^\n"]*-Verb\s+RunAs/i, 'requests elevated OS privileges'],
]
const destructive = /\b(?:rm|rmdir|rd|del|erase|Remove-Item|Move-Item|mv|unlink)\b/i
const absolutePath = /[A-Za-z]:(?:\\\\|\\|\/)[^\s"'`,;|<>]*/g

const normalize = (path: string) =>
  path.replace(/\\\\/g, '\\').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

export function autoDecision(tool: string, detail: string, roots: string[]): AutoDecision {
  const text = `${tool}\n${detail}`
  for (const [pattern, reason] of deny) if (pattern.test(text)) return { allow: false, reason }
  if (destructive.test(detail)) {
    const allowed = roots.filter(Boolean).map(normalize)
    for (const match of detail.match(absolutePath) || []) {
      const target = normalize(match)
      if (!allowed.some((root) => target === root || target.startsWith(root + '\\')))
        return { allow: false, reason: `deletes or moves outside the workspace: ${match}` }
    }
    if (/(?:^|[\s"'])(?:\.\.[\\/]|~[\\/]?)/.test(detail))
      return { allow: false, reason: 'deletes or moves outside the workspace' }
  }
  return { allow: true, reason: 'routine development inside the assigned workspace' }
}
