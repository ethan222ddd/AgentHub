# AgentHub v0.1.1 — Windows Codex Runtime 修復

2026-10-31，Asia/Taipei。

## 先定位，再修復

直接讀取使用者現有 SQLite 的路由與任務 metadata（read-only，未讀取聊天內容、未修改現有資料），結果：

- Codex 已啟用；三則訊息的 recipients 都是 `["codex"]`，訊息成功進入 Orchestrator。
- `workspacesCount = 0`、`sessionsCount = 0`、沒有 Runtime activity。
- 三個 Codex 任務都因 `Create isolated Git workspaces using Changes → Prepare workspaces before running agents.` 失敗。
- 失敗發生在 `execute()` 的工作區檢查，早於 Codex Adapter、spawn 與 initialize。
- v0.1.0 在通過這項檢查後才建立 Agent 回覆訊息；catch 只有在該訊息已存在時才寫入錯誤，因此聊天室沒有顯示失敗。

這是本次現有使用紀錄中「只有使用者訊息，Codex 無任何回覆」的直接原因，**不是已觀測到的 `.cmd` spawn 例外**。

另確認一個真實的 Windows npm 相容性缺口：

- `where codex` 先回傳 `%APPDATA%/npm/codex`、`codex.cmd`，之後才是 Codex Desktop 的 EXE。
- 舊 `findRuntime()` 只接受 `.exe`，因此略過 npm 安裝；完整 PATH 下會改選另一份 Desktop Codex，npm-only PATH 下則回報未安裝。
- 舊程式實際上是 `spawn(解析後的絕對EXE路徑, ['app-server'], shell:false)`，不是 `spawn('codex.cmd')`。
- 在此 Windows／Node 環境的獨立受控探測中，直接 `spawn(codex.cmd, ['--version'], {shell:false})` 確實同步拋出 `EINVAL`。此探測證明不能用直接啟動 cmd shim 的方式修復；原先任務尚未走到該階段。

原始證據保存在：`.local/codex-debug/baseline-state.json`、`baseline-launch.json`、`baseline-packaged-report.json`、`baseline-packaged.png`。舊版打包重現使用獨立測試資料目錄與 npm-only PATH，沒有修改使用者現有專案／對話。

## 最小修復

1. `src/main/agents/codex-runtime.ts`：依 PATH 順序處理原生 EXE 與 npm shim。只讀套件 metadata，從 `@openai/codex` 的 optional `@openai/codex-win32-x64/arm64` 套件或舊 vendor 佈局尋找真正的 `codex.exe`。支援巢狀 node_modules、空白／Unicode 路徑及預設 APPDATA npm prefix。缺少原生套件時明確失敗，不執行 `.cmd` 或任意 Shell。
2. `agents/process.ts`：仍以絕對 EXE＋argv、`shell:false`、pipe stdio 執行；保留程序樹終止與 RPC ID 配對。補 spawn／I/O error、exit code、host 主動停止、RPC request／response／timeout 日誌。
3. `orchestrator/orchestrator.ts`：在 preflight 之前保存 Agent 回覆容器，讓工作區缺失與 Runtime 啟動失敗也會出現在聊天室。錯誤有 `WORKSPACE_NOT_READY` 代碼，提供可操作的恢復說明。
4. `renderer/App.tsx`：缺少工作區的失敗訊息提供「設定隔離工作區」按鈕；指定已停用的 Agent 時顯示明確錯誤。版本號使用 package version。
5. `app/diagnostics.ts`、`main/index.ts`、`ipc/handlers.ts`、`agents/codex.ts`：追蹤 Renderer／Preload → IPC → routing → queue → preflight → native process → initialize／thread／turn → streaming → completion。以 message／correlation／task／session／turn ID 串接。
6. 新版安裝包分版本輸出至 `release/0.1.1`，避免覆蓋被鎖定的舊版目錄。未改變 native sandbox、批准政策、登入方式或使用者的既有 Git。

