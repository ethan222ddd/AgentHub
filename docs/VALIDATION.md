# Validation record — v0.12.0

## 工作流程範本：限定範圍（2026-11-05）

本輪只驗證流程範本、相關 Review／依賴／SQLite 及單一範本 Electron E2E，沒有重跑付費代理或全套。先完成 18 項相關測試，再針對新增的審查交接 gate 重驗 4 項（含 1 項新測試），共 19 個不同案例。真實 Git／Worktree／產物／快照測試配受控 Adapter，覆蓋回修後重新審查、兩家實際平行 fixture 任務、契約發布／讀取、測試失敗、缺少產物／結論、過期來源、回修預算、取消、檢查後繼續與備份／重啟不重播。最後四項重驗包含完整回修與平行交叉審查的真實 Git 路徑。

測試發現停止可發生在工作區 capture 期間，已在進入 Adapter 前重新檢查取消；相應取消與暫停恢復通過。跨代理案例有多次真實 Git／Job 啟動，逾時調整為 120 秒，並用同步障壁驗證兩個獨立 Agent 的重疊執行，沒有拿測試延遲推算並行。

Electron E2E 使用真正 UI／IPC／SQLite 檢查自訂、角色與步驟編輯、複製刪除、重啟與不合法啟動，打包版另驗證同一路徑。Typecheck／修改檔案 ESLint 通過。測試 Adapter 與 command-sandbox fixture 不代表三家原生 Runtime 或 OS 沙盒新驗收；打包 E2E 不產生模型回合。確切報告、範圍與 app.asar／守護器雜湊見 release/0.12.0/WORKFLOW_VALIDATION.json。

以下保留 v0.11.0 歷史紀錄。

## 系統通知：本次限定範圍（2026-11-04）

Typecheck、修改檔案 ESLint、4 files／22 個相關單元測試、單一通知 Electron E2E 通過。涵蓋全部／只批准／勿擾、設定保存、待處理去重／已讀、歷史不補發、視窗恢復、跨聊天室導航與初始化競態。E2E 的 OS 投遞端為受控替身；真實打包煙霧另呼叫 Windows API，確認 Notification.show 的 show 事件、原生 setOverlayIcon、真實 WORKSPACE_NOT_READY 任務失敗的通知及勿擾阻擋，模型回合為零。未人工點擊 OS 橫幅；跳轉鏈由原生啟用處理器單元測試及真實 Electron E2E 覆蓋。最終二進位雜湊與結果見 release/0.11.0/NOTIFICATION_VALIDATION.json。

依使用者要求，本次未重跑全套或付費 Agent Live；以下 v0.10.0 紀錄僅屬歷史證據，不能視作 v0.11.0 全功能重新驗收。

## 真實候選版協作與安裝升級（2026-11-04）

- Typecheck／ESLint、24 files／134 tests、9 真正 Electron E2E 通過；另三輪關閉／重啟共 6 項回歸通過。涵蓋結構化結論缺失、提交後失敗、明確重試、指定／最新審查者、空白與同 Agent 不跳過，以及聊天室選取／過期回覆。
- 同一真正打包版執行 Codex 結構化指派 Claude、獨立 Worktree 改檔；Codex 原生發布不可變契約，Claude 實際 read_artifact，Host 記錄來源產物／Commit。
- AGY 在兩個唯讀快照上透過 submit_review 批准，Runtime 完成；兩份整合快照實際測試成功，合併 tree 與測試 tree 一致，再測最終主專案及額外跨模組斷言。這條明確手動驗收的測試標為 host-approved；原有自動專案回歸另驗證原生沙盒，沒有混稱。
- 驗收早期腳本誤拒絕 Claude 檔案工具，已修正白名單。AGY 曾嘗試被禁止的 dir 並正確失敗；提供確切快照檔案清單與唯讀工具指示後成功。未放寬原生沙盒、允許任意指令或把被拒絕操作當成成功。
- 全部原生工作及測試完成後，截圖遇到兩個「活動」按鈕；修正選擇器，另用 verifier 嚴格比對相同 App／守護器、已保存任務與 Review、實際合併 Commit／tree，並重新測試主專案後生成通過報告。報告保留 priorScreenshotError 與復核標記，不偽稱第一次腳本正常結束。
- 真正 NSIS v0.9.0 安裝、升級至 v0.10.0、卸載成功。一次性 Profile 聊天／主題恢復、不重播，升級前後真正 Codex OK 且延續相同原生 Session。比對安裝 payload 與候選 EXE 的 app.asar／守護器 SHA，驗證 Registry 與固定卸載路徑後僅卸載測試副本。
- 圖片、聯網、模型／背景、明確恢復、自動專案、AGY Host、三家 OK、故障及 Portable 已重新用候選版實測；官方額度的前景定時刷新成功且沒有模型回合。12 份報告版本／App／守護器雜湊已全部通過 Manifest 核對；Portable 與升級 Installer 也比對實際交付檔案雜湊。Production audit 0；dev graph 25 moderate。

