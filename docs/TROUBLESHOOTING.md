# 問題排除 — v0.7.0

完整逐步操作見 [使用手冊](USER_GUIDE.zh-TW.md)，以下補充異常排查。

## Windows 程序診斷

v0.9 起在「設定 → 診斷」查看受管 PID、Task／Agent、執行階段與 keeper；日誌另記錄各服務關閉是否完成，不含 argv／憑證。守護器缺失或 Job 指派失敗時不會降級啟動，請重新安裝完整版本並確認系統 .NET Framework 4.x。完整復原與邊界見 [PROCESS_LIFECYCLE](PROCESS_LIFECYCLE.md)。

## 任務等待、重試與重啟

「依賴受阻」請展開上游，先修復或重新指派；下游尚未執行，會追蹤使用者批准的新嘗試。「需要檢查後恢復」是重啟保護，必須檢查 Diff 後各自明確恢復，不會因上游成功便自動重播。已被取代的舊嘗試只供歷史檢查。跨聊天室批准用頂部通知的「前往批准」切回。詳見 TASK_RECOVERY。

## 圖片附件

支援靜態 PNG/JPEG/WebP，最多 4 張、每張 5 MiB、4096px/邊及 8MP，整批 12 MiB。Codex/Claude 使用原生圖片輸入；Antigravity 從其工作區暫存原檔使用原生影像讀檔工具。若顯示 `IMAGE_NOT_READ`，表示未收到所有圖片的原生成功讀取事件，請檢查 Activity、CLI 版本及模型影像能力。v0.3.0 的全面 AGY 拒絕已於 v0.4.0 修正。

匯入後原檔存於 SQLite，移動/刪除來源不影響聊天。若看到完整性錯誤，請從原檔重新匯入或還原有效 SQLite 備份，不會跳過損壞檢查。SQLite schema 升級至 4，舊版 App 不能開啟新版 DB；降版需先保存新版資料，再用先前版本的備份，避免損失圖片。

JSON/Markdown 匯出包含圖像原檔，總圖片超過 32 MiB 時請改用 SQLite 備份。部分外部 Markdown viewer 不支援 data URI，可用 JSON 或 App 內預覽。v0.6.1 資料庫已為 Schema 6，前述圖片 Schema 4 是歷史遷移階段；不要使用較舊 App 直接開啟目前 DB。

## Agent 沒有回覆

手動模式沒有接收者時是本機筆記。使用 @Mention 或選擇成員，確認「團隊」包含且啟用該 Agent。查看活動 → 任務與聊天室的錯誤，不要只看 CLI 是否能獨立回答。

v0.7.0 預設自動初始化與配置工作區，不需要按建立 Worktree 或自己輸入 Git 指令。若仍有 `[WORKSPACE_NOT_READY]`，先確認未關閉自動管理；只有刻意使用手動模式才需要進階準備。setup attention 請看原因，敏感／不明檔案可在 App 中確認；主專案、App 私有資料／受管工作區不能互相包含。模型欄不能填啟動命令。

Agent 已完成但整合 attention 時，先看測試／衝突／主資料夾修改；處理後「重新嘗試整合（不重跑 Agent）」。自動 npm 測試需要官方 Codex command sandbox；沒有可用沙盒不會未沙盒降級。Git 自訂 filter／merge driver、私有 npm 設定等需審核，不自動執行。完整流程見 AUTOMATIC_PROJECTS。

## Codex / Windows npm

使用官方 npm 安裝和 `codex login`。App 會解析 npm shim 對應的原生 codex.exe，包括 nested optional platform package、舊 vendor 佈局與 APPDATA fallback，並以 shell:false 啟動；不直接 spawn .cmd。診斷只保存 executable/cwd/環境鍵與 PATH entries、spawn error/exit、RPC 階段、session/routing metadata。設定頁顯示日誌位置。

如果 initialize、thread/start 或 turn/start 失敗，錯誤會顯示在聊天室。協定變動時先更新官方 CLI，必要時用 `npm run protocol:codex` 產生目前版本 Schema；不要換成一般 Chat API 或關掉 Sandbox。

## Claude 訂閱與 API

