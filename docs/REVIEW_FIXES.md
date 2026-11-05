# v0.12.3 審查修復（2026-11-05）

本輪修復審查第 1、3、4、5、6 項。第 2 項依使用者明確指示保留，`orchestrator/autonomy.ts` 及 `approvals.ts` 未修改；本輪不宣稱該批准限制已補強。

## 行為與檔案

- `src/main/git/automatic.ts`：自動測試／安裝固定走原生沙盒；不解析 EPERM 來提升權限，不以 No test files found 把失敗改為成功。失敗仍保存快照，現有全自動修正可調整專案後重試；不增加逐次批准。
- `src/main/orchestrator/guidance.ts`：沙盒錯誤改用允許範圍內的相容設定，不要求代理繞過沙盒。沒有更改自動批准政策。
- `src/main/github/service.ts`：預覽保存確切 HEAD、工作區與推送目標，提供一次性識別碼，15 分鐘到期且不跨 App 重啟。清單以固定物件讀取；建立 PR 及推送 CI 修正都驗證預覽，推送固定 SHA，拒絕重複送出及過期／跨任務預覽。即使檢查後另一回合提交新內容，也不會被一起發布。
- `src/shared/{types,schemas}.ts`、`src/main/ipc/handlers.ts`、`src/renderer/features/panels/PullRequestBox.tsx`：串接預覽 ID、顯示批准 SHA，修正推送先預覽再確認。
- `src/main/orchestrator/{execute-turn,orchestrator}.ts`：開始執行時合併最新任務資料，重試保留 pullRequest／source，避免 CI 修正按鈕與 Issue 來源遺失。
- `src/renderer/lib/diff-lines.ts`：解碼 Git C-style UTF-8 八進位與特殊字元，先解碼再去掉 a/、b/，處理標頭 tab 與 rename／delete／binary 路徑。
- `tests/{automatic-test-policy,github,diff-review}.test.ts`：新增安全 gate、真實本機 bare Git 推送／競爭、metadata 生命週期及繁中空白路徑回歸。
- README、使用手冊與 IMPLEMENTATION_STATUS 更新行為；版本 0.12.3，資料庫 Schema 8 不變。

## 驗證

Typecheck 與修改檔案 ESLint 通過。相關 7 個單元／整合測試檔共 41 項通過，範圍為 automatic-test-policy、github、diff-review、orchestrator、plan-gate、handoff、autonomy。首輪 40 項通過／1 項發現 Git 額外 tab 分隔符；修正後 Diff 5 項與增加預覽邊界的 GitHub 6 項單獨重跑通過，沒有重跑無關全套。

最終打包版啟動、相關 Electron E2E 與 EXE SHA256 結果保存於 `release/0.12.3/REVIEW_VALIDATION.json`。不以舊版二進位或三家歷史 Live 結果當作本版驗收。測試替身僅用於免付費的協定／政策，Git、Worktree、SQLite 和 Electron 仍使用真實元件。本輪未對外推送或開 PR，也未執行三家付費 Live。
