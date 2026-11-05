# v0.13.0 最終驗收執行紀錄（2026-11-05）

使用者授權一次完成四項收尾、整體最終測試，最後推送 GitHub。保留使用者先前指定不修復的自動批准政策（審查第 2 項）；其他 v0.12.3 五項修復納入本版。禁止以舊版雜湊、Fixture 或未執行項目當作真實驗收。

## 已確認

- 本機 Windows 11 Home build 26300，未找到 Windows Sandbox／VM 工具，虛擬化診斷為 false。使用者明確同意以乾淨 GitHub Windows runner 驗收，保留 Windows 10／11 乾淨實機缺口。
- Codex 0.166.0、Claude Code 2.1.296、AGY 1.5.1 均已安裝；Codex／Claude 官方登入及三家正式額度查詢可用，沒有讀取或複製憑證。
- AGY 官方獨立 `-p /usage --output-format json` 回傳 command.name=usage、num_turns=0、五個額度 bucket；已實作正規化及前景刷新接入。版本低於 1.5.1 不發送可能落入模型的查詢。
- 真實 AGY probe 收到多個 ACTIVE 公開文字增量；DONE 可能回傳整段路由 JSON。已實作只串流 ACTIVE 公開文字、隱藏 reasoning／路由 JSON、Host 續接清除暫時文字、完成時以驗證結果取代。相關 35 項合約／額度／續接測試通過。
- npm audit 原有 12 個 moderate，由 minimatch 公告造成；核對使用者套件 API 後僅覆寫受影響 7–11.0.0 範圍到 11.0.4，保留舊版 API。安裝後 audit 為 0，仍需完整工具鏈／打包驗證。
- 修復契約範本需要 Git commit、但 AGY 預設不允許 commit 的缺口：配置為 publisher 的步驟由 Host 安全掃描、checkpoint，再發布 immutable artifact；不開放額外 Shell 權限。真實 Git 的契約平行／交叉審查測試通過。
- 新增實際 SQLITE_FULL、損壞 pending backup、無法建立 DB 的 I/O 保護測試，3 項通過。

## 執行順序

1. 完成規格 20 項核對、CI installer smoke／發佈流程與說明。
2. 凍結程式碼；Typecheck、Lint、全量免付費單元／整合、Build、Windows 打包、全量 Electron E2E。
3. 對同一 app.asar／守護器跑真實三家 OK、串流、額度、圖片、聯網、模型／背景、委派／產物／Review／測試合併、原生工作流程、自動專案、復原、程序故障；再跑 Portable、負載及安裝升級。
4. 本機以獨立 Profile 與專屬安裝路徑跑 0.12.3 → 0.13.0 → 卸載。已核對先前無視窗的舊 Portable 是閒置背景程序；不停止使用中的使用者工作。乾淨 CI 另驗同版本重裝及卸載。
5. 整理同版證據與限制；提交 source-only、合併／更新 GitHub main，等待真實乾淨 Windows CI 結果、修正失敗；提供正式下載方式與實際測試結果。

腳本與測試只使用專屬 fixture Repository／Profile；保持原生權限與安全 Git，不對實際專案執行破壞性操作。API-key SDK 模式、程式碼簽章憑證與自動更新不冒充已驗證；原生 CLI 訂閱為本輪真實驗收路徑。

## 2026-11-06 驗收中發現並修正

- Codex 審查在原生唯讀沙盒中需要使用唯讀檔案讀取命令；調整通用審查指示後，Codex 確實讀到隔離快照。沒有開放寫檔、測試命令或額外批准政策。
- AGY 舊的「不公開中間訊息」指示與新增串流互相衝突；改用官方公開 `agent_response` 暫時顯示，驗證後替換。修正後真實打包聊天室曾觀察到 327 個公開增量；此後若重新打包，重新核對同版雜湊。
- Claude Code 原生 OAuth 過期：以相同 restricted Runtime 重現 `is_error=true`、無 permission denials、無模型用量，原生結果顯示無法刷新 OAuth。官方 `claude auth status` 證實當時未登入。新增不輸出原始認證結果的錯誤分類與重新登入提示。使用者透過官方 CLI 登入後已再次確認原生訂閱狀態。
- 升級腳本處理 Windows PowerShell JSON BOM；卸載腳本等待程式檔與登錄項都清除。實際 NSIS 安裝／原生 Codex 前後回覆／Session、設定及聊天保留／卸載均成功。
- 最後一次全量離線基準 39 檔 214 項、Electron 13 項；另外新增 3 個 Claude 原生失敗格式測試。慢速 Git 案例調整測試等待及隔離清理，保留原有斷言。最終報告依當前版本產物與 CI 更新。

## 本機最終驗收結案

40 檔 217 項離線、13 項 Electron E2E、15 份同一 app.asar／守護器的打包報告、額外 Windows 通知，以及安裝版與 Portable 都通過。完整與 production npm audit 均為 0。`docs/BUILD_MANIFEST.json` 是經檢查的雜湊清單；舊候選版的失敗紀錄保留於忽略追蹤的 `.local`。真實帳號證據不隨 GitHub Release 公開，下載版依 Release Notes 指向的同 Commit 乾淨 Windows CI 驗收。

首次乾淨 [Windows matrix](https://github.com/ethan222ddd/AgentHub/actions/runs/42093818743) 的 2025 runner 有一個 GitHub Issue 匯入案例超過 15 秒。只將該真實 Git 案例的等待上限與同組其他案例對齊為 60 秒，未改斷言或產品程式；本機 GitHub 交付 6 項重驗通過。發佈只採後續同 Commit 完整通過的 CI。