所有歷史 v0.9 與更早內容如下；本版不沿用舊二進位通過 Live gate。仍無獨立安全稽核／全 Windows VM 矩陣／簽章。

## Windows 程序歸屬與故障復原（2026-11-01）

最終 Typecheck／ESLint、**21 files／121 tests**、**8 真正 Electron E2E** 通過。Production npm audit **0 vulnerabilities**。測試未要求付費帳號；以下 Live 另外使用已登入的三家原生 Runtime，與 fixture 結果分開。

最終 **10 份打包驗收報告** 全數通過：三家 OK、模型／背景、圖片、網路、明確恢復、自動專案／整合、AGY Host、程序故障、官方額度與真正 Portable。Codex／Claude 前景定時刷新已實測，AGY 無官方 headless 查詢且明示 unavailable；額度驗收沒有模型回合。NSIS x64／Portable 已產生；Portable 的資料位置、聊天重啟與離線手冊通過。Manifest 同時驗證 app.asar、外部守護器與 Portable launcher；公開原始碼白名單及 SHA 位於 release/0.9.0。開發相依掃描仍為 25 moderate，沒有強制改動相依 API。

新增 Windows Job／App keeper 的 6 項真實 OS 測試，及 bounded NDJSON／所有 pending RPC 同時失敗／額度關閉測試。真實 EXE 的 Main 與 Codex Runtime 單獨終止、WIP 保留、重啟不重播、另一位原生 Claude 回覆 OK、metadata 中關閉與 Renderer crash 已驗證。正式最終二進位結果由 BUILD_MANIFEST 核對 app.asar 與外部守護器 SHA。

回歸定位並修正提前關閉時 loadURL 中止誤觸啟動錯誤對話框；連續四次初始渲染關閉／重開 E2E 驗證。Playwright Launcher 不等於 Main，故障注入驗證 App 自報 PID＋建立時間，以 OS signalled state 確認退出。Git 密集整合測試因實際每次經守護器的啟動成本超過舊 15 秒，採 60 秒並保留原有精確快照／衝突斷言。

本輪全套測試／Live／發行結果以最終 Manifest 為準；下列 v0.8.0 歷史紀錄不當作新版二進位的驗收。Job 不宣稱檔案／網路隔離，仍缺完整 Windows VM／長時間壓力／磁碟錯誤矩陣。

最終同一 app.asar（ba2c36947320…）與守護器（6552d4c2470f…）的三家聊天室 OK、模型／強度／長背景、圖片／原生 Session、聯網、自動改檔／沙盒測試／整合、明確恢復／依賴、AGY 有界讀取與故障驗收均已重新通過。Live web 腳本補上初始專案完成選取及新房間就緒等待；初始化尚在進行時應等待選取完成，若切換到其他房間可透過既有「前往批准」回到正確房間，不批准錯誤操作。Portable harness 改為等待真正 BrowserWindow 建立，不把開放 CDP 當成視窗已存在。這些為驗收時序修正，不冒稱供應商能力有改變。

## AGY Host 續接與執行中補充訊息（2026-11-01）

