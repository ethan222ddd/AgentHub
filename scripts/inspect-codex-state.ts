import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { redact } from '../src/main/permissions/paths'
const file = join(process.env.APPDATA || '', 'AgentHub', 'agenthub.sqlite')
const output: Record<string, unknown> = { databaseExists: existsSync(file) }
if (existsSync(file)) {
  const db = new DatabaseSync(file, { readOnly: true })
  for (const table of ['projects', 'conversations', 'messages', 'tasks', 'sessions', 'workspaces'])
    output[`${table}Count`] = db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n
  output.agents = db
    .prepare(
      "SELECT json_extract(data,'$.id') id, json_extract(data,'$.provider') provider, json_extract(data,'$.enabled') enabled FROM agents",
    )
    .all()
  output.messageRouting = db
    .prepare(
      "SELECT json_extract(data,'$.type') type, json_extract(data,'$.recipientIds') recipients, json_extract(data,'$.delivery') delivery, count(*) count FROM messages GROUP BY type, recipients, delivery",
    )
    .all()
  output.recentTasks = db
    .prepare(
      "SELECT json_extract(data,'$.id') id, json_extract(data,'$.agentId') agentId, json_extract(data,'$.status') status, json_extract(data,'$.error') error FROM tasks ORDER BY rowid DESC LIMIT 20",
    )
    .all()
  output.activityTypes = db
    .prepare(
      "SELECT json_extract(data,'$.type') type, count(*) count FROM activities GROUP BY type",
    )
    .all()
  db.close()
}
const text = redact(JSON.stringify(output, null, 2))
mkdirSync(resolve('.local/codex-debug'), { recursive: true })
writeFileSync(resolve('.local/codex-debug/baseline-state.json'), text)
console.log(text)
