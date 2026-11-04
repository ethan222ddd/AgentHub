# Native runtime capabilities — v0.4.0

AgentHub 保留每家真正 Coding Runtime，沒有把它們降成純聊天模型。模型、帳號、CLI 版本和原生政策仍會影響可用工具；錯誤顯示於訊息及 Activity，不能假稱成功。Claude/Antigravity 的原生 init 工具清單另記錄為 `session.capabilities`，不擷取私人推理。

| 能力 | Codex App Server | Claude Code native / SDK | Antigravity CLI |
|---|---|---|---|
| 讀取本機資料 | 指派工作區及原生 sandbox | 原生 Read/Glob/Grep，Host canonical 邊界檢查；native --restricted | native read_file/list/search，逐回合批准工作區 |
| 寫檔 | 原生 patch/file tools + native approval | Write/Edit/NotebookEdit，逐工具批准 | 工作區 write_file(.)，唯讀 Review 禁止 |
| 本地圖像 | 原生 localImage | 原生 base64 image content；Read 工具也保留 | 工作區暫存原檔 + 影像原生 read_file，確認工具成功後接受結果 |
| Shell / 測試工具 | 原生工具 + 單次批准 | Bash 單次批准；唯讀 Review 禁止 | 設定確切 command 清單，逐回合批准；保留 native sandbox |
| 網路研究 | 每回合批准後 web_search=live；拒絕仍可本機工作 | WebSearch/WebFetch 恢復到明確工具清單，逐工具批准 | 保留原生 search_web；原生 URL/command 網路 grant 使用設定的 domain 清單 |
| 額外網路權限 | 支援原生 permissions/requestApproval 的 network.enabled，僅 turn scope；不附帶擴大檔案權限 | 依原生工具權限及使用者審核 Shell | read_url(domain) 套用 sandbox 網路 allowlist；不允許未沙盒執行 |
| 協作 | 原生 dynamic tool | Host HTTP MCP / SDK MCP | JSON Schema bridge；Host 資料以同 Session 最多三次原生續接回傳 |

## 使用方式

一般檔案工作先建立 Git 隔離工作區，每個成員操作自己的副本。主專案未提交的檔案不會自動出現在 worktree。使用附件選取專案內檔案，或明確整合已提交版本；角色、聊天訊息和其他 Agent 請求不會擴大權限。

Claude 的 `--restricted` 必須以具名 `--tools` 啟用 WebFetch，不能靠 default；現在 native 和 SDK 共用相同的工具清單與 Host gate，未知工具拒絕，WebFetch 禁止 file: URL 及帶帳密 URL。

Antigravity 設定 → 代理中，確切指令每行一個，例如 `npm test`；網域只填 `example.com`，不含協定、路徑或萬用字元，包含子網域。每回合開始顯示工作區、指令、網域及圖片清單，要求批准。原生網頁搜尋查詢同樣會離開本機，已寫在回合批准中。沒有 `--dangerously-skip-permissions`。

注意原生工具差異：本次本機 agy 1.4.12 的測試 Session 提供 `search_web`，未提供 `read_url_content`；因此能真正聯網搜尋，但不把搜尋結果冒稱直接頁面擷取。只使用 init 實際提供的工具。已另外用原生 run_command 執行確切 `curl.exe -I https://example.com/`，在只准 example.com 的 native sandbox 得到 HTTP 200，確認終端機網路規則可用。無法批准的 headless 操作會失敗，需要使用者更正範圍後重新執行。

Shell 與專案測試可執行專案程式，仍需審閱命令；Host 的檔案 gate 不等於對任意 Shell 程式的完整 OS 隔離。Codex/AGY 保留原生 sandbox，Claude native 的 restricted file boundary 不代表 Windows Shell sandbox。此差異不隱藏於能力宣稱中。

## 驗證與官方來源

- Fixture tests：`tests/tool-capabilities.test.ts`、`native-bridge.test.ts`、`adapters.test.ts`，包含逐工具拒絕、readonly、network-only grants、網域 Schema、暫存與 junction 清理安全。
- 真實打包版：`scripts/live-images.ts`、`scripts/live-web.ts`、`scripts/packaged-team-chat.ts`，只送生成圖像及 example.com 公開請求，不傳送專案秘密。報告含 app.asar 雜湊。
- 真實原生檔案/Session：`scripts/live.ts`；AGY 網路終端：`npx tsx scripts/live-antigravity-command.ts --web`。
- [AGY Headless protocol](https://antigravity.google/docs/cli/headless/)、[AGY permission rules](https://antigravity.google/docs/permissions)、[Claude tools/restricted flags](https://code.claude.com/docs/en/cli-reference)、[Codex config](https://learn.chatgpt.com/docs/config-file/config-reference)。Codex permission grant 使用本機 0.166.0 產生的 App Server schema；其他版本需通過相容檢查。