- Typecheck、ESLint、**20 files／110 tests**、**7 Electron E2E** 通過。新增三種 Host 資料續接、只發佈最終答案、來源 ID 不落內容、最多三次／重複快取、混合副作用拒絕、缺少／晚到／亂序 num_turns、原生 Session 漂移、超量結果、Host 等待與原生續接取消／退出／dispose、共享預算與持久化數量測試。
- 真正官方 agy 1.4.12 兩回合探針讀出 Host 未知隨機碼；最終 EXE 真實聊天室四原生回合完成 search_context → read_context → read_artifact，三個碼不在初始背景；搜尋摘要沒有後段碼，必須再讀完整訊息；契約在另一個未整合 Worktree，由 Host 生成並以確切 Commit 發佈，沒有偽稱其他 Agent 撰寫。來源訊息 ID／契約 Commit 活動記錄吻合，只有一則最終公開答案。
- 真實第二原生回合中 Stop，工作 cancelled；重啟保留四回合／取消數量且不重播。`.local/live-agy-host/packaged-report.json` 綁定 app.asar，發行 manifest 另強制驗證本證據，不能用協定 Fixture 或舊版報告代替。
- 修復 UI 在工作執行中隱藏 Send：現在可同時發送補充／筆記與停止，訊息仍經原有路由與工作區佇列。Live 透過正常 UI 在批准前貼上未知資料證明原生背景準備後也可補充。
- Live 腳本曾在重啟視窗尚未完成載入時提前關閉，導致自己的測試視窗尚未完全退出就重建，遇到 DLL 鎖。只清理已核對路徑／一次性 Profile 的測試程序，沒有終止不明或使用者程序；補上 DOM／介面就緒等待後，最終腳本與視窗已完整正常退出。未把只印出 PASS 而尚未退出的舊報告當成最終證據。
- 最終版其他打包回歸、Windows NSIS／Portable 與 SHA 以 BUILD_MANIFEST 為準。Portable 使用官方支援的 ZIP payload，避免原 LZMA 封包加入 helper 時再次完整壓縮；較大輸出是取捨，實際啟動／旁置資料／手冊／重啟仍須驗證。

以下為 v0.7.0 及更早版本歷史紀錄。

## 自動專案／Worktree／原資料夾整合（2026-11-01）

- strict TypeScript、ESLint、**19 files／94 tests**、**7 真正 Electron E2E** 通過。包含安全初始快照／原 staging 保留、中文空白路徑、敏感內容、Worktree 重用／搬移／遺失恢復、碰撞、WIP、使用者主專案修改、衝突、失敗測試、Review／filter 保護與不重跑原生回合的整合重試。
- 最終 EXE 真實 Codex 建立 Hello World，未手動初始化 Git，產物在使用者選定資料夾；額外以 Edge headless 真正呈現 body 驗證。這項瀏覽器檢查來自 Live harness，不把 Host 靜態格式檢查冒稱功能測試。
- 真實 Claude 原生讀取既有原始內容，再寫出同值驗證檔，安全測試後回到原資料夾；原內容、假 `.env`／私鑰檔仍保留，Git 歷史沒有假憑證。
- 無 @ 的普通需求真正啟動三家，各自獨立持久 Worktree 改一個檔案。Host 序列化四份確切整合快照，官方無模型 command/exec sandbox 中實際 Node 斷言通過，主資料夾含三家成果。
- 關閉／重開 EXE，三個 Worktree 路徑相同；Codex 原生回合讀出先前 WIP 隨機碼，原 bytes 保留，WIP 沒有被自動提交／合併到主要資料夾。證據 `.local/live-automatic/packaged-report.json`。
- Live 找到並修復上次主分支整合後，Agent 分支未真正同步卻被 seen-head 快取略過的問題；新增同一 Agent 連續兩次交付及舊 metadata 的回歸測試。
- 官方 Windows sandbox probe：允許範圍內寫入，外部測試檔拒絕 EPERM；巢狀直接 Node 子程序也被拒絕，預設 `node --test` 失敗會停止合併。Live 生成專案明確採 `node --test --test-isolation=none`，仍保留 OS 沙盒，不更動使用者原測試、不降級。六回合曾碰到正式 200k 本機預算，失敗報告保留；只提高一次性驗收 Profile 至 1m 後完成。
- 同一最終 app.asar 重新通過模型／思考強度與長背景、三家獨立圖片／Session resume、三家原生網路、明確手動 WIP 復原、三家聊天室 OK、Codex／Claude 官方額度前景刷新。Recovery Live 明確關閉自動整合以驗證手動 WIP 路徑；自動整合的重啟由上一項獨立驗證。
- 本輪重新 npm audit：production **0**；完整 dev graph **25 moderate**，不強制覆蓋不相容 major。未做獨立完整安全稽核或全 Windows 版本矩陣。
- 18 章離線 HTML 手冊：Edge 桌面／窄版，章節連結零失效、無水平溢出，已視覺檢查。NSIS／Portable 最終產物、啟動驗收及 SHA-256 見 BUILD_MANIFEST；未簽章。完整 installer 安裝／升級／卸載 roundtrip 與 peer-review 跨代理開發仍以早期歷史證據區分，不冒稱本版重做。

