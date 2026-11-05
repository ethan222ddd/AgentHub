import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { GitHubIssue, GitHubStatus, PullRequestChecks } from '../../shared/types'
import { exec, findRuntime, runtimeEnv } from '../agents/process'

/** How to launch gh: the official CLI, or (in tests) node plus a fixture script. */
export interface GhCommand {
  file: string
  prefix: string[]
}
export async function locateGh(): Promise<GhCommand | undefined> {
  const found = await findRuntime('gh')
  if (found) return { file: found, prefix: [] }
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const installed = join(programFiles, 'GitHub CLI', 'gh.exe')
  return existsSync(installed) ? { file: installed, prefix: [] } : undefined
}

export class GhError extends Error {}

/**
 * Thin wrapper over the user's own logged-in GitHub CLI. Arguments are fixed host-built lists,
 * never shell strings; gh manages its own credentials and AgentHub never reads the token.
 */
export class GitHubCli {
  private command?: Promise<GhCommand | undefined>
  constructor(private locate: () => Promise<GhCommand | undefined> = locateGh) {}

  private resolve() {
    this.command ??= this.locate()
    return this.command
  }

  async run(args: string[], cwd: string, timeout = 60000, maxBuffer = 4 * 1024 * 1024) {
    const command = await this.resolve()
    if (!command)
      throw new GhError(
        '找不到 GitHub CLI。請安裝 gh 並執行 gh auth login。GitHub CLI not found; install gh and run gh auth login.',
      )
    try {
      const { stdout } = await exec(command.file, [...command.prefix, ...args], {
        cwd,
        windowsHide: true,
        timeout,
        maxBuffer,
        env: {
          ...runtimeEnv(),
          GH_PROMPT_DISABLED: '1',
          GH_NO_UPDATE_NOTIFIER: '1',
          GH_SPINNER_DISABLED: '1',
          NO_COLOR: '1',
          GIT_TERMINAL_PROMPT: '0',
        },
      })
      return stdout
    } catch (error) {
      const detail = (error as { stderr?: string }).stderr || (error as Error).message
      throw new GhError(String(detail).trim().slice(0, 2000) || 'gh failed')
    }
  }

  async status(cwd: string): Promise<GitHubStatus> {
    if (!(await this.resolve()))
      return { available: false, authenticated: false, error: 'GitHub CLI not found' }
    let account: string | undefined
    try {
      const out = await this.run(['auth', 'status', '--hostname', 'github.com'], cwd, 20000)
      account = /account (\S+)/.exec(out)?.[1]
    } catch (error) {
      const message = String((error as Error).message)
      if (/not logged in|gh auth login/i.test(message))
        return { available: true, authenticated: false, error: 'Not logged in to github.com' }
      account = /account (\S+)/.exec(message)?.[1]
      if (!account) return { available: true, authenticated: false, error: message.slice(0, 300) }
    }
    try {
      const repo = JSON.parse(
        await this.run(
          ['repo', 'view', '--json', 'nameWithOwner,url,defaultBranchRef'],
          cwd,
          20000,
        ),
      ) as { nameWithOwner: string; url: string; defaultBranchRef?: { name?: string } }
      return {
        available: true,
        authenticated: true,
        account,
        repo: {
          nameWithOwner: repo.nameWithOwner,
          url: repo.url,
          defaultBranch: repo.defaultBranchRef?.name || 'main',
        },
      }
    } catch (error) {
      return {
        available: true,
        authenticated: true,
        account,
        error: `No GitHub repository for this folder: ${String((error as Error).message).slice(0, 200)}`,
      }
    }
  }

  async issues(cwd: string): Promise<GitHubIssue[]> {
    const rows = JSON.parse(
      await this.run(
        [
          'issue',
          'list',
          '--state',
          'open',
          '--limit',
          '30',
          '--json',
          'number,title,url,labels,author,updatedAt',
        ],
        cwd,
      ),
    ) as {
      number: number
      title: string
      url: string
      labels?: { name: string }[]
      author?: { login?: string }
      updatedAt: string
    }[]
    return rows.map((r) => ({
      number: r.number,
      title: r.title,
      url: r.url,
      labels: (r.labels || []).map((l) => l.name),
      author: r.author?.login || '',
      updatedAt: r.updatedAt,
    }))
  }

  async issue(cwd: string, number: number) {
    return JSON.parse(
      await this.run(
        ['issue', 'view', String(number), '--json', 'number,title,body,url,labels,comments'],
        cwd,
      ),
    ) as {
      number: number
      title: string
      body?: string
      url: string
      labels?: { name: string }[]
      comments?: { author?: { login?: string }; body?: string }[]
    }
  }

  async createPr(
    cwd: string,
    input: { repo: string; base: string; branch: string; title: string; bodyFile: string },
  ): Promise<string> {
    const out = await this.run(
      [
        'pr',
        'create',
        '--repo',
        input.repo,
        '--base',
        input.base,
        '--head',
        input.branch,
        '--title',
        input.title,
        '--body-file',
        input.bodyFile,
      ],
      cwd,
      120000,
    )
    const url = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .reverse()
      .find((l) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(l))
    if (!url) throw new GhError(`gh did not return a pull request URL: ${out.slice(0, 300)}`)
    return url
  }

  async prStatus(cwd: string, url: string) {
    const raw = JSON.parse(
      await this.run(['pr', 'view', url, '--json', 'state,statusCheckRollup'], cwd),
    ) as { state: 'OPEN' | 'CLOSED' | 'MERGED'; statusCheckRollup?: unknown[] }
    return { state: raw.state, checks: summarizeChecks(raw.statusCheckRollup || []) }
  }

  async failedLog(cwd: string, runId: string): Promise<string> {
    if (!/^\d{1,20}$/.test(runId)) throw new GhError('Invalid run id')
    const out = await this.run(
      ['run', 'view', runId, '--log-failed'],
      cwd,
      120000,
      16 * 1024 * 1024,
    )
    return out.slice(-12000)
  }
}

const failed = new Set([
  'FAILURE',
  'CANCELLED',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'ERROR',
])
/** Collapses GitHub's mixed CheckRun / StatusContext rollup into one state. */
export function summarizeChecks(rollup: unknown[]): PullRequestChecks {
  const failing: PullRequestChecks['failing'] = []
  let pending = false
  for (const item of rollup as Record<string, string | undefined>[]) {
    const name = item.name || item.context || 'check'
    const url = item.detailsUrl || item.targetUrl
    const conclusion = (item.conclusion || item.state || '').toUpperCase()
    // CheckRun reports status + conclusion; a commit StatusContext reports only state.
    const done = item.status ? item.status === 'COMPLETED' : item.state !== 'PENDING'
    if (!done || conclusion === 'PENDING' || conclusion === 'EXPECTED') pending = true
    else if (failed.has(conclusion))
      failing.push({ name, url, runId: /\/actions\/runs\/(\d+)/.exec(url || '')?.[1] })
  }
  return {
    state: failing.length ? 'failing' : pending ? 'pending' : rollup.length ? 'passing' : 'none',
    failing,
    checkedAt: new Date().toISOString(),
  }
}
