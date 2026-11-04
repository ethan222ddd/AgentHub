# 自動專案與 Worktree 管理 — v0.7.0

使用者選擇專用資料夾即啟用安全的本機初始化／版本及整合管理。原生 Agent 的登入、Sandbox、工具批准政策保持獨立，不因自動 Git 而提升權限；不會自動 Push。

## 為何舊版要求 Initial Commit

Git Worktree 要有可檢出的版本作為起點。舊 `WorkspaceManager.prepare` 只允許以 HEAD 建立工作區，沒有 HEAD 就回報錯誤，使用者需走進階初始 Commit 流程。新版本由 `AutomaticProjects` 在開啟／首次派工時補齊這個基礎。

## 初始快照

- 全新資料夾：`git init --initial-branch=main`、附加忽略規則、安全快照。初始版通常包含 `.gitignore`，不需要使用者提供作者身分。
- 有來源但未使用 Git：檢查正常檔案後提交，讓 Worktree 取得實際來源，不能只建空白 Commit。
- 已有 Git 但無 Commit：保留主分支、檔案與原有暫存資料。存在暫存項目／不明內容時，在 App 內要求檢查；使用 alternate index，不清除或覆寫原暫存 entry。
- 已有 HEAD：重用既有 Repository，不重新初始化、不改主分支、不清除修改。不替使用者偷偷提交既有未處理主專案變更。

快照使用逐檔清單及檔案／Git blob 雜湊檢查，絕不在自動路徑無條件 add-all。主分支 ref 更新使用舊版本比對，檢查外部 branch／index 變動。作者只以單次 `-c` 指定，不寫全域設定。支援 Windows 空白／繁中及正常 CRLF 正規化。

已知檔名秘密（.env、私鑰等）排除；一般文字也檢查常見憑證／硬編碼秘密模式。未知型別、大小、符號連結或不能確認的內容需審核。這是保守啟發式檢查，不能宣稱識別所有形式的秘密，更不會清除原 Repository 過去已提交的秘密。

單檔 5 MiB、一次 64 MiB／5000 候選檔是自動安全掃描界線；過大專案需先審核／調整忽略規則或使用進階方式。專案不可包含／位於 App 私有資料與受管工作區中，防止遞迴和提交聊天／認證資料。選到上層 Repository 內的子目錄會拒絕巢狀初始化。

## Worktree 生命週期

每 project／agent 只有一個當前工作區映射，按需建立。目錄位於 App 使用者資料的 workspaces 下，以 project ID／安全的 agent 前綴與雜湊命名；分支另用 UUID。分支碰撞選新名稱，不重設原分支。

重啟後載入映射。有效工作區與 WIP 原樣重用；已搬移且仍有有效 Git 註冊的受管路徑可找回。真實目錄缺失時，以保存的分支在新目錄／新分支恢復，保留舊註冊／分支，不 prune 或強制刪除；已被外部刪掉的未提交 bytes 無法保證恢復。

每 Agent Turn Lock 防止同工作區重疊；專案層序列化初始化、同步及主專案整合，真正 Runtime 回合仍可平行。下一回合前同步主專案：乾淨工作區可整合無衝突更新；有 WIP 時只允許不碰到 WIP 的安全快轉，其他情況停下保留。

## 自動整合

Agent 回覆完成後不等於整體完成。Host 先保存「整合中」狀態，檢查安全變更及新提交歷史，建立 checkpoint，再以整合快照測試；來源、目標、分支、乾淨狀態與最後 tree 都經既有 merge gate 重查。成功才把成果放回使用者選擇的主要資料夾。

既有未完成 WIP 不會因只讀問答被自動發佈。與 WIP 混合的新修改需先檢查後明確整合。若已啟用自動 Review，需該確切版本的 approve，再重試整合；不偷偷繞過審查設定。

衝突、主專案使用者修改、缺少／失敗測試、私有 npm 設定、Git 自訂 filter／merge driver、版本漂移等，都變為 integration attention 並保留狀態。UI 可檢查主專案、保存安全快照、重試整合，不重跑 Agent。Migration 7 保證重啟與降版不會把待整合工作當尚未執行的 Agent 任務重播。

## 自動測試的安全邊界

可執行的自動 npm 測試使用官方 Codex App Server standalone command/exec，無 thread／模型回合。明確 workspaceWrite、僅快照與獨立 scratch 可寫；一般測試不允許網路。沒有可用沙盒或協定不支援就停止，不執行未沙盒降級。