以下為先前版本歷史證據；不得用舊雜湊當成本版驗收。

## 帳號額度新增驗證

最終 v0.6.1：Typecheck、ESLint、**18 files / 74 tests**、**6 Electron E2E**、Windows NSIS x64 打包均通過。真正 EXE 讀取 Codex／Claude 額度，觀察 Renderer 前景 45 秒自動刷新，沒有啟動模型回合；`.local/live-quota/packaged-report.json` 綁定最終 app.asar。六個 Live 報告（模型／背景、額度、圖片、網路、復原、三家聊天室 OK）均已用同一份 v0.6.1 二進位重新執行通過。安裝包：`release/0.6.1/AgentHub Setup 0.6.1.exe`，未簽章。

已實際透過官方 Codex RPC 與 Claude Code get_usage 讀到帳號時段／剩餘比例，不發送模型回合。AGY 1.4.12 headless idle 與最小真實 OK 回合確認不執行 statusLine，故未宣稱支援自動帳號額度。新增快取合併、過期／錯誤保留、未知百分比、認證模式隔離、metadata 隱私與 control correlation 測試。最終測試數量及打包證據以 BUILD_MANIFEST 為準。

## 聊天室三家模型選單與背景系統（2026-10-31）

- Typecheck、ESLint、**17 files / 65 fixture tests**；**5 Electron E2E**。新增原生 model/effort 傳參、Claude catalog 丟棄 account metadata、聊天室選擇與釘選重啟保存、繁中超過舊視窗檢索、平行晚完成回覆游標、失效釘選與同室來源保護。
- 真正 packaged UI 選 **gpt-6.1-sol/high、gpt-6-astra/medium、Claude Opus/medium、Sonnet/low、Gemini 4 Argon/medium、Gemini 3.8 Flash/high**，各自原生回覆測試標記。Codex 實際回報的 model／reasoningEffort 與選擇相符；Claude／AGY 使用原生 model/effort flags，init 回報模型。報告 `.local/live-models-context/packaged-report.json`；不把 Mock 或一般 Chat API 當 Runtime 證據。
- 同一打包流程重啟後保留聊天室選擇；在 private native session 從未看過的 1600 則生成歷史中，依繁中「登入驗證規格」檢索，真實 Astra 正確回答隨機碼，來源紀錄含該舊訊息 ID。背景不超過 24k 字元。
- 本機 5000 則 SQLite 基準：首次生成／索引約 439 ms，30 次查詢中位數約 0.088 ms，背景組裝約 0.83 ms、9248 字元；只代表本機 Node 24 SQLite、此生成資料，未冒稱 Electron 全介面 FPS 或所有磁碟／Windows 版本。`.local/context-benchmark/report.json`。
- 三家圖片、原生聯網、@All OK、暫停／重啟復原的最終回歸與所有 Live 報告必須綁定同一 app.asar；以 BUILD_MANIFEST 為準。付費 SDK/API 未做 Live，已測的是本機 Claude CLI 自有登入。
- `release/0.6.0/AgentHub Setup 0.6.0.exe`，未簽章，Schema 6；完整 installer install/upgrade/uninstall roundtrip 仍是早期版的歷史紀錄。

