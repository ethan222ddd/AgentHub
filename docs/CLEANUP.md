# 工作區清理 — 2026-11-02

## 2026-11-05 v0.12.1 本機打包後

原始碼已由 Git 追蹤（基準 `50090f7`），所以舊版打包不再是唯一的原始碼來源，本輪只保留最新交付。

- **移除**：`release/` 下 0.2.0～0.11.0 的安裝檔、Portable、原始碼 ZIP、離線手冊、Manifest 與 SHA256SUMS，約 1.2 GB。0.12.0 的版本在清理當下仍在執行，所以先保留，關閉後即可刪除；它旁邊的 `AgentHubData` 是空的啟動測試資料（0 個專案）。
- **移除**：`.local` 內可重建的 E2E 測試 Profile、截圖與暫存、過往回合的建置／安裝日誌，以及已收進維護證據 ZIP 的重複檔案，約 257 MB。`test-results/` 一併清除。
- **保留**：五份 `maintenance-evidence-v*.zip`、兩份 cleanup 紀錄、未收進 ZIP 的通知／流程驗收 JSON，以及 `.local/release-metadata/0.12.0/`（0.12.0 的 WORKFLOW_VALIDATION.json 與 SHA256SUMS，雜湊已核對）。
- **遺失紀錄**：`release/0.11.0/NOTIFICATION_VALIDATION.json` 沒有收進任何證據 ZIP，已隨 0.11.0 一起刪除，無法復原；該輪結果摘要仍在 IMPLEMENTATION_STATUS。
- **新版交付**：`release/0.12.1` 只保留安裝檔、Portable、離線手冊與 SHA256SUMS。重複的 `win-unpacked`、未使用的自動更新檔（blockmap、latest.yml）與 builder 除錯檔已移除；Live 腳本需要解壓版時，以 `npm run package:dir` 重建。實際 Portable 煙霧驗收報告保存在 `.local/release-metadata/0.12.1/portable-smoke-report.json`。
- **未變更**：`dist`、`.native`、`node_modules` 保留供開發使用。沒有刪除已安裝的 App、官方 CLI 帳號資料或工作區外的檔案。

v0.2.0～v0.11.0 的原始碼只剩 Git 基準 `50090f7` 之前的維護證據 ZIP，不再有完整快照。以下為較早的清理紀錄，其中的保留清單已不代表目前磁碟狀態。

## 2026-11-04 v0.10.0 發行後續

本輪維持只保留最新 v0.10.0 安裝／Portable／原始碼／手冊與 Manifest；v0.9.0 安裝檔已用於真實升級驗收，驗收後移除重複的舊版二進位，歷史原始碼與發行 metadata 保留。大型解壓版、Portable 測試複本、SQLite 測試 Profile、Git 測試工作樹及測試結果暫存可重建並已清理。

`.local/maintenance-evidence-v0.10.0.zip` 保存本輪 12 份原生／打包報告、升級／卸載所有權與 Session 基準、完整測試結果、安全掃描、必要日誌與畫面、實際整合的生成 fixture 原始檔及原始 checksum 清單；不放入公開原始碼 ZIP。清理紀錄見 `.local/cleanup-2026-11-04.json`。既有 v0.9.0 維護證據封裝不變。

保留小型 `.native` 守護器建置快取及 `dist` 供繼續開發／`npm start`，以及 `node_modules`。公開原始碼封裝現在會在完成或失敗後清除自己的安全 staging，不再累積 source-* 複本。以下大小為 11 月 2 日歷史紀錄，最新以本輪 cleanup receipt 為準。

清理的是 AgentHub 開發工作區內的產物。沒有刪除已安裝的 App、各家官方 CLI／帳號資料或工作區外的專案。

| 項目 | 大小 |
| --- | ---: |
| 清理前工作區 | 20.753 GiB |
| 清理後工作區 | 約 1.726 GiB |
| 移除的檔案大小合計 | 19.027 GiB |
| 磁碟可用空間實際增加 | 18.886 GiB |