沒有使用 `cmd.exe` wrapper，所以沒有新增 Shell 跳脫路徑或繞過批准。沒有讀取、搬移或自行解析 Codex 的驗證 Token。

## 診斷日誌

預設 `%APPDATA%/AgentHub/logs/diagnostics.jsonl`；獨立 profile 為 `<user-data-dir>/logs/diagnostics.jsonl`。設定 → 資料顯示實際路徑。每份約 2 MiB，上限兩份。

日誌採 metadata allowlist，只記錄啟動路徑、cwd、PATH 目錄、已允許環境變數的名稱、路由接收者、RPC 方法／ID／耗時／錯誤碼、Session／Turn 狀態、文字長度與程序退出狀態。

**不記錄**聊天內容、prompt、RPC 參數與結果、account 回應、stdout／stderr 原文、環境變數值、API Key、Token 或 Error.message。App 原有的使用者錯誤顯示仍經過 redaction。單元測試用無特定格式的測試秘密驗證 payload／credential 欄位完全被排除，並非只靠金鑰字串格式匹配。

`process.stop(reason=host-dispose)` 後的 `process.exit(status=host-stopped)` 代表 Host 在完成／取消後清理程序；Windows taskkill 的非零 exit code 不代表已成功完成的模型回合失敗。真正任務成功仍要求 native `turn/completed.status=completed`。

## 真實 Windows 打包版驗證

使用 `npm run test:packaged-codex`，透過 Playwright 開啟真正的 `AgentHub.exe`，操作原生專案選擇對話框與聊天室。只指定測試對話框的資料夾回傳值，**沒有 Mock Runtime、Adapter、模型或 IPC send**。

測試流程：

1. 新建獨立 profile 與 Git 測試專案。
2. Electron PATH 刻意只保留 npm、Git、Windows 系統路徑，排除 Codex Desktop 的 bin。
3. 在真實聊天室送出 `@Codex` 訊息；確認缺少 Worktree 的錯誤出現在對話中。
4. 點擊修復按鈕，建立隔離 Worktree。
5. 再從實際輸入框按 Send，要求只回答 `OK`，不使用工具或修改檔案。
6. 確認真正的 Codex 訊息為 `OK`、任務為 completed，並從安全日誌核對 `initialize`、`thread/start`、`turn/start`、`item/agentMessage/delta`、`turn/completed` 全流程。

已驗證的 npm 原生路徑：

```text
%APPDATA%/npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe
```

結果與實際日誌／截圖：`.local/codex-debug/fixed-packaged-report.json`、該報告的 `logPath`、`.local/codex-debug/fixed-packaged-OK.png`。測試只對自建專案與 profile 寫入；不重播既有失敗任務。

## 回歸測試與交付

- TypeScript strict：通過。
- ESLint：通過。
- Vitest：10 個檔案、25 個測試通過，包括原有安全／Git／程序測試及新 launcher／錯誤顯示／安全日誌測試。
- 一般 Electron E2E：2 個通過，包含打包 EXE、安全 Bridge、DPAPI、匯出與重啟持久化。
- 真正打包版 Codex App Server 聊天：通過，收到 `OK`；其獨立報告與最終 build 雜湊見 `CODEX_RUNTIME_BUILD.json`。
- Windows x64 NSIS：`release/0.1.1/AgentHub Setup 0.1.1.exe`。
- 可直接執行：`release/0.1.1/win-unpacked/AgentHub.exe`。

安裝包仍為 unsigned 開發預覽；此修復不宣稱已通過 Claude／Antigravity 的 Live 驗收，也不改變完整規格中的其他已知限制。

## 使用者既有專案的下一步

開啟 v0.1.1，在原專案「變更 → 建立 Git 隔離工作區」，完成後重新送出 `@Codex 請只回答 OK`。專案仍需是有初始 Commit 的 Git 根目錄；沒有時需先明確初始化與審核初始 Commit。未準備好時會顯示可操作的錯誤，不自動降低檔案安全政策。
