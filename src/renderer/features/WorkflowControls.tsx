import { useState } from 'react'
import type { AgentProfile, Task } from '../../shared/types'
import { Button } from '../components/ui'
type Perform = (request: Record<string, unknown>) => Promise<unknown>
export function TaskForm({
  tasks,
  agents,
  conversationId,
  perform,
  en,
}: {
  tasks: Task[]
  agents: AgentProfile[]
  conversationId: string
  perform: Perform
  en: boolean
}) {
  const [description, setDescription] = useState('')
  const [owner, setOwner] = useState(agents[0]?.id || '')
  const [dependencies, setDependencies] = useState<string[]>([])
  return (
    <details className="task-form">
      <summary>{en ? '＋Create task with dependencies' : '＋新增任務與依賴'}</summary>
      <select aria-label="Task owner" value={owner} onChange={(e) => setOwner(e.target.value)}>
        {agents
          .filter((a) => a.enabled)
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
      </select>
      <textarea
        rows={3}
        aria-label="Task description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={en ? 'Describe the work' : '描述要執行的工作'}
      />
      {tasks
        .filter((t) => !t.supersededBy && t.status !== 'cancelled')
        .map((t) => (
          <label className="inline" key={t.id}>
            <input
              type="checkbox"
              checked={dependencies.includes(t.id)}
              onChange={(e) =>
                setDependencies(
                  e.target.checked
                    ? [...dependencies, t.id]
                    : dependencies.filter((id) => id !== t.id),
                )
              }
            />
            {en ? 'Wait for' : '等待'}: {t.name}
          </label>
        ))}
      <Button
        size="sm"
        disabled={!description.trim() || !owner}
        onClick={() =>
          void perform({
            op: 'task.create',
            conversationId,
            agentId: owner,
            description,
            dependencies,
          }).then(() => {
            setDescription('')
            setDependencies([])
          })
        }
      >
        {en ? 'Create task' : '建立任務'}
      </Button>
    </details>
  )
}
export function InitialCommit({
  projectId,
  perform,
  en,
}: {
  projectId: string
  perform: Perform
  en: boolean
}) {
  const [preview, setPreview] = useState<{
    id: string
    files: { path: string; bytes: number }[]
    excluded: number
  }>()
  const [selected, setSelected] = useState<string[]>([])
  return (
    <details className="initial-setup">
      <summary>{en ? 'Review an initial Git commit' : '審核初始 Git Commit'}</summary>
      <p className="muted">
        {en
          ? 'Initialize first. Inspect ignore rules and select only reviewed files.'
          : '先批准初始化，再檢查忽略規則與勾選要提交的檔案。'}
      </p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void perform({ op: 'git.ignore', projectId })}
      >
        {en ? 'Add build/credential ignore rules' : '加入建置／憑證忽略規則'}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          void perform({ op: 'git.initial.preview', projectId }).then((value) => {
            const p = value as typeof preview
            setPreview(p)
            setSelected(p?.files.map((f) => f.path) || [])
          })
        }
      >
        {en ? 'Preview files' : '預覽檔案清單'}
      </Button>
      {preview && (
        <>
          <p className="muted">
            {en ? 'Suspected credential files excluded' : '已排除疑似憑證檔案'}: {preview.excluded}
          </p>
          <div className="initial-file-list">
            {preview.files.map((file) => (
              <label className="inline" key={file.path}>
                <input
                  type="checkbox"
                  checked={selected.includes(file.path)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, file.path]
                        : selected.filter((p) => p !== file.path),
                    )
                  }
                />
                <span>
                  {file.path} · {file.bytes} B
                </span>
              </label>
            ))}
          </div>
          <Button
            size="sm"
            disabled={!selected.length}
            onClick={() => {
              if (
                window.confirm(
                  en
                    ? 'Approve committing only the selected files?'
                    : '批准只將勾選的檔案建立初始 Commit？',
                )
              )
                void perform({
                  op: 'git.initial.commit',
                  previewId: preview.id,
                  files: selected,
                }).then(() => setPreview(undefined))
            }}
          >
            {en ? 'Approve initial commit' : '批准初始 Commit'}
          </Button>
        </>
      )}
    </details>
  )
}
export function TestTools({
  workspaceId,
  perform,
  en,
}: {
  workspaceId: string
  perform: Perform
  en: boolean
}) {
  const [runner, setRunner] = useState('test')
  return (
    <details className="test-tools">
      <summary>{en ? 'Dependencies & additional test runners' : '依賴安裝與其他測試工具'}</summary>
      <select aria-label="Test runner" value={runner} onChange={(e) => setRunner(e.target.value)}>
        {[
          ['test', 'npm test'],
          ['pytest', 'Python pytest'],
          ['unittest', 'Python unittest'],
          ['dotnet', '.NET test'],
          ['cargo', 'Rust cargo test'],
          ['go', 'Go test'],
          ['install', 'npm ci --ignore-scripts'],
        ].map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        size="sm"
        disabled={!workspaceId}
        onClick={() => {
          if (
            window.confirm(
              en
                ? 'Run this project command as your OS user in the selected committed snapshot?'
                : '批准以目前使用者身分在所選的已提交快照執行此專案命令？',
            )
          )
            void perform({ op: 'test.run', workspaceId, script: runner })
        }}
      >
        {en ? 'Approve & run' : '批准並執行'}
      </Button>
      <p className="muted">
        {en
          ? 'Dependency installation uses the committed npm lockfile and disables install scripts. Test results are tied to this exact revision.'
          : '依賴安裝使用已提交的 npm lockfile 並停用安裝腳本；測試結果綁定此確切版本。'}
      </p>
    </details>
  )
}