剩餘限制與官方來源見 MODELS_AND_CONTEXT；以下是先前階段歷史證據。

## 任務交接與復原（2026-10-31）

- strict TypeScript、ESLint、**15 files / 54 fixture tests** 通過。新增部分檔案／用量保留、重試依賴解鎖、轉派不同 Worktree、批准取消、timeout、遺失依賴、鏈結循環／跨室拒絕和重啟保護。用量中止現在應為 failed，原測試的 cancelled 預期已修正，沒有放寬預算檢查。
- **4 Electron E2E** 通過，含最終打包 EXE、圖片與 SQLite 重啟／備份還原。Migration 5 保護新嘗試語意，舊 Schema 可遷移，新版資料不得降回 v0.4.0 開啟。
- 真實 packaged recovery：Codex 原生工具建立 partial.txt → 在原生命令批准前 Pause → 切換聊天室驗證批准提醒 → 關閉／重啟 App → 檔案位元組不變、沒有自動重播 → 明確恢復同一原生 Session → 新嘗試完成 → Claude 下游仍須額外人工恢復，才依最新上游嘗試啟動。四個 Task IDs 與原訊息保留，見 `.local/live-recovery/packaged-report.json`。
- 首次 Live recovery 觸及產品預設 200k Token 上限，正確顯示 failed 並阻止下游；SQLite 證明兩嘗試用量未重複計算。保留 `.local/live-recovery/budget-stopped-report.json`，成功重跑只把生成測試 Profile 的限額設為 1m，正式預設沒有改變。
- 本版另外重跑三家真實圖片辨識／原生 Session resume、原生網路工具及 UI @All 三個 OK。所有最終 Live 報告以 app.asar SHA-256 綁定實際打包程式，manifest 拒絕舊版二進位證據。
- 本輪實際版本重新查核為 Codex 0.166.0、Claude Code 2.1.296、AGY 1.4.12，見 `.local/v050-runtimes.json`；未讀取或複製登入 Token。
- Production audit 為 0；開發依賴仍有先前記錄的 25 moderate minimatch 公告。沒有以不相容 major 覆蓋強行清零。
- NSIS x64：`release/0.5.0/AgentHub Setup 0.5.0.exe`，未簽章。本版沒有重做完整 installer install/upgrade/uninstall roundtrip，該歷史證據仍為 0.1.1→0.2.0。
- AGY 真實 structured-output 長回覆探針只有一個 DONE（7015 字元）而無 ACTIVE 增量，不宣稱逐 Token 串流完成。公開訊息與協作仍等待原生最終 Schema 驗證，沒有顯示私有推理。詳見 TASK_RECOVERY。

以下保留前版紀錄；本輪交付的檔案與驗證雜湊以 BUILD_MANIFEST 為準。

## 原生能力修復（2026-10-31）

