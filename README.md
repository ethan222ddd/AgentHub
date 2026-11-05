# AgentHub

本機優先、以聊天室為中心的多代理協作開發桌面應用。Electron、React、TypeScript strict、SQLite，MIT 開源授權。

[GitHub 原始碼](https://github.com/ethan222ddd/AgentHub) · [Windows CI／安裝包](https://github.com/ethan222ddd/AgentHub/actions/workflows/windows.yml) · [開發與模組指南](docs/DEVELOPMENT.md)

**v0.12.1：工程維護。** 建立 Git 基準與原始碼追蹤，拆分排程／回合／協作／批准／審查、聊天室、設定、活動面板、範本頁與 CSS。沿用原有功能與權限政策；生成檔和本機維護資料保持忽略追蹤。

首次使用請讀 [繁體中文使用手冊](docs/USER_GUIDE.zh-TW.md)／[離線 HTML 手冊](docs/USER_GUIDE.html)。目前距離正式版尚缺的功能與驗收見 [發佈準備清單](docs/RELEASE_READINESS.md)。

**v0.12.0：可自訂工作流程範本。** 聊天室「流程」可選擇、增加、修改、複製與刪除範本，設定角色、先決步驟、不可變產物交接、審查與有界回修。內建「Codex 實作 → Claude 審查」及「AGY 契約 → 平行實作 → 交叉審查」，通過既有指定版本審查、測試與安全 gate 才整合。詳見 [流程使用手冊](docs/WORKFLOW_TEMPLATES.md)。本次只驗證相關流程，不重跑付費代理全套。

**v0.11.0：Windows 通知與工作列提醒。** 新批准、完成／失敗、整合待處理會通知；點擊開啟對應聊天室與活動。設定 → 一般可選勿擾或只通知批准，工作列仍保留待處理數。詳見 [使用與驗證範圍](docs/NOTIFICATIONS.md)。本次只跑通知相關測試，未重跑付費代理全套驗收。

**v0.10.0：審查完整性與候選版驗收。** 審查結論必須由結構化工具提交且 Runtime 成功完成，才能成為指定 Reviewer 對確切版本的批准。較新的退件／失敗會取代舊批准；缺少審查者時停止自動整合。聊天室非同步初始化、發送及更新會尊重最新選取。詳見 [本階段實作](docs/RELEASE_CANDIDATE.md)。

保留原有 [Windows 程序守護與異常復原](docs/PROCESS_LIFECYCLE.md)、[AGY Host 讀取橋接](docs/AGY_HOST_READS.md) 與 [自動專案流程](docs/AUTOMATIC_PROJECTS.md)。

## Windows 安裝與執行

聊天室已加入[剩餘額度](docs/QUOTAS.md)：Codex／Claude 原生訂閱額度、重置時間及前景自動更新；AGY headless 目前無可驗證的額度查詢，明確提示使用官方 `/usage`，不顯示推算值。

安裝程式：`release/0.12.1/AgentHub Setup 0.12.1.exe`。免安裝版：`release/0.12.1/AgentHub-0.12.1-portable.exe`。

平常使用安裝版或 Portable。開發用解壓版可執行 `npm run package:dir` 重新建立，再開啟 `release/0.12.1/win-unpacked/AgentHub.exe`。Portable 預設資料在執行檔旁 `AgentHubData`，安裝版使用 Electron 使用者資料目錄；實際位置在設定顯示。安裝包尚未簽章。卸載不刪除聊天資料與使用者專案。使用 Schema 8，可遷移讀取舊資料，舊版 App 不可開啟新版資料庫；升級前先備份。Portable 採 electron-builder 官方 ZIP payload；體積包含 Electron 與執行所需元件。

原始碼需要 Node.js 24、npm、Git；Windows 守護器以系統 .NET Framework 4.x 的 Framework64 csc.exe 自動編譯：

```powershell
npm ci
npm run dev
```

```powershell
npm run check
npm run package:win
```

額度唯讀實測：`npm run test:live-quota`。公開原始碼封裝：在允許本機腳本的 PowerShell 工作階段執行 `& .\scripts\source-archive.ps1`，以明確白名單排除本機資料與憑證；產物位於相同版本的 release 目錄，不需更改全域執行政策。

每個版本分別輸出至 `release/<version>`，避免覆蓋正在執行的舊版。Windows CI 執行不依賴付費帳號的測試與打包，成功後可從 Actions 下載安裝包；本機也可自行執行打包指令。

2026-11-02 已清除舊安裝包、重複解壓版與測試暫存，保留最新版交付及歷史原始碼 ZIP。維護證據已壓縮保留，重建與還原方式見 [工作區清理紀錄](docs/CLEANUP.md)。

## 第一個實際協作流程

1. 先在官方 CLI 完成 Codex／Claude Code／Antigravity 登入，再於「設定 → 代理」確認連線與啟用成員。
2. 選擇專用專案資料夾。空白／沒有 Git 或沒有 Commit 時，自動建立安全初始快照；既有正常 Repository 直接重用。一般原始碼會出現在 Agent 工作區，敏感／不明內容會排除或要求 App 內確認。
3. 新聊天室預設選擇團隊，直接輸入需求；`@Codex` 等可只指派一位，「僅儲存筆記」則不啟動 Agent。不需要任何 Git 指令或 Worktree 準備按鈕。
4. 檢視必要的原生工具批准。Agent 完成後，Host 檢查、測試確切整合快照，在沒有衝突或未處理使用者修改時自動整合回原資料夾。以 Host 整合結果為準，不能只看 Agent 說完成。
5. 遇到 attention，查看原因及 Diff，處理後「重新嘗試整合（不重跑 Agent）」。工作區與未完成修改保留，重啟不需重建；不會自動 Push、Hard Reset 或強制刪除 Worktree。

自動可執行測試使用官方 Codex `command/exec` 沙盒（無模型回合）；缺少沙盒、測試入口、私有依賴設定或敏感／不明內容時，明確停止自動整合。純靜態網站使用明示的基本檢查，不冒稱功能測試。完整操作與例外處理見使用手冊。

## 進階手動模式

「變更」可查看分支、路徑、Diff、未整合修改與 Git 操作紀錄。只有關閉「自動管理與測試整合」或需要進階處理時，才使用以下流程；不是一般開發的必要準備。

1. 選擇專案根目錄。非 Git 專案可明確批准初始化，再於「變更 → 審核初始 Git Commit」檢查忽略規則、選擇檔案並提交。
2. 「設定 → 代理」偵測 Runtime、選模型與啟用成員。Claude 預設為本機官方 CLI；自行登入的 Claude Code 訂閱可透過該未修改 CLI 使用，不需要提供 API Key。
3. 「團隊」設定本專案成員、角色和指示；角色不授予額外系統權限。
4. 「變更 → 建立 Git 隔離工作區」。每個成員取得自己的分支與 Worktree；原專案未提交的檔案不會自動複製過去。
5. 用 `@Codex`、`@Claude`、`@Antigravity`、`@All` 或接收者選單派工。手動模式未指定接收者時只保存筆記；跨代理啟動需要批准。協作與主管模式仍遵守預算、回合數、深度、fanout、並發及逾時限制。
6. 在活動抽屜檢查任務、工具、錯誤及批准。Stop 取消排程並終止程序；Resume 不自動重播先前有副作用的工作。
7. 檢查 Diff 與未追蹤檔案後建立 Checkpoint。代理可用 `publish_artifact` 發布已提交契約；三家均可取得 `read_artifact` 的確切 Commit 文字與 SHA-256。AGY 使用同一原生 Session 的有界下一回合取得結果，並非直接注入 MCP；讀取不會偷偷同步分支。
8. 在審查抽屜請另一位成員審查確切 Commit 的唯讀快照。評論包含檔案、行號、嚴重性，可標為已處理、請求修正或重新審查。
9. 產生合併預覽，在**該整合快照**通過測試後，明確批准合併。App 重查來源、目標、快照、乾淨狀態與最終樹；舊 Worktree 的測試不會通過合併 gate。
10. 其他成員透過「同步主專案預覽」取得整合內容。回滾使用新的 Revert Commit、預覽、測試與批准，不執行 Hard Reset。

## 真實 Runtime

**Codex**：本機 `codex app-server`，stdio JSON-RPC。Windows npm shim 只用於定位套件，實際啟動原生 `codex.exe`，`shell:false`。支援 Thread create/resume、串流、工具、批准、取消、帳號狀態與動態模型列表；不讀取登入 Token。詳見 [Windows 修復紀錄](docs/CODEX_RUNTIME_FIX.md)。

**Claude Code**：預設啟動本機未修改的官方 `claude.exe`，由 CLI 自己管理登入、訂閱與限額。需要 **2.1.295+** 的 fail-closed HTTP hooks；本次驗證 2.1.296。使用 `--restricted`，工具經 Host 邊界檢查與批准。獨立的 Agent SDK/API 模式仍可選用，API Key 只在本機透過 Windows DPAPI 保存，不會取得或轉存訂閱 OAuth Token。切換原生/API 模式時建立新對話。參考 [官方 CLI 產品使用條件](https://code.claude.com/docs/en/legal-and-compliance)與 [SDK 說明](https://code.claude.com/docs/en/agent-sdk/overview)。

**Antigravity**：真正 `agy`、NDJSON、原生 Conversation ID/resume、Sandbox 與官方 JSON Schema。先在官方互動 CLI 登入。模型從 `agy models` 取得，不寫死名稱。每回合明確批准工作區存取；額外 Shell 指令須先在設定列出確切指令，回合開始仍請求批准，沒有略過全部權限。未授權操作在 Headless 中拒絕並顯示失敗；唯讀 Review 拒絕寫入與指令。可恢復的檔案不存在錯誤顯示於工具紀錄，不會假稱為權限拒絕。公開文字於結構驗證後顯示，目前不逐 Token 顯示原始路由 JSON。參考 [官方 Headless 協定](https://antigravity.google/docs/cli/headless/)。

## 資料、安全與復原

- SQLite Migration 保存專案、對話、原生 Session ID、任務、Review、契約、用量、權限與合併預覽。
- 重啟後未完成任務等待人工檢查，不自動執行；原生 Session 檔案仍由各供應商管理。
- 訊息分頁、全對話搜尋、虛擬捲動；最多 24k 字元增量背景、可追蹤來源的摘錄摘要與詞彙相關參考。這不是模型產生的語意摘要。
- 還原有完整性／Schema 檢查、預覽、還原前備份及重啟套用。SQLite 備份不含專案 Worktree、供應商 Session 檔案及 DPAPI 金鑰。
- Renderer 無 Node 權限；context isolation、Renderer sandbox、IPC allowlist、Zod、發送者與來源檢查。
- Host 驗證絕對路徑、符號連結及工作區邊界。只有讀取工具可記住指定工作區授權，能隨時撤銷；Shell 不記住授權。
- 診斷 JSONL 只存啟動方式、路徑、ID、RPC 階段、狀態與錯誤碼，不保存 Prompt、回覆及驗證憑證。活動文字盡力遮蔽敏感值，仍應避免把秘密放進聊天。
- 預算依 Runtime 已回報值執行，通知可能延後；缺少的美元費用不會捏造成零。Claude CLI 的 USD 是估計值，不代表另一次 API 扣款。

## 測試

```powershell
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run package:win
```

以下會使用真實帳號額度，只在需要 Live 驗收時執行：

```powershell
$env:AGENTHUB_LIVE_RUN='1'
npm run test:live
npm run test:live-collaboration
npm run test:live-coding
npm run test:packaged-codex
npm run test:packaged-team
npm run test:live-images -- --packaged
npm run test:live-web
npm run test:live-recovery
npm run test:live-models-context
npm run test:live-automatic
npm run test:live-agy-host
npm run test:live-lifecycle
```

Live 腳本只建立 `.local` 內的一次性專案；不要求在聊天貼上憑證。`scripts/installer-roundtrip.ps1` 為額外的明確安裝測試，會拒絕覆蓋既有 AgentHub 安裝。

真正 Portable 啟動／資料位置／筆記重啟檢查：`npx tsx scripts/portable-smoke.ts`（先完成 Windows 打包；不發送模型回合）。

## 已知限制

驗證主機為 Windows 11 build 26300，未宣稱所有 Windows 10/11 組態均已測試。Antigravity Sandbox 需要 Windows 11 24H2 及官方指定更新，較舊 Windows 拒絕該 Adapter。Claude SDK/API 模式合約測試通過，本次未使用 API Key 做付費 Live；已驗證的是本機訂閱 CLI。

圖片支援靜態 PNG/JPEG/WebP，最多 4 張、單張 5 MiB、每邊 4096px、8MP，整批附件最多 12 MiB。三家都有原生圖片流程；Antigravity 以自己的影像讀檔工具讀取工作區內暫存原檔，沒有冒用 Gemini API。JSON/Markdown 匯出含原檔，超過 32 MiB 請用 SQLite 備份。工具、Shell 與聯網的能力和批准差異見 [原生能力](docs/CAPABILITIES.md)，圖片限制見 [圖片附件](docs/IMAGES.md)。

尚無程式碼簽章、自動更新、完整供應商版本相容矩陣及獨立第三方安全稽核。Production audit 目前為 0；開發工具鏈有 minimatch 的 25 項衍生 moderate advisories，未用可能破壞舊 API 的強制更新掩蓋。後續工作見 [IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md)。
