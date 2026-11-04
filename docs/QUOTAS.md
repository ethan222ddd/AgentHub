# 帳號剩餘額度（v0.6.1）

聊天室輸入框上方顯示各 Agent 第一個額度時段的剩餘百分比。點「剩餘額度」展開所有模型／時段、重置時間、最近成功更新時間與來源。時段彼此獨立，不把不同模型的額度相加。

- Codex：官方 App Server `account/rateLimits/read`，支援多個 bucket 的 primary／secondary。剩餘比例為供應商回傳的 `100 - usedPercent`。保留 `ordinaryUsageAllowed` 的權威結果；不能因重置時間到期或比例增加就判斷已恢復權限。Credits 餘額只按原單位顯示，不標成美元。
- Claude Code 原生登入：官方 CLI control `initialize` → `get_usage`，`skip_behaviors: true`，只查訂閱時段，不掃描本機歷史、不發送模型回合。只保留 rate_limits 的利用率／重置時間；account、session cost、behaviors 等不會傳到 Renderer。API-key 模式不顯示本機訂閱額度，兩者帳務分開。
- Antigravity 1.4.12：官方 `/usage`（別名 `/quota`）及 `/credits` 是互動式 TUI；statusLine 文件列有 quota 欄位，但本機 headless idle 及真正 OK 回合均未執行 statusLine，也未找到支援的 headless 額度查詢。介面明確顯示無法取得及官方查詢方式。不讀取私有憑證或內部 API，也不把 context window 剩餘百分比當帳號額度。

前景視窗每 45 秒查詢、聚焦及回合結束時補查，可手動刷新。Main 每 provider／認證模式共用記憶體快取（正常 30 秒、失敗 15 秒，手動至少 5 秒），相同查詢合併，metadata 程序在查詢後終止。背景／最小化停止自動輪詢。這是 Runtime 提供資料的定期刷新，並非逐 Token 帳務結算推播；供應商本身也可能快取。

錯誤時保留上次成功快照並標示已過期，不改成 0 或 100%。未知用量保留未知。90 秒以上資料、已過重置時間但未刷新，都有明確提示。額度不控制批准政策、不提升權限、不自動充值。欄位白名單診斷僅記錄來源／查詢狀態，不記錄原始 account、憑證或額度回應。

驗證：`tests/quota.test.ts`（Fixture／純函式）；`tests/e2e/quota.spec.ts`（API／headless 不支援狀態，無付費模型）；`npm run test:live-quota`（真正打包 EXE → IPC → 官方 Codex/Claude metadata，觀察 Renderer 45 秒自動刷新，確認沒有 Task／模型回合）。Live 報告以實際 app.asar SHA-256 綁定。

官方參考：[Codex App Server](https://learn.chatgpt.com/docs/app-server)、安裝的官方 Claude Agent SDK `SDKControlGetUsageRequest/Response` 型別、[AGY usage](https://antigravity.google/docs/cli/commands/usage/)、[AGY statusLine](https://antigravity.google/docs/cli/statusline/)。
