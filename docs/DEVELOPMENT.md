# 原始碼、模組與 CI（v0.12.1）

Repository：[ethan222ddd/AgentHub](https://github.com/ethan222ddd/AgentHub)。Windows 建置：[GitHub Actions](https://github.com/ethan222ddd/AgentHub/actions/workflows/windows.yml)。

## 版本控制

原始碼基準為 `50090f7`（v0.12.0），後續維護均以 Git 提交追蹤。僅在這個 Repository 設定提交者 `AgentHub contributors <contributors@agenthub.local>`，未修改全域 Git 設定。可自行把 repo-local 身分改成自己的設定。

`.gitignore` 排除 `release/`、`dist/`、`.local/`、`.native/`、`node_modules/`、測試輸出、SQLite 與 `.env*`。安裝檔、私人維護證據和測試資料留在本機，不進入原始碼歷史。`.gitattributes` 固定文字 LF，圖片以二進位處理。公開原始碼 ZIP 仍採明確白名單，包含 Git 規則，排除 `.git` 與本機憑證／資料。

開發時先確認 `git status`，按完整行為變更提交；不要把生成檔加入 index，也不要用 Force Push 或 Hard Reset 清掉使用者變更。

## 模組邊界

這次以職責拆分，保留原有狀態、DOM 結構、IPC 和安全條件。

- `main/orchestrator/orchestrator.ts`：排程、Agent／工作區鎖、任務佇列、停止與預算協調。
- `main/orchestrator/execute-turn.ts`：一個原生回合的工作區準備、Session、串流、完成與失敗處理。
- `main/orchestrator/collaboration.ts`：結構化協作工具、產物、去重、路由及受控派工。
- `main/orchestrator/approvals.ts`：待批准佇列、批准／拒絕、作用域權限與取消清理。
- `main/orchestrator/reviews.ts`：不可變 Review 快照與指定版本回修。
- `renderer/App.tsx`：頁面協調、目前聊天與編輯草稿。`hooks/useWorkspaceEvents.ts` 管理 IPC 訂閱、批次串流／更新、通知導航及主題同步。
- `renderer/features/chat/`：Sidebar、WorkspaceHeader、MessageList、ChatComposer。送出時的選取版本檢查仍由頁面維持，沒有把私人 Runtime 狀態移到 Renderer。
- `renderer/features/settings/`：General、Agent、Collaboration、Security、Data、Diagnostics。設定草稿與統一儲存仍由 Settings 容器持有，切換區塊不會重設尚未儲存的欄位。
- `renderer/features/panels/`：ActivityPanel 與 ChangesPanel，暫存 Diff／預覽仍由 SidePanel 容器維持。
- `renderer/features/workflows/`：TemplateDesigner 與 WorkflowRunPanel；範本草稿、角色綁定與流程操作仍由 WorkflowEditor 容器協調。
- `renderer/styles/`：模型、主題、額度、工作區、訊息、輸入區、Markdown、活動、對話框與響應式規則。入口 `styles.css` 按原本順序匯入；323 個頂層 CSS 規則的順序與內容已比對，沒有重排 cascade。

沒有把每個長檔案硬切成相同行數。`git/automatic.ts` 的安全快照／測試／整合、`workflows/service.ts` 的狀態機、各供應商協定與中央 IPC allowlist 暫時保留完整職責，避免跨模組隱藏狀態或破壞審核邊界。

## 測試隔離

Git 根目錄建立後，原本位於 `.local` 的空資料夾會繼承父 Repository，正確觸發產品的拒絕巢狀初始化政策。測試專案因此改用 Repository 外的專屬 TEMP 目錄；先以 realpath 正規化 Windows 短檔名，避免被當成重新導向路徑。沒有放寬產品路徑或 Git 根目錄檢查。

測試結束先回收受管程序，再清除具有固定前綴且確認位於 TMP 下的專屬目錄。Electron 透過 worker fixture 執行相同清理。Source 內 `.local` 僅保存忽略追蹤的報告和診斷。

本機沙盒的 TEMP 可能過長，使 Git 的 worktree 內部路徑超出限制；Windows 原生整合測試應使用一般 Windows 測試程序與正常 TEMP，不能以放寬安全檢查繞過問題。

## CI

Windows workflow 由 push、PR 或 workflow_dispatch 觸發，執行鎖定依賴安裝、官方 Electron 安裝腳本、Typecheck、ESLint、生成檔追蹤檢查、免付費單元／整合測試、NSIS／Portable 打包及 Electron E2E。套件內的 `electron/install.js` 取代原本可能抓取其他套件的 `npm exec install-electron`。

只給 `contents: read`；checkout 不持久化認證。相同分支新提交取消過期建置。成功產物保留七天，失敗會保留測試診斷；沒有把本機帳號、API Key 或訂閱憑證加入 CI。付費三家 Live 仍是另外明確執行的本機指令。

本次本機範圍：Typecheck、ESLint、Build、5 個相關測試檔 34 項，以及 Electron 7 項通過／1 項因未先本機打包而略過。遠端 CI 會完整執行免付費 suite 並在打包後執行該案例；最終是否成功以 Actions 的實際 run 與 SHA 為準，不能拿本機結果當成遠端成功。

官方 Action 版本核對：[checkout](https://github.com/actions/checkout/releases/latest)、[setup-node](https://github.com/actions/setup-node/releases/latest)、[upload-artifact](https://github.com/actions/upload-artifact/releases/latest)。
