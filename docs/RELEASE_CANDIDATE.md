# v0.10.0 審查與候選版驗收

更新日期：2026-11-04（Asia/Taipei）。本文件記錄實作；最後驗收結果以 VALIDATION／BUILD_MANIFEST 為準。

## 修正

- 不再用預設退件掩蓋未提交結構化結論的 Reviewer；審查失敗會顯示於聊天、任務與 Review。
- 指定 Reviewer、確切來源 Commit、成功完成的原生回合與最新重審共同決定批准。較新退件／失敗／等待不能被舊批准蓋過；沒有已啟用團隊 Reviewer 時停止自動整合。
- 同一 Agent 可透過獨立唯讀 Session 擔任指定 Reviewer；不能藉由設為開發者本人跳過 Review。
- 明確重試 Review 會綁定新的任務嘗試；舊任務保持失敗歷史。
- 自動審查無法啟動時寫入可見錯誤。原生契約讀取記錄來源產物及 Commit metadata，不記錄原始內容或憑證。
- 聊天室選取以遞增版本處理非同步完成；專案初始化、新聊天室、背景更新及送出回覆不會蓋掉較新的選擇或輸入。
- 取消程序會關閉 Host 端 stdin/stdout/stderr，避免已退出程序的管線仍開啟時，初始化／額度查詢卡住關閉流程。新增控制查詢與額度並行關閉的回歸，並重複執行真正 Electron 關閉／重啟。
- Review 提供有長度限制的確切版本檔案清單，明示使用 list_dir/read_file/grep_search，不會因其他 Worktree 的共享訊息而假設不存在的檔案已同步。沙盒及禁止 Shell 的政策不變。

## 驗證路徑

`npm run test:release-coding` 使用真正 EXE：Codex 結構化指派 Claude 平行改檔，Host 建立檢查點，Codex 發布不可變契約並請 Claude 實際讀取，AGY 對兩個獨立快照提交唯讀 Review，Host 測試精確整合 Commit，明確合併後再測實際主專案。此 Live 的可執行測試是使用者明確允許、僅針對生成 fixture 的 Host 測試，報告標示 host-approved；原有自動專案測試仍保留原生沙盒，兩者不混稱。

`scripts/installer-release-roundtrip.ps1` 分為 install-old／upgrade／uninstall。只在沒有其他 AgentHub 安裝、且目標不存在時建立一次性安裝；之後核對 ownership nonce、版本、固定工作區路徑與 Registry 的精確 UninstallString。驗證安裝檔 SHA，不停止任何使用者程序。舊歷史 `installer-roundtrip.ps1` 保留供重現更早版本。

配合 `npm run test:installed-upgrade -- baseline` 與 `-- upgraded`，使用受管測試 Profile 驗證實際安裝版的聊天／設定保留、不重播工作，以及真正 Codex 在升級前後回覆 OK 並延續原生 Session。沒有使用者密碼／Token 輸入，也不重用第三方 Desktop 的憑證。

執行順序：install-old → baseline → upgrade → upgraded → uninstall。已有使用者安裝時會停止，不覆蓋該安裝來湊驗收。新版 Manifest 同時核對 App、外部守護器、Installer／Portable 與實測報告的版本及雜湊。

## 主要檔案與後續

修改 Orchestrator、AutomaticProjects、Reviews／SidePanel、App、Zustand；新增 shared/reviews、審查／導覽測試、真實打包協作與安裝升級腳本，更新發行清單與手冊。Schema 7 不變。

仍需乾淨 Windows VM／不同權限與安裝位置、磁碟故障／長時間壓力、Claude Shell 的完整 OS 隔離矩陣、開發相依修復、簽章與正式發行。AGY 的公開增量文字與 headless 額度依官方能力提供；不能用模型用量推算帳號餘額。
