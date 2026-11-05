import { exec, runtimeEnv } from '../agents/process'
export async function git(
  cwd: string,
  args: string[],
  trim = true,
  extraEnv: NodeJS.ProcessEnv = {},
  timeout = 30000,
): Promise<string> {
  const { stdout } = await exec(
    'git',
    [
      '-c',
      'core.hooksPath=NUL',
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.longpaths=true',
      '-c',
      'submodule.recurse=false',
      ...args,
    ],
    {
      cwd,
      windowsHide: true,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...runtimeEnv(),
        ...extraEnv,
        GIT_TERMINAL_PROMPT: '0',
        GIT_MERGE_AUTOEDIT: 'no',
        GIT_OPTIONAL_LOCKS: '0',
      },
    },
  )
  return trim ? stdout.trim() : stdout
}