本機模式使用自己已登入的未修改官方 Claude Code。先在終端執行 `claude auth status` / 官方登入，再在 AgentHub 選「本機官方 Claude Code」。需要 2.1.295+，否則缺少 fail-closed HTTP hooks 會拒絕啟動。App 不讀取 OAuth Token、不代登入、不轉售訂閱。

SDK/API 是另一個可選模式，需要本機設定 API Key；DPAPI 加密保存，不貼到聊天室。切換原生/API 模式請建立新對話。儲存設定後再偵測，可避免查看舊模式的狀態。v0.6.1 CLI 模式已透過原生 control initialize 取得動態模型清單；聊天室「模型與思考」可選模型及強度。只有清單不可取得時才手動輸入合法 ID，或留空使用原生預設。

## Antigravity

透過官方 CLI 登入後執行 `agy --version`、`agy models`。App 也偵測 `%LOCALAPPDATA%/agy/bin/agy.exe`，不讀取 Google 憑證。Windows 10/舊 Windows 11 不支援這個 Adapter 所需 Sandbox；Windows 11 24H2 還需官方指定更新。

每回合先批准指定工作區檔案存取。Windows 使用 cwd-relative 原生規則；不修改全域設定。Headless 不能等待互動批准，額外 Shell 指令可在代理設定列出「確切指令」，回合開始仍要批准該清單。其他 Shell/URL/MCP 操作若被拒絕，任務就失敗，不使用跳過所有權限的參數。唯讀 Review 拒絕所有指令和寫入，測試由 Host 在獨立流程執行。

`file does not exist` 是工具錯誤，不等於權限拒絕；可在活動查看原始類型與目標路徑，Runtime 可恢復並誠實回報。不要以另一個 Worktree 的檔案存在推定快照內也存在。

## Git、測試與 Review

Worktree 看不到其他分支的未整合變更是正常隔離。流程為 Checkpoint → Merge Preview → 整合快照測試 → 批准合併，再對另一個成員執行同步主專案預覽。`publish_artifact` 只分享確切 Git 版本的文字，不偷偷複製進分支。

初始 Commit 流程排除疑似憑證檔案，重查選取檔案雜湊；既有 staged files 需自行審核處理。Checkpoint 會加入該工作區全部變更，請先檢查 Diff、未追蹤檔名和內容。

測試只接受乾淨已提交版本。npm 使用官方 Node 分發旁的 npm-cli.js；缺少時安裝官方 Node/npm。快照不共用其他工作區的 node_modules，可明確批准 `npm ci --ignore-scripts`；需要安裝腳本的專案必須自行審核處理。也有固定 Python/.NET/Rust/Go 入口，需本機工具鏈。

測試留下未忽略檔案、改變 HEAD 或受追蹤程式時，成功 exit code 仍不認證原版本。合併前來源/目標/分支或快照改變時，重新預覽與測試；沒有「人工宣告跳過測試」按鈕。Review 綁定確切 Commit，過時的修正請求必須先重新審查。回滾是新的 Revert Commit，同樣要測試。

## 停止、還原與安裝

Stop 取消佇列並終止子程序樹；已寫入檔案可能保留。重啟後先檢查 Changes，再明確 Resume；不自動回滾或重播。如果原生 Session 恢復失敗，保留紀錄並建立新對話。

設定 → 資料可備份、預覽還原、批准並在關閉重開後套用。原 DB/WAL/SHM 與還原前一致備份保留在使用者資料目錄；勿在 App 執行中手動覆蓋。SQLite 備份不包含 Worktree、供應商 Session 或 DPAPI 金鑰，跨機器 Session 不保證可繼續。

使用 `release/0.12.1/AgentHub Setup 0.12.1.exe`、`AgentHub-0.12.1-portable.exe`，或以 `npm run package:dir` 重建後執行 `win-unpacked/AgentHub.exe`。Portable 資料預設在旁邊的 AgentHubData，請選可寫位置並使用獨立的專案子資料夾。本版 Schema 8，較舊 App 拒絕開啟；安裝檔 unsigned，沒有自動更新。簽章需要發行者本機憑證；不要在聊天提供私鑰。安裝／升級實測範圍見 VALIDATION。
