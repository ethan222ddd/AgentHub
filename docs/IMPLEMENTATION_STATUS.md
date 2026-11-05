# Implementation status — v0.12.1

## 本輪：協作與交付工具（2026-11-05，分支 feat/collab-workflow）

新增六項功能，各自一個 commit：先提計畫的唯讀計畫關卡（`submit_plan`）、結構化交接摘要（`submit_handoff`）、專案決策紀錄（`propose_decision`，存在專案紀錄上）、平行工作區的檔案衝突預警（唯讀 Git 掃描）、Diff 行內意見（以訊息送給工作區代理，不是 Review 紀錄），以及透過使用者自己登入的 gh 匯入 Issue、開 PR 與 CI 失敗回饋。Schema 8 不變，沒有新增 Migration。

安全邊界：計畫階段以各家原生唯讀模式執行，若改到 HEAD 或工作樹就判定失敗，期間也拒絕派工；Issue、CI 紀錄與其他代理的交接都包在標示為不可信的區塊。推送只建立新的 `agenthub/...` 分支或快轉推送既有 PR 分支，不使用 force、不合併，每次網路寫入都需要使用者點擊。使用者的 Diff 意見不會成為或取代整合關卡中的審查批准。

驗收：Typecheck／ESLint 通過；36 個測試檔共 192 項通過，其中新增計畫關卡、交接、決策、衝突、Diff 意見與 GitHub（假 gh 加本機 bare 遠端，實際推送）測試；Electron E2E 13 項全部通過，包含新的協作流程案例，以及重建解壓版後的打包 EXE 案例。沒有執行三家付費代理的 Live 驗收，也沒有對真實 GitHub 開 PR；GitHub 的實際網路路徑只在 Issues 對話框讀取過登入與遠端狀態。

上一輪（同日）另加入任務依賴圖／看板、用量與花費趨勢、鍵盤批准佇列與 UI 改善，見 PR #1。

## 本輪：Git、模組拆分與 Windows CI（2026-11-05）

建立 `main` 與原始碼基準 `50090f7`，忽略安裝包、生成目錄、本機維護證據和資料庫。指定遠端為 ethan222ddd/AgentHub。拆分回合執行、結構化協作、批准與審查模組，並把聊天室、設定、活動／變更、範本介面與樣式分成獨立模組；容器保留原有狀態與協調，沒有變更 Runtime、Schema 或權限政策。

入口檔行數（含空行）：Orchestrator 1329→687、App 1238→598、Settings 883→182、SidePanel 849→198、WorkflowEditor 699→189、styles.css 1943→11。CSS 的 323 個頂層規則按原順序保留。未硬拆仍具單一職責的 Git 整合、供應商協定與 IPC allowlist。模組地圖與具體原因見 DEVELOPMENT。

新增 Repository 外、正規化路徑的測試 TEMP 及清理，避免測試空資料夾繼承本專案 Git。保持產品拒絕巢狀 Repository／重新導向路徑的政策。修正 CI 的 Electron 安裝指令，加入原始碼追蹤檢查、分支建置去重、Portable 上傳及失敗診斷。