- Typecheck、ESLint、**14 files / 46 fixture tests**、**4 Electron Playwright tests** 通過；其中包括真正打包 EXE 的 secure preload。Fixture 不算真實 Runtime 驗收。
- 實際 npm audit：production **0**，完整開發工具鏈 **25 moderate**。沒有強制覆蓋不相容 minimatch major。
- 三家真實 Runtime 再次完成實際寫檔、structured progress、同原生 Session 恢復及讀出 Host 改寫的新 nonce，見 `.local/live-report.json`。
- 真實 agy 原生 read_file 讀取生成 PNG 的隱藏六位數及綠色底，完全符合。這證實 text-only stdin 不等於不能透過原生工具看圖，修復 v0.3.0 過度限制。探針報告 `.local/agy-vision-probe/report.json`；本輪 detect 版本是 **1.4.12**，前版歷史測試是 1.4.11，未假設安裝版本不會更新。
- 最終打包版的圖片、網路工具與 @All OK 驗收報告分別在 `.local/live-images/packaged-report.json`、`.local/live-web/packaged-report.json`、`.local/packaged-team/report.json`；每份綁定實際 app.asar SHA-256，manifest 會拒絕不同二進位的證據。圖片是三個獨立聊天室、不同隨機碼/底色，原始檔刪除後仍可辨識，原生 Session resume 與暫存清理需成功。
- 網路 Live 只使用 example.com 公開頁：Codex native live web_search、Claude WebFetch、AGY search_web。曾因測試只接受 read_url 工具名稱而失敗；實際事件顯示 AGY 使用 search_web，且明確回報未提供 read_url_content，已依真實能力修正測試，而非冒稱直接抓取。另以 exact command `curl.exe -I https://example.com/` + domain allowlist 真正取得 HTTP 200，見 `.local/agy-command-web-report.json`。
- Live harness 亦修正同時出現兩張批准卡的選擇器，以及新聊天室需要實際選取才能看到該室批准的流程；透過真實 UI 切換與批准後重新通過，沒有以跳過權限解決。
- NSIS x64 輸出 `release/0.4.0/AgentHub Setup 0.4.0.exe`，尚未簽章。本版不宣稱重新完成前版的實際 install/upgrade/uninstall roundtrip，也沒有新增完整 Windows 版本矩陣。

目前證據雜湊見 BUILD_MANIFEST；工具批准與已知 native 差異見 CAPABILITIES。以下為先前版本的歷史紀錄，舊 AGY 圖片拒絕行為已被 v0.4.0 取代。

## 圖片階段更新（2026-10-31）

- TypeScript/Lint 通過；Vitest **13 files / 40 tests**；Electron E2E **4 tests**，含原檔刪除後預覽／匯出／重啟、回覆再附加、剪貼簿邊界與圖片 @All 原子拒絕。
- 真實 Codex/Claude 圖片輸入已在實際 App 辨識圖片隨機文字；最終打包版使用不同聊天室／不同隨機數字及顏色，防止從另一位 Agent 的公開回覆抄取答案。報告 `.local/live-images/packaged-report.json`；詳見 IMAGES。
- v0.3.0 NSIS：`release/0.3.0/AgentHub Setup 0.3.0.exe`。Schema 3→4 舊訊息保留與完整圖片 SQLite 還原通過。先前真正 Installer roundtrip 為 v0.1.1→v0.2.0，沒有冒稱是 v0.3.0 安裝 roundtrip。
- Production audit **0**；完整 dev graph **25 moderate**，為 minimatch GHSA-g3hv-75wg-m249 的舊 API 開發相依。未強制替換不相容 major；後續需獨立驗證工具鏈相容更新。
- WebP 測試曾定位 Electron nativeImage 解碼失敗；改用非同步 Sharp/libvips 後，PNG/JPEG/WebP 在開發版與實際打包 EXE 的完整附件 E2E 都通過。Native module/DLL 與 LICENSE 已包含於安裝包。

以下保留 v0.2.0 核心真實驗收紀錄；原有流程另以新版單元/E2E 與打包版檢查回歸。

2026-10-31，Asia/Taipei。Node 24.20.0、npm 11.19.0、Git 2.55.0.windows.5、Electron 45.1.0、Windows build 26300。

