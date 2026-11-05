# AgentHub v0.13.0

Windows 多代理協作開發桌面版，沿用本機 Codex、Claude Code 訂閱 CLI 與 Antigravity 真實 Runtime；不以單一模型模擬團隊。

## 本版重點

- 保留工作流程範本、全自動團隊、通知、計畫關卡、交接、決策、衝突預警、Diff 意見與 GitHub 交付工具。
- 修復自動測試輸出造成的沙盒外重跑／錯誤放行；PR 建立及修正推送固定為使用者預覽 SHA；保留 CI／Issue metadata；正確解析繁中及特殊字元 Diff。
- AGY 1.5.1+ 官方零模型回合 `/usage` 剩餘額度；公開 ACTIVE 文字增量串流，隱藏 reasoning／路由 JSON，完成後以驗證答案取代暫時文字。
- 契約範本的 publisher 步驟由 Host 做安全 checkpoint，不必授予 AGY 任意 Git 命令。
- 修復受公告影響的 minimatch 開發依賴；加入實際 SQLite 容量故障、備份損壞、I/O、負載及乾淨安裝驗證。
- 修正 Codex 唯讀審查指示與 Claude 訂閱登入過期診斷。若 Claude OAuth 無法刷新，聊天室明確提示使用官方 `claude auth login`，不將錯誤歸因為工具被拒，也不記錄原始認證內容。

## 使用與支援範圍

下載 NSIS 安裝版或 Portable，核對 SHA256SUMS。API Key／密碼／Token 不需貼到聊天室；先在各家官方 CLI 登入。繁中離線使用手冊隨附。

本機原生驗收環境為 Windows 11 build 26300；乾淨 CI 使用 Windows Server runner，不能當成乾淨 Windows 10／11 實機證據。使用者已同意保留這個矩陣缺口。AGY 原生 Sandbox 需要相容的 Windows 11，舊系統不繞過限制。

安裝檔未簽章，無自動更新。Claude API-key SDK 模式只有合約測試；本輪真人帳號路徑為原生 CLI 訂閱。使用者指定保留審查第 2 項的自動批准政策，本版不宣稱它已補強或等同完整 OS 隔離。

本機 Live 證據綁定 app.asar／守護器雜湊；GitHub CI 自行建出的安裝檔另做離線、Electron 與 NSIS 安裝／重裝／卸載驗收。完整範圍與實際結果見 ACCEPTANCE_MATRIX、RELEASE_READINESS 與 CI。
