# Windows 通知與工作列提醒（v0.11.0）

## 使用方式

設定 → 一般 → 系統通知，選擇「批准、完成、失敗與整合提醒」、「只通知批准」或「勿擾」，按「儲存設定」立即生效。預設全部通知；舊資料庫／舊備份缺少此欄位時沿用預設。可用「測試通知」確認 Windows 設定；勿擾時會拒絕測試並顯示原因。

新批准、任務完成、失敗、整合等待人工處理會發出通知。點擊會恢復最小化視窗、切換對應聊天室並開啟活動面板；啟動或重新載入期間的點擊會等 Renderer 訂閱後送達。Windows 通知中心保留的通知使用受驗證的 Conversation UUID；聊天室已移除時不執行任何操作。通知只負責導航，不會批准工具、重跑任務或執行命令。

工作列數字按「任務」去重：尚未解決的批准、等待使用者處理（包含整合／復原）及本次開啟 App 後的未讀失敗。同一任務的多項批准只算一次；超過 99 顯示 99+，無待處理工作時清除圖示。查看對應聊天室、視窗重新取得焦點或點擊通知後，清除該聊天室的未讀失敗；真正未解決的批准／整合不因閱讀而清除。重啟不補發歷史通知，也不把舊失敗當成新未讀；尚待人工處理的任務仍有數字。

勿擾與只通知批准皆保留完整待處理數。不補發靜音期間的通知；這是 App 自身設定，不修改 Windows 勿擾。通知不包含 Prompt、工具命令、程式碼、錯誤內容或專案名稱。原生通知失敗會在 App 錯誤區提示，診斷只記事件類型、聊天室 UUID 和數量。

## Windows 注意事項

建議使用已安裝版本的開始功能表捷徑啟動。AUMID 與安裝包使用相同的 `org.agenthub.desktop`。Windows 的通知權限、勿擾、工作列小圖示設定可能隱藏通知或覆蓋圖示；Portable／開發用 EXE 沒有安裝捷徑時的通知可用性依系統註冊狀態而異。設定 → 一般 → 測試通知可排查；若被 Windows 勿擾靜音，App 無法保證桌面橫幅真的顯示。最小化時仍運作；完全關閉 App 仍會退出與清理子程序，沒有新增背景 Tray 常駐模式。

## 架構與變更檔案

- `src/main/app/notifications.ts`：根據真實 Host 狀態轉換通知、去重、模式、待處理數、啟動導航佇列。
- `src/main/app/notifications-native.ts`：Electron Notification、Windows 集中啟用處理、16px 數字覆蓋圖示與有界生命週期。
- `src/main/index.ts`：接 Orchestrator 事件、AUMID、視窗和退出生命週期。
- `src/main/ipc/handlers.ts`、`src/shared/{types,schemas}.ts`、`src/main/database/store.ts`：嚴格的 ready/read/test IPC、設定預設值。沿用 Schema 7，沒有新資料表。
- `src/renderer/App.tsx`、`src/renderer/stores/workspace.ts`：點擊導航、焦點已讀、初始還原不得覆蓋更新的導航。
- `src/renderer/features/Settings.tsx`：繁中／英文設定及測試按鈕。
- `tests/notifications*.test.ts`、`tests/navigation.test.ts`、`tests/e2e/notifications.spec.ts`：只針對本次功能與相關路徑的測試。
- `scripts/live-notifications.ts`：真正打包版呼叫 Windows Notification.show／setOverlayIcon，從缺少工作區的真實失敗狀態驗證通知；不執行模型回合。

## 驗證範圍

此版依使用者要求採通知範圍驗證，不重跑三家付費代理或全套測試。控制器及原生介面單元測試使用受控 OS 替身；Electron E2E 使用真實 IPC／SQLite／Renderer，只有 OS 投遞端受控。原生打包煙霧另用真正 Windows API，`show` 事件代表系統已接受，不等於人工確認橫幅或滑鼠點擊。各項最終結果見 IMPLEMENTATION_STATUS 與 release/0.11.0/NOTIFICATION_VALIDATION.json；不把 v0.10.0 的代理報告當作新版二進位的驗收。

官方介面依據：[Notification](https://www.electronjs.org/docs/latest/api/notification)、[Windows 通知條件](https://www.electronjs.org/docs/latest/tutorial/notifications#windows)、[工作列覆蓋圖示](https://www.electronjs.org/docs/latest/api/browser-window#winsetoverlayiconoverlay-description-windows)。