| 檢查 | 實際結果與證據 |
|---|---|
| strict TypeScript / ESLint | 通過 |
| Vitest | **12 files / 34 tests passed**；不需付費帳號 |
| Electron Playwright | Foundation 與 packaged smoke 通過；新增 240 訊息分頁/全歷史搜尋/虛擬化、附件邊界、焦點、備份還原重啟測試通過 |
| Production build / NSIS x64 | 已產生 v0.2.0；最終檔案雜湊見 BUILD_MANIFEST.json |
| 真正打包 Codex | npm-only PATH；原生 codex.exe；initialize、thread/start、turn/start、delta、turn/completed；聊天室 OK。`.local/codex-debug/fixed-packaged-report.json` |
| 真正打包三家 | Renderer→IPC→Orchestrator→三家官方 Runtime，UI @All 各自回答 OK。`.local/packaged-team/report.json`、`three-real-OK.png` |
| 三家真實工具/Session | Codex 0.166.0、Claude Code 2.1.296 自己訂閱、AGY 1.4.11；三家各自寫檔、structured progress、native resume、讀出 Host 在兩回合間寫入的新隨機 nonce。`.local/live-report.json` |
| 真實跨代理回覆 | Codex→Claude→AGY→Codex，5 個原生回合、真正獨立 Worktree 改檔、Codex 確認收到兩方回覆。`.local/collaboration-report.json` |
| 真正 Coding/Review/整合 | Codex/Claude 平行新增功能與測試；Codex 原生 publish_artifact；AGY 唯讀精確 Commit Review；兩份 integration snapshot 各通過測試後合併，最後實際原專案再測一次。`.local/coding-report.json` |
| Claude SDK/API Live | **not_run**，沒有 API Key；本機訂閱 CLI 已通過，兩者不混淆 |
| 安裝/升級/卸載 | **全部通過**：真正 NSIS v0.1.1 安裝 → 保存筆記 → v0.2.0 升級 → 原筆記與 Migration 驗證 → 只卸載自建測試安裝。`.local/installer-roundtrip/upgrade-report.json`、`ownership.json` 最終 phase=uninstall；測試 EXE 已移除，Profile 保留 |
| AGY 確切 Shell 授權 | 真正 native sandbox 執行已批准的固定 `echo AGENTHUB_COMMAND_OK`，驗證 run_command completed 與實際 stdout。`.local/agy-command-report.json` |
| Production dependency audit | `npm audit --omit=dev`：0 已知弱點；不代表完整安全稽核 |

Vitest 涵蓋 Migration/持久化/不重播、增量游標、Windows junction/根目錄重導向、NDJSON framing/RPC timeout/程序生命週期、三家 fixture 合約、軟拒絕、可恢復的 file-not-found、每工作區序列化/跨代理並發、手動批准/停止、turn/depth/fanout/用量限制、真正 Git isolation/conflict/漂移、快照測試 gate、可恢復 Revert、初始 Commit 檔案雜湊重查、不可變契約、Review 快照/過時修正拒絕、SQLite restore safety copy、MCP bearer/origin/cancel 與唯讀邊界。

Electron 測試只替原生檔案對話框指定一次性 fixture 路徑，不 Mock Renderer/Main/DB。Live 測試使用真實本機 Runtime 與帳號；測試工具的批准只允許已授權的一次性 fixture 改檔/讀取。Fixture 測試成功不算 Live。

## 本次另外定位的真實問題

- Windows npm Codex：`.cmd` shell:false 可 EINVAL，已解析真正 npm native executable，包含 PATH 與 APPDATA fallback。另有缺少 Worktree 的 preflight 失敗，原本沒有聊天室錯誤；現在所有 preflight 先保存失敗回覆。
- AGY native Windows scoped rules：去掉磁碟代號的絕對路徑規則造成 soft-denial；改用官方 cwd-relative `read_file(.)`/`write_file(.)` 並由使用者逐回合批准。沒有修改全域設定或跳過權限。
- AGY Review：原 Adapter 將所有 `tool_info.error` 都視為權限拒絕。真實 NDJSON 證明缺少檔案是 `TOOL_ERROR: file does not exist`，Runtime 可繼續讀取既有檔案並誠實回報。修正為顯示工具錯誤，只有真正的 permission/denial 仍令整回合失敗。新的 unit regression 與真實 Review 重跑通過；保留先前失敗紀錄。

## 誠實範圍

沒有聲稱：所有 Windows 組態、每種語言工具鏈、Claude API 金鑰模式、完整多模態圖片輸入、完整第三方版本矩陣、無限長時間負載、獨立安全稽核、程式碼簽章或線上 CI 已驗證。詳細未完成項目見 IMPLEMENTATION_STATUS。

受控驗收報告均在 `.local`，不提交使用者帳號資料或原生 Session 檔案。診斷 JSONL 僅含 metadata；Live 報告的對話與程式碼均來自本次生成的無秘密 fixture。