檔案長度合計與實際釋放空間會因檔案系統配置、連結及其他程序的磁碟活動而不同。

## 保留

- `src`、`tests`、`scripts`、`docs`、`assets`、CI、設定、授權與 npm lockfile。
- `node_modules` 約 1.13 GiB，供直接繼續開發使用；沒有手動拆除相依套件中的執行元件。
- `release/0.9.0` 的安裝版、Portable、原始碼 ZIP、離線手冊、原始 BUILD_MANIFEST 與保留產物的 SHA256SUMS。安裝版約 263 MiB，Portable 約 342 MiB，兩者各自可獨立使用。
- v0.2.0～v0.8.0 的原始碼 ZIP 與各自的 SHA256SUMS。工作區沒有 Git 版本歷史，因此這些小型原始碼快照對未來回溯有用。
- `.local/maintenance-evidence-v0.9.0.zip` 約 2.15 MiB：972 筆驗收報告、必要除錯紀錄、代表性畫面、原始 Codex 協定及歷史發行 metadata。每一筆都已和原檔比對 SHA-256 後才刪除原始暫存。
- `.local/cleanup-2026-11-02.json`：清理前後大小、刪除清單、證據封裝雜湊與保護檔案驗證紀錄。此處含本機路徑，維持 `.gitignore` 排除，不納入公開原始碼封裝。

## 移除

- v0.1.0～v0.8.0 舊安裝／Portable 執行檔與重複的 `win-unpacked`。
- v0.9.0 的重複解壓版、安裝中間檔、尚未使用的更新 blockmap 與 builder 除錯檔。
- 一次性 Git Repository／Worktree、SQLite 測試 Profile、Portable 測試複本、瀏覽器快取、重複下載的測試 Runtime、原始碼封裝 staging，以及其餘可重建的 `.local` 資料。
- `dist`、`.native`、`.protocol`、`test-results`。906 份原始協定檔已先收入維護證據 ZIP。

刪除前確認沒有使用此工作區的執行中 App／測試。所有刪除路徑均限制在目前工作區；114 個測試 reparse point 先以不遞迴方式移除連結本身，沒有走入目標。原始碼、設定、歷史原始碼及最新版交付共 168 個保護檔案已核對雜湊未變；本次只另外更新 README 與這份說明。

## 繼續開發與重建

開發：`npm run dev`。它會自動重建 Windows 原生守護器。

正式建置：`npm run build`，完成後才執行 `npm start`。

解壓版：`npm run package:dir`。安裝／Portable：`npm run package:win`。這些指令會重新產生大型建置資料，完成交付後可再清理重複產物。

`npm test` 會重新建立測試暫存。先執行 `npm run build` 才能直接執行 `npx playwright test`；也可使用 `npm run test:e2e`。原生 Live 測試仍需合法登入與對應帳號，不會因清理自動執行。

若要查閱保存的歷史證據，可在工作區執行：

```powershell
Expand-Archive -LiteralPath .local/maintenance-evidence-v0.9.0.zip -DestinationPath . -Force
```

只應解壓這份自行保存的可信封裝。它會恢復 `.local`、`.protocol` 與歷史發行 metadata 的原始相對路徑，但不恢復大型執行檔／測試專案。解壓也會恢復原始完整 SHA 清單，其中包含已清除產物；查閱完可使用現有檔案重新建立對應清單。

`BUILD_MANIFEST.json` 保留原始 v0.9.0 發行及驗收紀錄，所以仍會列出當時存在、現在已移除的解壓版。它不是目前磁碟檔案清單。清理後 `SHA256SUMS.txt` 僅列仍保留的交付。若要重新產生 Manifest，必須先重建解壓版並按腳本要求重新驗證；不要拿歷史報告冒稱新的二進位已通過。舊 installer-roundtrip 腳本重現 v0.1.1→v0.2.0，需要另外從保留的原始碼重建已刪除的歷史安裝檔。