公用 npm lockfile 依賴可用固定 npm ci --ignore-scripts 安裝；非公用來源及專案 .npmrc 需審查。命令環境與 npm config/cache 使用獨立 scratch，不複製登入憑證。一般 npm test 可能執行專案程式，仍需使用信任的專案；此功能遵守官方原生沙盒能力，不能宣稱已完成獨立的完整 OS 安全稽核。進階面板明確批准的手動測試維持原有 Host 執行，與 native-sandbox 記錄區分。

本機官方 Windows command sandbox 實測拒絕 Node 再直接 spawn Node（EPERM），因此預設 `node --test` 的子程序隔離也可能失敗。測試失敗會保留日誌並阻止整合，不會關閉 OS Sandbox 或偷改使用者測試。生成的 Live 驗收專案明確使用 Node 24 的 `node --test --test-isolation=none`，在同一受沙盒保護的程序執行實際斷言；這不等於停用 OS 沙盒。其他需要子程序的框架需依實際日誌處理，或由使用者明確批准進階 Host 測試。

HTML/CSS／靜態資料專案可用基本格式、JSON、文件元素及版本不變檢查。名稱明示 Static site basic checks (not functional/browser tests)，不能把它當端到端功能驗收。Node 等程式專案沒有適用入口則要求補測試。

Git 子程序不使用 shell 拼接，不繼承 GIT_DIR／GIT_INDEX_FILE 等外部重導向，不執行 hooks／fsmonitor；在自動流程檢查自訂 filter／merge driver，避免 Git 命令意外執行 Repository 程式。metadata-only journal 保存本機 Git 操作與錯誤，不保存檔案內容或憑證。

## 驗證與檔案

主要程式：git/automatic.ts、safe-snapshot.ts、command.ts、workspaces.ts；orchestrator、tasks/tests.ts、tasks/sandbox.ts、Store/Backup、IPC/Schema、App/SidePanel。

`tests/automatic-projects.test.ts` 使用真正 Git 與生成專案，Sandbox 通訊以明示 Fixture 驗證排程／流程，不冒稱 OS 隔離證據；`tests/e2e/automatic-projects.spec.ts` 是無付費模型的真正 Electron 初始化／還原檢查；`npm run test:live-automatic` 對最終 EXE 執行真正三家 Runtime 與主資料夾產物驗證。最終結果及版本雜湊見 VALIDATION、BUILD_MANIFEST。

2026-11-01：94 tests／7 Electron E2E 已通過。最終打包版 Live 已證明：空白中文／空白路徑自動初始化與真正 Codex Hello World（Edge 實際呈現）；Claude 讀取既有來源並保留原檔及排除假憑證；無 @ 的普通需求派給三家，三個獨立 Worktree 各自寫檔，四份確切整合快照在官方 command sandbox 執行實際 Node 斷言後通過；原資料夾含三家成果；重啟沿用工作區，原生 Codex 讀出未完成檔案且不把該 WIP 自動提交／發佈。

Live 另發現並修復「上次主分支 merge 已記錄，但 Agent 分支尚未實際包含該 Commit」的同步判斷錯誤。現在以真正 HEAD／祖先關係決定同步，不靠 seen-head 快取略過；新增同 Agent 連續兩次交付及舊 metadata 回歸測試。測試 Profile 另提高本機 Token 上限至 1m 以容納六個原生回合，正式預設 200k 未變；預算停止的失敗報告保留在 .local，不冒稱初次所有路徑皆成功。

### 本次修改檔案

- Git：`src/main/git/automatic.ts`、`safe-snapshot.ts`、`command.ts`、`workspaces.ts`。
- Runtime／任務：`src/main/orchestrator/orchestrator.ts`、`src/main/tasks/tests.ts`、`sandbox.ts`。
- 資料／IPC：`src/main/database/store.ts`、`backup.ts`、`src/main/ipc/handlers.ts`、`src/main/index.ts`、`src/shared/types.ts`、`schemas.ts`、`tasks.ts`。
- 介面：`src/renderer/App.tsx`、`features/SidePanel.tsx`、`Settings.tsx`、`styles.css`。
- 驗證：`tests/automatic-projects.test.ts`、`fixtures/command-sandbox.mjs`、`e2e/automatic-projects.spec.ts`，以及既有 persistence／migration／notes／附件 E2E；`scripts/live-automatic.ts`、`live-recovery.ts`、`portable-smoke.ts`、`release-manifest.ts`。
- 發行／文件：`package.json`、`package-lock.json`、`scripts/build-user-guide.ts`、README、使用手冊與離線 HTML、IMPLEMENTATION_STATUS、VALIDATION、ARCHITECTURE、TROUBLESHOOTING、RELEASE_READINESS、BUILD_MANIFEST。