原始碼已推送至 [GitHub](https://github.com/ethan222ddd/AgentHub)。本機 Typecheck／ESLint／Build、34 項相關測試及 7 項 Electron E2E 通過；另 1 項本機未先打包的案例略過，已由遠端打包後實際執行。

Windows [CI run 41943842088](https://github.com/ethan222ddd/AgentHub/actions/runs/41943842088) 全部成功，驗證程式碼 SHA `07da02579301a2e045daf75bca8df1ffd240ca0c`：27 個測試檔／161 項離線測試、11 項 Electron E2E（含打包 EXE）、Typecheck、ESLint、原始碼追蹤檢查與兩種 Windows 打包均通過。提供 [NSIS／Portable Artifact](https://github.com/ethan222ddd/AgentHub/actions/runs/41943842088/artifacts/13377538391) 及 [JSON 報告](https://github.com/ethan222ddd/AgentHub/actions/runs/41943842088/artifacts/13377294132)，保留至 2026-11-12；沒有重跑付費 Live。

根據前兩次 CI 實際失敗修正歷史 Schema 測試、額度欄位比對及 Windows 流程測試期限；相關本機 14＋1 項通過。打包明確使用 `--publish never`，排除無意自動發佈 Release 而要求 Token 的失敗，CI 維持唯讀權限。未放寬產品權限或改成跳過失敗案例。清理本輪 12 個生成測試 Profile，釋放約 127 MB；小型維護證據保存在忽略追蹤的 `.local/maintenance-evidence-v0.12.1.zip`。

以下保留 v0.12.0 歷史紀錄。

## 本輪：可編輯工作流程範本（2026-11-05）

已接入本機範本 CRUD／複製、角色綁定、依賴 DAG、平行任務、嚴格的 publish_artifact 交接、原生 Adapter 排程、唯讀結構化 Review、按來源有界回修／重新審查、確切來源版本和現有測試／合併 gate。流程中實作只保存 staged 快照，不再早於範本審查自動整合。流程保存不可變範本副本，可暫停／取消／檢查後繼續，重啟不重播。步驟與進度留在聊天／活動介面，不新增大型看板。

Migration 8 增加範本與流程表、備份及恢復支援，舊版拒絕打開此新 Schema。內建流程只遷移種入一次；修改、刪除不影響執行中的副本。任務依賴、Agent／工作區鎖、用量預算、原生工具權限和全域 Review gate 保留；範本不能任意執行 Shell 或額外啟動範本外 Agent。停止期間 capture 結束後再次檢查取消，避免重新進入 Runtime。

驗證採本次範圍：Fixture Adapter 配真實 Git／Worktree／SQLite／產物與確切快照測試，並以單一 Electron E2E 驗證 CRUD、角色／步驟編輯、錯誤與重啟。沒有把 Fixture 當成三家真實 Runtime 驗收，未重跑付費 Live／全套。最終數量、打包版 E2E 和交付雜湊見 release/0.12.0/WORKFLOW_VALIDATION.json。詳細修改檔案、操作及邊界見 WORKFLOW_TEMPLATES。

仍非完整 v1.0；本輪不處理乾淨 VM／完整 OS Shell 隔離／簽章及公開發行等缺口。多份整合為逐份測試合併，後一份失敗時保留前一份成果，不進行破壞性回滾。

以下保留 v0.11.0 歷史紀錄。

## 本輪：Windows 系統通知與工作列提醒（2026-11-04）

完成批准／任務完成／失敗／整合待處理通知、點擊恢復視窗及切換聊天室與活動面板、工作列按任務去重的數量、勿擾／只通知批准與手動測試通知。主程序根據真實狀態轉換通知，不解析代理文字；不補發歷史通知，原生錯誤不改變任務結果。通知採通用文案，診斷不記 Prompt／命令／憑證。啟動導航採 Renderer ready 佇列，初始對話還原不得覆蓋通知導航。沿用 Schema 7，舊設定預設全部通知。詳細修改檔案、數量與已讀語意見 NOTIFICATIONS。

依使用者要求只做本次範圍驗證：4 個相關測試檔共 22 項通過，包含通知控制器、原生 OS 介面替身、聊天室導航及 SQLite 設定；Typecheck 與修改檔案 ESLint 通過。單一通知 Electron E2E 通過（只有 OS 投遞端受控，實際 IPC／SQLite／Renderer／視窗恢復）。最終打包 API 煙霧與交付狀態見 release/0.11.0/NOTIFICATION_VALIDATION.json，不沿用舊二進位測試冒充新版驗收；未重跑整套或三家付費 Live。

Windows 勿擾、通知權限及小型工作列設定仍可能抑制顯示；未新增 Tray 背景常駐。此階段沒有處理既有正式版缺口（乾淨 VM、完整 Shell 隔離矩陣、簽章及公開發行等）。

以下保留 v0.10.0 歷史紀錄。

## 本輪：審查完整性與候選版真實驗收（2026-11-04）

完成結構化 Review 必填／成功回合驗證、指定 Reviewer 與最新同版本結論的自動整合 gate、未指定及同 Agent 審查不得跳過、可見自動審查錯誤、重試嘗試關聯、原生契約讀取 metadata；新增聊天室選取版本與訊息回覆順序保護。取消程序會主動關閉 Host stdio，避免初始化／額度讀取等待管線 EOF；另提供有界、明示不可信的確切 Review 檔案清單，保留原生唯讀／禁止 Shell。

新增 shared/reviews、navigation／review-policy／shutdown 測試，擴充 workflows／automatic-projects 與 Electron navigation；新增真實打包跨代理 coding／artifact／AGY review／精確測試／合併與實際安裝升級／Session 驗收腳本。Manifest 已改為只接受此候選版的 12 份報告，同時驗證外部守護器、Installer／Portable 與 v0.9.0 升級基準，不再拿早期 coding／installer 報告通過本版 gate。Schema 7 不變。

最終 Typecheck／Lint、24 files／134 tests、9 Electron E2E 通過，額外三輪關閉／重啟 6 項檢查通過。真正候選版的 Codex→Claude 指派／契約、兩份 AGY 唯讀 Review、精確快照測試／合併與主專案測試已驗證。Live harness 截圖遇到重複按鈕後，透過相同二進位、原始持久化資料與重新執行主專案測試補齊證據，保存錯誤與核對路徑，未重播或偽造代理工作。

真正 NSIS 的 v0.9.0→v0.10.0 安裝／升級／卸載已成功；舊聊天、深色設定與原生 Codex Session 保留，升級前後實際 OK，不自動重播。測試安裝已移除。12 份同 App／守護器報告均通過 Manifest 核對，包含實際 Portable 啟動與無模型回合的官方額度前景刷新。NSIS／Portable／原始碼與離線手冊已產生。Production audit 0；dev graph 25 moderate。保留精簡維護證據、歷史原始碼與最新交付，清理大型生成資料；詳見 RELEASE_CANDIDATE／CLEANUP。

尚需乾淨 Windows VM／完整 Shell 權限與磁碟故障／壓力矩陣、dev 相依相容修復、簽章及正式發行。AGY 官方 headless 額度與公開增量文字仍依上游能力；不能標為完整 v1.0。

以下保留 v0.9.0 歷史紀錄。

## 本輪：Windows 程序生命週期與故障復原（2026-11-01）

完成 Windows 原生 Job 守護器、App keeper、暫停建立／歸屬後執行、實際父 PID＋建立時間驗證、最小 handle 繼承、中央 ProcessSupervisor、SDK spawn hook、關閉 gate／排空、JSON-RPC terminal／逾時／有界 NDJSON、唯讀程序 IPC 及設定診斷 UI。保留原生權限，沒有 shell 包裝或啟動後掃描並殺其他程序。Schema 7 不變。

真實打包版已驗證 Main／Codex Runtime 強制終止、WIP、重啟不重播、失敗可見與原生 Claude 仍回答 OK，以及 metadata 中關閉／Renderer 崩潰。6 項 OS 程序歸屬測試、Unicode argv/stdin、錯誤父建立時間與冪等停止通過。補充協定失敗／額度關閉測試。回歸發現初始 loadURL 因關閉中止時，被啟動 catch 當成錯誤開啟阻塞視窗；已修正，四次初始渲染期間關閉／重開 E2E 通過。Test teardown 回收失敗案例子程序，Git 密集整合案例依新增原生啟動成本配置 60 秒，原斷言不變。

正式測試總數、所有最終 EXE Live 回歸、NSIS／Portable／原始碼與 SHA，以 VALIDATION／BUILD_MANIFEST 的最終結果為準；不沿用前一 app.asar 的報告。外部守護器也納入證據 SHA。新增／修改檔案與邊界詳見 PROCESS_LIFECYCLE。

最終 Typecheck／Lint、21 files／121 tests、8 Electron E2E、production audit 0 已通過。10 份最終打包報告（含八份原生功能／故障、額度與真正 Portable）均成功，Manifest 嚴格核對同一 app.asar 與外部守護器雜湊；額度驗證前景自動刷新且無模型回合。NSIS x64、Portable、離線手冊已產生，原始碼白名單封裝與 SHA 見 release/0.9.0。沒有以舊版雜湊或只印 PASS 而未退出的程序當成完成。

下一階段依 RELEASE_READINESS：完整候選版跨代理 coding→review→精確測試→合併及安裝升級 roundtrip、乾淨 Windows VM／Shell 隔離／磁碟故障矩陣、dev 相依修復、簽章與正式發行。AGY 公開增量文字／headless 額度仍受官方能力限制。Job 是生命週期管理，不是檔案／網路沙盒；本版不宣稱完整 v1.0。

以下保留 v0.8.0 歷史紀錄。

## 本輪：Antigravity Host 讀取結果續接（2026-11-01）

已實作同一官方 agy 程序／Session 的三次有界 Host 結果續接：search_context、read_context、read_artifact，唯讀批次與最終其他操作分離；原生 num_turns／Conversation ID、重複快取／批次上限／取消／退出保護。新增可選 Task.nativeTurns，額外提示計入 correlation 的共享回合預算，並保留 cumulative 用量差額及原生 Sandbox／權限；沿用 Schema 7。活動帶請求 ID／Task／Session／原生回合，只公開最後答案。

另外修正執行中只顯示 Stop 而隱藏 Send 的 UI，現在可以並列發送補充資料，不中斷現有工作。Portable 採已安裝 electron-builder 支援的 ZIP payload，避免加入 elevation helper 時再次壓縮完整 LZMA；實際大小與啟動驗收見最終 Manifest。

官方 CLI 1.4.12 真實兩回合未知 Host 碼傳遞探針，以及最終打包版三項讀取、四原生提示、來源 ID／Commit 記錄、續接中停止與重啟不重播已成功。Typecheck／Lint、110 tests／7 Electron E2E 通過。既有回歸／發行產物的完整結果以 VALIDATION、BUILD_MANIFEST 為準，不沿用 v0.7 二進位證據。新增／修改檔案及安全語意見 AGY_HOST_READS。

最終同一 app.asar 的三家圖片、模型／思考強度、長背景、三家聯網、自動隔離改檔與測試整合、明確恢復／依賴、三家 OK 已重新通過並正常退出。額度／Portable 與 NSIS／原始碼交付由 release manifest 另外核對，不能只因先印 PASS 就開始重建未退出的 EXE。

後續仍需 AGY 上游公開增量文字／額度介面、Windows 與硬崩潰／Shell 隔離矩陣、dev 相依修復、最終候選版 peer-review 與安裝升級 roundtrip、簽章與正式發佈；不將本版標為完整 v1.0。

以下為 v0.7.0 歷史紀錄。

## 本輪：全自動專案初始化與 Worktree 管理（2026-11-01）

使用者新增規格：選擇空白／既有來源資料夾後直接派工，不再要求手動 Git／Worktree；安全條件下自動測試並整合回原資料夾。已接入 AutomaticProjects、白名單／內容檢查的安全快照與 alternate index、按需 Worktree、持久化重用／搬移和缺失恢復、分支碰撞重試、工作區同步、保護既有 WIP、整合狀態與不重跑 Agent 的重試、主要資料夾安全快照、Git 操作紀錄。Migration 7 防止舊 App 重播已完成 Agent 的待整合工作。原生權限與 Sandbox 保留。

自動 npm 測試改走官方 Codex App Server command/exec，不產生模型回合；native Windows sandbox 已實測 ready，允許工作目錄內寫入、拒絕外部測試檔寫入 EPERM，真正 npm test 也已通過。沒有可用沙盒／私人 npm 設定／未審核依賴來源時明確停止自動執行，不降級為未沙盒執行。靜態 HTML/CSS 路徑有明確標示的基本檢查，不能冒稱功能測試。本機沙盒拒絕巢狀 Node 子程序，生成驗收使用 Node 24 in-process test，保留 OS 沙盒；不改寫使用者測試。

已新增並更新 18 章繁中使用手冊、離線 HTML 與發佈缺口清單，完成 Edge headless 桌面／窄版與章節連結檢查。NSIS 與真正 Portable 均配置於 release/0.7.0，手冊可從設定 → 資料開啟。Portable 資料預設放在旁邊的 AgentHubData；產物與最終啟動驗收以 BUILD_MANIFEST 為準。

最終修復版本：Typecheck／ESLint、19 files／94 tests、7 Electron E2E 通過。真正 EXE 的 Codex Hello World（原資料夾＋Edge 呈現）、Claude 既有來源讀取／原檔保留、三家平行改檔／四份精確沙盒測試整合、重啟工作區映射／WIP 保留已通過。模型／背景、三家不同圖片、網路、明確手動復原、三家聊天室 OK、官方額度前景刷新也已用同一 app.asar 通過。Production audit 0，dev graph 25 moderate。各證據及雜湊見 VALIDATION／BUILD_MANIFEST。

真實驗收發現並修復同一 Agent 第二回合的主分支同步錯誤：先前把已整合的主分支版本當成 Agent 分支已包含；現在檢查實際 HEAD／祖先關係，連舊 metadata 也重新驗證。六回合驗收曾正確碰到本機 200k 預算，保留失敗報告，只把一次性 Profile 改為 1m 後完成；正式限制不變。

下一階段：依 RELEASE_READINESS 補 AGY Host 讀取結果有界續接、真增量串流／官方額度介面（受上游限制）、Windows／程序故障與 Shell 隔離矩陣、dev 依賴相容修復、候選版完整 peer-review／installer roundtrip、簽章及發行。這次自動流程與手冊交付不代表原始完整 v1.0 所有項目皆已驗收。

主要新增：`main/git/automatic.ts`、`safe-snapshot.ts`、`main/tasks/sandbox.ts`、`tests/automatic-projects.test.ts`、`tests/fixtures/command-sandbox.mjs`、`tests/e2e/automatic-projects.spec.ts`、`scripts/live-automatic.ts`、`scripts/build-user-guide.ts`、`docs/USER_GUIDE.zh-TW.md`／HTML、`RELEASE_READINESS.md`。另修改 Workspaces、Orchestrator、TestRunner、Store/Backup/Migration、IPC/Schema/types/tasks、Main、App/SidePanel/Settings/styles、既有 E2E、package/version。

以下為 0.6.1 已驗證歷史紀錄；以上述 0.7 尚待項為準。

## 新增：帳號剩餘額度

已加入聊天區額度面板、前景 45 秒刷新、回合後／手動刷新、Main 快取與查詢合併、過期與失敗提示。Codex 官方 App Server RPC 與 Claude CLI get_usage 已在本機真正取得剩餘比例／重置時間，不發送模型回合或讀取憑證。Claude API-key 帳務不混用訂閱額度。AGY 1.4.12 headless idle 與真實 OK 回合皆未觸發官方 statusLine，沒有支援的查詢介面可驗證，顯示未提供。詳見 QUOTAS。

新增／修改：`shared/quota.ts`、`main/agents/quota.ts`、`quota-service.ts`、`claude-control.ts`、`adapter.ts`、`codex.ts`、`claude-native.ts`、`claude.ts`、`antigravity.ts`、`shared/schemas.ts`、`ipc/handlers.ts`、`renderer/features/QuotaControl.tsx`、`ModelControl.tsx`、`App.tsx`、`styles.css`、`tests/quota.test.ts`、`e2e/quota.spec.ts`、`adapters.test.ts`、協定 fixture、`scripts/live-quota.ts`、兩個只讀 quota 探針、套件／發行腳本及文件。

發行驗證另修正 `scripts/live-images.ts` 支援明確的 `--packaged` 開關，補跑真正 EXE；`scripts/source-archive.ps1` 以白名單建立可重現的公開原始碼封裝。沒有以開發版圖片報告或舊雜湊通過驗收。

同時修正模型 catalog 載入完成前輸入元件被替換的競態。AGY post-turn structured bridge 目前不能將 Host read_context/search_context/read_artifact 結果送回同一原生回合，已改為明確失敗與能力限制，避免執行後靜默丟棄。Codex／Claude inline MCP 來源工具與三家自動背景傳遞可用；AGY inline read 結果交付及額度機器介面仍待下一階段。

最終 v0.6.1 的 Typecheck、Lint、74 tests、6 Electron E2E、NSIS x64 打包通過。同一 EXE 的六項真正 Live（模型／背景、額度前景刷新、三家圖片、三家網路、Session 復原、三家聊天室 OK）通過；Manifest 檢查 app.asar 雜湊一致。舊版 0.6.0 輸出目錄遇到 Windows EBUSY，沒有終止不明程序或刪除使用者資料，改用獨立 0.6.1 輸出。原始碼白名單封裝不包含 .local／憑證／已安裝 Runtime。

後續接續：優先實作 AGY 有界的原生回合續接以送回 Host 讀取結果，並追蹤官方 headless 額度介面；補齊 Windows 10/11 與強制終止／metadata 查詢中退出的程序生命週期矩陣，再處理 minimatch 開發依賴、簽章及獨立安全稽核。目前仍不是完整 v1.0。

## 本階段：聊天室模型／思考強度，以及長對話背景

輸入框底部可直接選 Codex、Claude Code、Antigravity 的模型與各自思考強度。Codex model/list 回傳每模型努力級別；Claude native 透過官方 control initialize 回傳 Opus/Sonnet/Fable/Haiku 等選項，不保留 account 欄位；Antigravity 由 agy models 回傳 Argon/3.8 Flash 等實際清單。設定只在本聊天室使用、送出時保存到 Task，真正傳入官方 Runtime，沒有用提示詞假裝換模型。

Migration 6 建立 FTS5＋繁中雙字詞、重要訊息釘選、有來源與字元上限的背景、Host 搜尋／讀取來源工具、背景紀錄面板，並改用完成序列解決平行串流較晚完成的訊息漏送。升級只重設共享背景游標，不重播任務。私有原生 Session 與共享訊息維持分離。詳見 MODELS_AND_CONTEXT。

修改／新增：`shared/types.ts`、`shared/schemas.ts`、`main/orchestrator/context.ts`、`orchestrator.ts`、`database/store.ts`、`backup.ts`、`ipc/handlers.ts`、三家 adapters、`agents/claude-catalog.ts`、`agents/adapter.ts`、`renderer/features/ModelControl.tsx`、`ContextPanel.tsx`、`SidePanel.tsx`、`renderer/App.tsx`、`stores/workspace.ts`、`styles.css`；`tests/context.test.ts`、`claude-catalog.test.ts`、其他 adapter/SDK/orchestrator/store/migration tests、`tests/e2e/models-context.spec.ts`、協定 fixture；`scripts/live-models-context.ts`、`benchmark-context.ts`、`release-manifest.ts`、套件及文件。

65 tests、5 Electron E2E；真正選 Sol/high、Astra/medium、Opus、Sonnet、Argon、Flash，以及重啟恢復設定、1600 則以前繁中來源的實測，以 VALIDATION/BUILD_MANIFEST 最終二進位證據為準。5000 則生成訊息的 SQLite 基準是開發機測量，不代表全平台效能。

下一階段優先處理 Windows 相容性、硬崩潰與程序隔離矩陣，以及開發工具鏈 minimatch 相容修復。語意／向量摘要、AGY 真增量串流、簽章與完整安全稽核仍未完成；不得將 v0.6.0 標為完整 v1.0。

以下保留前版歷史紀錄。

## 本階段：任務交接、等待與失敗復原

已實作新嘗試鏈結、依賴解鎖、blocked/waiting_agent/approval 狀態、重新指派獨立紀錄及工作區、保留已回報用量與部分檔案、關閉／重啟人工恢復、逾時／預算失敗辨識、跨聊天室批准通知。Migration 5 阻止不理解嘗試鏈結的舊版重跑已取代工作。完整語意與驗證步驟見 TASK_RECOVERY。

修改檔案：`src/shared/types.ts`、新增 `src/shared/tasks.ts`、`main/orchestrator/orchestrator.ts`、`database/store.ts`、`database/backup.ts`、`renderer/App.tsx`、`features/SidePanel.tsx`、`WorkflowControls.tsx`、`styles.css`；新增 `tests/task-attempts.test.ts`、修改 `orchestrator.test.ts`、`store.test.ts`、`workflows.test.ts`、`attachments.test.ts`；新增 `scripts/live-recovery.ts`、`probe-agy-stream.ts`、修改 `release-manifest.ts`、套件與文件。

Typecheck/Lint、54 tests 通過。打包版重啟／依賴 Live、四個 Electron E2E、三家圖片／網路／@All OK 的最終結果與二進位雜湊以 VALIDATION/BUILD_MANIFEST 為準，不以 Fixture 取代真實驗收。

AGY 本輪 structured-output 長文字探針只收到一個完整 DONE 公開回覆，沒有增量片段。沒有新增假串流或執行未驗證 JSON；此功能仍未完成。這次優先完成不受影響的復原路徑。

以下保留前版歷史成果。

## 本階段：原生能力補齊

Antigravity 原生 read_file 在 sandbox 實測能辨識本機圖片，v0.3.0 將 text-only stdin 誤解為不能讀圖的限制已修正。三家皆保有真正檔案/工具操作；新增 Claude WebSearch/WebFetch、Codex live search 批准與 network-only turn grant、AGY domain 設定與原生工具 inventory。AGY 圖片需成功讀取所有圖片的工具事件，否則失敗；暫存清理拒絕跟隨被置換的 junction。詳見 CAPABILITIES 與 IMAGES。

修改檔案：`agents/antigravity.ts`、`codex.ts`、`claude.ts`、`claude-native.ts`、`collaboration-server.ts`、`images.ts`、新增 `tool-policy.ts`；`attachments/store.ts`、`orchestrator/orchestrator.ts`、`shared/types.ts`、`shared/schemas.ts`、`renderer/App.tsx`、`features/Settings.tsx`；`tests/adapters.test.ts`、`attachments.test.ts`、`e2e/attachments.spec.ts`、新增 `tool-capabilities.test.ts`；`scripts/live-images.ts`、`live.ts`、`live-antigravity-command.ts`、`packaged-team-chat.ts`、`release-manifest.ts`、新增 `live-web.ts`、`probe-agy-vision.ts`；套件版本與文件。

Typecheck/Lint、46 fixture tests、4 真正 Electron E2E、Windows NSIS 打包；真實打包版三家各自不同隨機圖片、Session resume、原生網路工具及 @All OK 的最終結果以 VALIDATION/BUILD_MANIFEST 為準。AGY 執行原生 `curl.exe -I https://example.com/` 的精確命令/網域批准已得到 HTTP 200。本次不把前版的 Installer install/upgrade roundtrip 或 coding/review Live 冒稱為本版重新執行。

以下保留前階段成果；v0.4.0 修正優先於舊版圖片限制。

## 新階段：真正圖片附件

已完成 SQLite Migration 4 的原檔 BLOB 與 SHA-256、PNG/JPEG/WebP 標頭與尺寸檢查、原圖縮圖與獨立預覽圖層、檔案選取/拖放/剪貼簿、訊息引用與回覆再附加、自含圖片的 JSON/Markdown 匯出、SQLite 備份還原、未引用草稿清理，以及 Codex localImage、Claude CLI/SDK 原生 Base64 圖片。v0.3.0 曾拒絕 AGY 圖片，已於 v0.4.0 改為原生影像讀檔路徑。

新增/修改：`src/main/attachments/store.ts`、`agents/images.ts`、三家 Adapters、`orchestrator/orchestrator.ts`、`database/store.ts`、`database/backup.ts`、`ipc/handlers.ts`、`shared/types.ts`、`shared/schemas.ts`、`preload/index.ts`、`renderer/App.tsx`、`features/Attachments.tsx`、`styles.css`、`tests/attachments.test.ts`、`claude.test.ts`、`store.test.ts`、`tests/e2e/attachments.spec.ts`、`scripts/live-images.ts`、套件與文件。

Typecheck/Lint、40 tests、4 Electron E2E 通過。真實圖像辨識證據與最終打包版結果見 IMAGES、VALIDATION 及 `.local/live-images/`。先前 v0.2.0 核心成果保留如下。

更新：2026-10-31，Asia/Taipei。三家真實 Runtime、跨代理回覆、隔離改檔、唯讀 Review 及測試後合併已驗證。以下將核心完成與尚未完成的完整規格區分；不把 Fixture 當 Live 證據。

## 六階段成果

| 階段 | 已完成的可執行功能 | 驗證 | 主要檔案 |
|---|---|---|---|
| 1 Desktop | Electron/React strict TS、Tailwind/shadcn-style 元件、Zustand、SQLite 3 次 Migration、專案、聊天、主題、繁中/英文、安全 IPC | 真正 Electron 專案／聊天／重啟／DPAPI／匯出 E2E | `src/main/index.ts`、`database/store.ts`、`ipc/handlers.ts`、`src/preload/index.ts`、`src/renderer/App.tsx`、`styles.css` |
| 2 Runtime | Codex App Server、官方 Claude Code native subscription 與獨立 SDK/API、Antigravity native CLI；建立/恢復、實際改檔、工具、批准、取消、錯誤 | 三家 Live 真實改檔／隨機 nonce 讀取／原生 Session resume；打包版三家 OK | `agents/codex.ts`、`codex-runtime.ts`、`claude.ts`、`claude-native.ts`、`antigravity.ts`、`process.ts` |
| 3 Shared Chat | 獨立原生 Session、共享時間軸、@Mentions、任意成員數、多實例、增量背景、摘錄摘要、詞彙相關檢索、分頁、完整訊息搜尋、虛擬捲動 | Live 5 回合、240 訊息 E2E、SQLite tests | `orchestrator/orchestrator.ts`、`database/store.ts`、`renderer/stores/workspace.ts`、`App.tsx` |
| 4 Collaboration | Codex dynamic tools、Claude authenticated local HTTP MCP/hook、AGY structured-output bridge、10 種操作、依賴、每工作區 turn lock、主管、反循環、用量預算、Stop | 真正 Codex→Claude→AGY→Codex，人工批准/並發/去重/深度/用量測試 | `agents/collaboration-server.ts`、`adapter.ts`、`orchestrator/orchestrator.ts`、`shared/schemas.ts` |
| 5 Coding | Worktree、Diff、Checkpoint、初始 Commit 審核、不可變契約、獨立 Review 快照與評論/修正/重審、測試版本綁定、預覽、雙向同步、Revert、快照清理 | 真實 Git 隔離/衝突/漂移/回滾；原生平行 coding + AGY Review + 兩次已測試合併 + 最終專案測試 | `git/workspaces.ts`、`tasks/tests.ts`、`orchestrator/artifacts.ts`、`features/Reviews.tsx`、`WorkflowControls.tsx`、`SidePanel.tsx` |
| 6 Release | Windows NSIS、metadata-only rotating logs、啟動失敗視窗、重啟不重播、DB backup/restore、鍵盤焦點、CI workflow、操作文件 | Typecheck/Lint/34 tests、Electron E2E、真實打包 EXE；安裝/升級結果見 VALIDATION | `database/backup.ts`、`app/diagnostics.ts`、`components/useDialog.ts`、`.github/workflows/windows.yml`、`scripts/installer-roundtrip.ps1` |

其他本次修改：`src/shared/types.ts`、`src/renderer/features/Settings.tsx`、`TeamEditor.tsx`、`tests/workflows.test.ts`、`native-bridge.test.ts`、`adapters.test.ts`、`store.test.ts`、`tests/e2e/history.spec.ts`、`scripts/live*.ts`、`packaged-team-chat.ts`、`upgrade-profile.ts`、`package.json`、`package-lock.json`、`eslint.config.js`、README 與本文件。

## 20 項核心驗收

| # | 驗收 | 實際證據 |
|---|---|---|
| 1–2 | Windows 啟動、專案載入 | Electron E2E、packaged EXE、原生對話框及 SQLite |
| 3–5 | 真實 Codex/Claude/Antigravity | `.local/live-report.json`：三家 passed，非 Mock |
| 6–7 | 同場聊天室、@Mention | `.local/packaged-team/report.json`：真正 UI @All，三家各回 OK |
| 8 | 三家實際開發 | 三家各自 native tool 寫入 proof.txt，恢復後讀出 Host 新 nonce |
| 9–10 | Agent 間傳送、真正收到並回覆 | `.local/collaboration-report.json`：5 個原生回合及雙向回覆確認 |
| 11 | 獨立 Worktree | Live 協作三份工作區、Git isolation tests |
| 12–13 | 工作狀態、Diff | Activity/任務/批准/失敗狀態、真實 Git Diff |
| 14 | 互相 Review | `.local/coding-report.json`：AGY 對 Codex Commit 提交 verdict、檔案行號評論，沒有冒稱執行測試 |
| 15–16 | 停止取消、權限 | abort/程序樹、手動委派與取消、junction、MCP token/origin、唯讀拒絕、native soft-denial tests |
| 17 | 重啟恢復聊天 | 真正 Electron restart E2E、備份重啟還原與舊版資料遷移 |
| 18–19 | 整合測試、安全合併 | 真正 native coding 的兩個 integration snapshot 通過測試，最終專案再次通過；Git drift/conflict/test gate tests |
| 20 | Windows Installer | `release/0.2.0/AgentHub Setup 0.2.0.exe`；安裝 roundtrip 詳見 VALIDATION |

## 已知限制與下一步

這是可用的 v0.2.0 核心產品，**完整最初規格仍有以下未完成細節**，不能稱為全部六階段每一項細節均已完成：

1. 圖片二進位輸入已在 v0.3.0 完成，v0.4.0 補齊 AGY 原生本機讀圖；GIF/動畫/超大圖仍拒絕。原生 Claude 訂閱可用，SDK/API 圖片目前為合約測試，沒有 API Key 付費 Live。原生工具依 CLI/model 實際清單；AGY 有 native search，不假裝未提供的 read_url_content 可用。
2. Antigravity 公開訊息在 structured output 驗證後才顯示；沒有逐 Token 的公開文字串流。不能把未驗證的路由 JSON 直接顯示或執行。
3. 摘錄摘要與詞彙相關檢索已實作；沒有付費模型的語意摘要或向量索引。
4. Claude SDK/API 模式保留官方 Runtime 與合約測試，但本環境沒有提供 API Key，因此 Live 驗收為 not_run；本機官方 CLI 訂閱模式已實際驗證。
5. npm、Python、.NET、Rust、Go 固定測試入口已實作；真實整合快照主要使用 npm/node:test 驗收，未宣稱所有外部語言工具鏈均已 Live 測試。AGY Shell 精確規則已用固定 echo 真實驗證，仍需逐回合批准。
6. 未簽章、未實作自動更新、未發布線上；沒有發行者憑證，請在本機設定簽章，不在聊天室貼私鑰。CI workflow 已加入，尚未遠端執行。
7. 實測主機 Windows 11 build 26300，沒有其他 Windows 版本/乾淨 VM 的完整測試矩陣。AGY 在舊 Windows 拒絕啟動必要 Sandbox；不以未沙盒模式降級。
8. 已做安全邊界與權限測試，尚無獨立第三方安全稽核、長時間負載測試與崩潰故障注入矩陣。用量限制不是即時硬性扣款封鎖，可能在通知前超額。

後續 Session 請先讀本文件與 MODELS_AND_CONTEXT、TASK_RECOVERY、VALIDATION。聊天室三家模型／強度、FTS5／繁中背景與來源已完成，不要重做。下一階段優先處理 Windows／硬崩潰／程序隔離矩陣與開發工具鏈 minimatch 相容修復；AGY 增量串流須使用真實官方事件，不能模擬逐字。保持可建置狀態；完整 v1.0 尚未驗收。
