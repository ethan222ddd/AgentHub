import { useState } from 'react'
import type { AgentProfile, Project } from '../../shared/types'
import { Button } from '../components/ui'
import { useDialog } from '../components/useDialog'
export function TeamEditor({
  project,
  agents,
  close,
  perform,
  en,
}: {
  project: Project
  agents: AgentProfile[]
  close(): void
  perform(request: Record<string, unknown>): Promise<unknown>
  en: boolean
}) {
  const [selected, setSelected] = useState(
    project.agentIds || agents.filter((a) => a.enabled).map((a) => a.id),
  )
  const [overrides, setOverrides] = useState(project.agentOverrides || {})
  const dialogRef = useDialog(close)
  return (
    <div className="modal-backdrop">
      <section
        ref={dialogRef}
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Project team"
      >
        <header>
          <h2>
            {en ? 'Project team' : '專案團隊'} · {project.name}
          </h2>
          <Button variant="ghost" onClick={close}>
            {en ? 'Close' : '關閉'}
          </Button>
        </header>
        <div className="settings-content">
          <p className="muted">
            {en
              ? 'Roles and instructions apply only to this project. They do not grant additional permissions.'
              : '角色與指示僅套用於此專案，不會授予額外操作權限。'}
          </p>
          {agents.map((agent) => (
            <section className="agent-setting" key={agent.id}>
              <label className="inline">
                <input
                  type="checkbox"
                  checked={selected.includes(agent.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, agent.id]
                        : selected.filter((id) => id !== agent.id),
                    )
                  }
                />
                {agent.name} · {agent.enabled ? agent.provider : 'disabled'}
              </label>
              <label>
                {en ? 'Project role' : '專案角色'}
                <input
                  value={overrides[agent.id]?.role ?? agent.role}
                  onChange={(e) =>
                    setOverrides({
                      ...overrides,
                      [agent.id]: {
                        role: e.target.value,
                        instructions: overrides[agent.id]?.instructions ?? agent.instructions,
                      },
                    })
                  }
                />
              </label>
              <label>
                {en ? 'Project instructions' : '專案指示'}
                <textarea
                  rows={3}
                  value={overrides[agent.id]?.instructions ?? agent.instructions}
                  onChange={(e) =>
                    setOverrides({
                      ...overrides,
                      [agent.id]: {
                        role: overrides[agent.id]?.role ?? agent.role,
                        instructions: e.target.value,
                      },
                    })
                  }
                />
              </label>
            </section>
          ))}
        </div>
        <footer>
          <span className="muted">
            {en
              ? 'Stop project tasks before editing the team.'
              : '修改團隊前請先停止此專案的任務。'}
          </span>
          <Button
            onClick={() =>
              void perform({
                op: 'project.team',
                id: project.id,
                agentIds: selected,
                overrides,
              }).then(close)
            }
          >
            {en ? 'Save team' : '儲存團隊'}
          </Button>
        </footer>
      </section>
    </div>
  )
}
