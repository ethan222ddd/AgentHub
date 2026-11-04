# Windows 程序生命週期與故障復原 — v0.9.0

## 行為

AgentHub 關閉時先拒絕新程序與 IPC 工作，再取消任務、額度／模型查詢與測試，等待受管程序的 `close`，最後關閉 SQLite。JSON-RPC 逾時會中斷整條連線及所有待回覆請求；未知副作用不能自動重試。無效 JSON、超過 4 MiB 的事件（即使沒有換行）及事件消費端例外會明確失敗並回收程序，不再當成正常串流繼續使用。

Windows 使用獨立 .NET Framework x64 守護器與不具名 Job Object，設定 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`。原生 exe 先以 suspended 建立，成功加入 Job 才 resume。啟動資料透過 stdin 傳入，後續 stdio 保留給原生協定，沒有 shell 包裝。每個守護器驗證實際父 PID 與程序建立 FILETIME，防止只憑舊 PID 操作其他程序。僅繼承三個 stdio handle，不繼承 Job handle。

應用程式另有一個先於 App Job 指派建立的 keeper，持有 Job handle 並等待 Main 的實際程序 handle。Main 異常退出時，keeper 關閉 Job，使其後建立且繼承 Job 的一般子孫程序終止。每個 Runtime 的獨立 Job 可單獨取消，不必停止其他 Agent。正常退出的原生根程序也會回收自己的孫程序。Host 不會在下次啟動掃描並殺掉「看起來像 Agent」的既有程序。

SDK 支援的 `spawnClaudeCodeProcess` 也接到相同 supervisor；API-key SDK 路徑僅有契約測試，本機 Claude 訂閱 CLI 路徑有真實驗收。所有高階工具權限維持原先政策，不因加入 Job 而增加。

## 診斷與復原

設定 → 診斷 → 重新整理程序，可查看 Main／keeper PID、受管執行檔名稱、Task／Agent／階段，以及停止狀態。這是即時快照，不是殘留程序掃描；沒有任意 PID 終止功能。日誌保留啟動、RPC 階段、退出及各關閉服務階段，不記錄 argv、stdin、環境值或憑證。日誌位置在設定顯示。

Main／Renderer 異常後重新開啟，未確認完成的任務顯示需人工檢查。先檢查工作區與 Diff，再明確恢復；部分修改、聊天與原生 Session ID 保留。不會因重啟重新執行開發或自動出版未完成修改。Renderer 崩潰時走相同退出流程，而非自動重載並重播工具。

守護器缺少、無法驗證父程序或 Job 指派失敗時，停止啟動 Runtime 並報錯。請重新安裝完整版本、確認安全軟體沒有隔離 `resources/native/agenthub-process-guard.exe`，並檢查日誌；不會降級為無歸屬的子程序。Windows 需要系統 .NET Framework 4.x；從原始碼建置需要 Framework64 的 `csc.exe`，由 `npm run build:native` 自動編譯。生產版不能從目前工作目錄載入替代守護器。

## 實測與限制

`npm test` 的 Windows OS 測試實際建立父／子／detached 孫程序，驗證父程序單獨被終止、根程序正常退出、無關程序存活、Unicode／空白路徑與 argv、即時 stdin、錯誤建立時間、冪等停止。協定 fixture 明確只驗證協定，不能替代原生 Runtime。

`npm run test:live-lifecycle` 使用最終 EXE 與一次性 Profile：真實 Codex 編輯隨機碼檔案後停在結構化跨代理批准，分別終止真正 Main 與該 Task 的守護器；驗證 WIP 保留、重啟不重播、Runtime 失敗可見、另一位原生 Claude 仍回答 OK。另驗證 Runtime 偵測中關閉、Renderer 強制崩潰及診斷 UI。故障注入器只在 tests/fixtures，使用同一個 OS handle 驗證建立時間後終止，未暴露於生產 IPC。Playwright Launcher 與真正 Main PID 可能不同；測試使用 App 自報且驗證過的 Main。退出判斷使用 OS signalled state，避免仍開啟的控制代碼造成誤判。

最終報告以 `app.asar` **及外部守護器 SHA-256** 綁定版本；Portable 還檢查 launcher 雜湊。每次改動任一執行碼都須重新驗收。

Job Object 是生命週期歸屬，不是檔案／網路沙盒。不能保證經 WMI、Windows Service、提權 broker 或既有外部服務建立的程序屬於 Job；App 加入 Job 前已存在的系統 helper 也不是本次宣稱範圍。非 Windows 僅管理直接子程序。原生 Codex／AGY 沙盒仍需各自驗證；Claude Shell 的完整 OS 隔離與所有 Windows 10/11 組態仍未完成。本版不宣稱通過完整安全稽核。

## 主要修改

Windows 語意依 [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)、[CreateProcessW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw) 與 [AssignProcessToJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject)；實作與測試都使用本機原生系統呼叫。

`src/native/process-guard.cs`、`scripts/build-process-guard.ts`、`main/agents/process-owner.ts`、`process.ts`、Codex／Claude／AGY adapters、Claude control/catalog、QuotaService、Main、IPC／shared schemas/types、TestRunner、Settings；新增程序樹 fixture／OS 測試／協定失敗與關閉測試、`scripts/live-lifecycle.ts`、`release-identity.ts`，更新發行及原生驗收腳本。詳見發行原始碼與 BUILD_MANIFEST。
