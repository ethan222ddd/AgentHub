# Antigravity Host 資料續接 — v0.8.0

## 已實作

AGY 現在可以透過結構化 `search_context`、`read_context`、`read_artifact` 取得 Host 資料。保留真正 agy Runtime，使用同一程序／Conversation ID 的官方 stdin NDJSON：只在上一個 `result` 完成並通過 Schema 驗證後送下一個原生提示。這是同 Session 的原生下一回合，沒有虛構 MCP tool-result 注入 API。

官方依據：[Headless 程式化會話](https://antigravity.google/docs/cli/headless/)。本機 1.4.12 的真實探針已在兩個原生回合完成 Host 未知隨機碼傳遞；完整 EXE 驗收以 VALIDATION／BUILD_MANIFEST 為準。

## 邊界與計費

- 每個 Task 最多三次 Host 結果續接，加上初始回合最多四個原生提示。額外回合使用真實帳號額度，並計入原請求 correlation 的全隊 maxTurns；不能用續接繞過委派／Token／費用限制。
- 驗證原生 num_turns 每次恰增一與 Conversation ID 不變，拒絕晚到重複／亂序結果；缺少回合序號的版本不啟用續接，不猜測相容性。
- Host 讀取回合只接受讀取操作；混入傳送、委派、發佈或 Review 提交會整批拒絕，不先執行部分副作用。最後沒有讀取需求時才交付其他結構化請求。
- Host 資料標示為 untrusted-data；同房間／同專案與確切契約版本 gate 維持不變，不因讀取結果而增加工具權限。
- 權限卡明示批准範圍包含最多三次續接；原生 Sandbox、工作目錄、唯讀／命令／網域設定不改。附圖暫存持續到整個 Task 結束，之後清理。
- 每批結果上限 48,000 字元。過大內容回傳明確錯誤，不把部分契約冒稱完整且通過 SHA 驗證。重複請求使用相同 Task 的快取結果，仍受回合上限限制。
- 使用原生 cumulative session 用量回報，由 Orchestrator 計算該 Task 差額，不能把每次結果當新增累積值重複相加。

## 可觀察性與復原

中間 JSON／暫定訊息不進公開聊天，只發佈完成驗證後的最後答案，不顯示私人推理。活動包含 native.turn.started/completed 與 host.read.started/completed/failed，帶原生回合、Task、Session、操作與請求 ID，以及來源訊息 ID／契約 Commit；不記錄 Host 結果內容。失敗原因經遮蔽後可查看。任務詳情顯示已配置的原生回合預算數量。

Stop、逾時、CLI 退出或 Adapter dispose 會阻止後續 stdin／副作用並終止該程序；Host 讀取等待中也能取消。不自動重新啟動程序、重播請求或重跑未完成 Task。JSON 持久化新增可選 nativeTurns，沿用 Schema 7；重啟保留數量並維持既有人工復原語意。

## 驗證與修改

`tests/agy-continuation.test.ts`／`fixtures/agy-continuation.mjs` 明示為協定 Fixture，驗證串接、去重、上限、畸形／混合／重複結果、Session 漂移、超量結果、預算、Host 等待／原生續接取消與退出。Orchestrator tests 驗證持久化計數及跨代理預算不能繞過。

`npm run test:live-agy-host` 使用真正 EXE：原生任務背景準備後才由 UI 貼上未知來源；搜尋摘要不含後段碼，必須再讀原訊息；另一個 Worktree 的未整合契約必須走 Host 精確版本讀取。確認三個碼、同一 Session、四個原生提示、只有一則公開答案、第二原生回合中停止，以及重啟不重播。契約由 Host 測試 Fixture 建立，沒有冒稱其他 Agent 產生它。

主要修改：`agents/antigravity.ts`、`agents/adapter.ts`、`orchestrator/orchestrator.ts`、`shared/types.ts`、`renderer/features/SidePanel.tsx`；新增測試／Live 腳本及發行 manifest、手冊／狀態文件。AGY 逐 Token 公開串流與官方 headless 額度查詢仍為另外的上游能力缺口，未因本功能宣稱完成。
