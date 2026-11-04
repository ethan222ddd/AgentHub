# Task handoff and recovery — v0.5.0

## 等待與阻礙

任務分為排程中、執行中、等待依賴／工作區、等待批准、依賴受阻、暫停及終態。等待批准仍持有原工作區鎖，Stop/Pause/Cancel 可終止它，不能此時重新指派造成重疊改檔。其他聊天室的批准會顯示通知，點「前往批准」即可切回該室。

依賴失敗／取消／缺少紀錄時，下游顯示 blocked 與來源，尚未啟動 Runtime。活動抽屜可以展開上游任務。獨立任務繼續執行，單一依賴錯誤不使整個排程崩潰。暫停中的依賴則顯示 waiting_agent，等待使用者處理。

## 明確恢復與交接

按「檢查後繼續」會保留舊 Task、原生訊息、錯誤、部分檔案與已回報用量，建立新 Task ID。`retryOf` 和 `supersededBy` 連結執行嘗試，不能再次啟動已被取代的舊嘗試。依賴追蹤合法的同聊天室嘗試鏈；原本排程中的下游在最新嘗試成功後可繼續。若下游已被使用者取消／暫停，不會偷偷恢復。

重新指派同樣建立新嘗試，保留原 Agent 的歷史。Coding 使用新成員的工作區；不直接複製先前未提交檔案。提示包含先前工作區和起始 revision，Agent 須透過已提交契約或明確的整合流程取得其他分支的修改。Review 仍綁定原本的唯讀 Commit 快照。

舊嘗試用量不會被新嘗試覆蓋。用量限制依原生已回報資料計算，取消前尚未回報的供應商費用仍無法即時確定；不宣稱為完整計費帳本。

## 關閉、重啟與逾時

關閉 App 或啟動時發現未完成工作，會標示 waiting_user/recovery，需要檢查 Diff 後明確繼續，不會重播。先前等待依賴的下游也需要各自人工恢復；即使上游之後成功，也不自動解除這道重啟保護。使用者刻意暫停的工作仍維持 paused。

逾時及預算中止會顯示失敗和原因；使用者 Stop/Cancel 才標示取消。部分內容保留，沒有自動重試 Shell 或檔案修改。重新執行由使用者批准，不保證原有命令具備冪等性，必須先檢查工作區。

Migration 5 記錄新的排程語意。舊 v0.4.0 不理解 replaced attempts，因此拒絕開啟新版資料庫；不要以舊版覆蓋此資料庫。升級前可用本機 SQLite Backup 保存舊版資料。Schema 1–4 備份仍可驗證並遷移。

v0.4.0 未記錄的重試關係不會靠文字猜測重建；若舊資料已有下游依賴失敗，請檢查後建立正確的新依賴。新的嘗試鏈結由 v0.5.0 明確記錄。

## 實際驗證

- `tests/orchestrator.test.ts`：部分檔案保留、retry 依賴解鎖、用量分開、轉派獨立工作區、批准取消、逾時、缺少依賴的隔離處理。
- `tests/task-attempts.test.ts`、`tests/store.test.ts`：鏈結／循環／跨聊天室拒絕、重啟不重跑、Schema 遷移。
- `npm run test:live-recovery`：啟動本輪打包版，在生成的工作區由真正 Codex 寫檔，暫停尚未批准的命令，關閉／重啟 App，再明確恢復同一原生 Session；等待中的 Claude 需額外明確恢復，並依 Codex 新嘗試完成才啟動。報告含 app.asar SHA-256；沒有用 Fixture 回覆充當 Live。

## Antigravity 公開串流調查

官方文件將 `agent_response.text_delta` 定義為公開文字，schema 僅約束最後 result。本輪探針在相同 native sandbox/JSON Schema 模式要求 70 行公開文字，實際只有一個 DONE 事件（7015 字元），沒有 ACTIVE 文字片段。報告在 `.local/agy-stream-probe/report.json`，可用 `npx tsx scripts/probe-agy-stream.ts` 重測。仍保留最終 envelope 驗證後才顯示／路由；沒有用定時切字假裝 token streaming，沒有顯示私有推理。

未完成：AGY 真正增量文字（需要官方 Runtime 發出片段或驗證其他官方整合）、硬崩潰／停電故障矩陣、多小時負載及所有 Windows 版本。這次關閉／重啟驗收不能冒稱涵蓋所有硬崩潰情境。
