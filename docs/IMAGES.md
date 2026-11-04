# Native image attachments — v0.4.0

## 使用方式

用 Composer 的「附加專案檔案」、拖放專案內圖片，或將剪貼簿圖片貼入輸入框。選 Codex、Claude、Antigravity 或 @All 並送出。只存本機筆記也可保留圖片。訊息縮圖可展開原圖，回覆訊息會把附件重新放進可移除的 Composer 預覽。

格式為靜態 PNG/JPEG/WebP。每張不超過 5 MiB、4096px/邊及 8MP；每則最多 4 圖/8 附件、總共 12 MiB。GIF、動畫與其他圖片格式明確拒絕；UTF-8 文字附件仍支援 128KB。多個文字附件展開後有 256k 字元上限。

Antigravity Headless 的 stdin 不接受 image blocks，但其原生 `read_file` 工具可以將本機圖檔交給模型辨識。v0.3.0 的全面拒絕是過度限縮，v0.4.0 已移除。真正 agy 在 Windows sandbox 中讀出只有像素包含的隨機碼及底色，並非 OCR 模擬或 Gemini API 替代；本輪 Runtime 偵測版本為 1.4.12。

## 實作與安全

Main 驗證 canonical project path/junction，從有大小上限的 file handle 讀取，先辨識受支援 magic bytes，再檢查尺寸/動畫與原生解碼。Renderer 不可直接讀任意路徑。剪貼簿只在使用者貼上時以 Electron 45 的 ClipboardItem/Blob API 讀取；不持續監看剪貼簿。

Electron nativeImage 的 WebP 解碼在實測失敗，已改用 Sharp/libvips 非同步解碼及縮圖；原檔不轉碼。PNG/JPEG/WebP 均在實際 Electron 與打包 EXE 通過匯入/縮圖測試。Windows native addon/DLL 明確 unpack，離線啟動不依賴開發目錄。第三方元件授權見 THIRD_PARTY。

Migration 4 使用 SQLite attachments BLOB 保存原檔，JSON metadata 包含專案歸屬、大小、MIME、像素、SHA-256 及小縮圖。訊息與 Task 保存 ID；每次傳送重查專案與雜湊，不依賴原路徑仍存在。Agent 的 structured collaboration 可明確帶 attachmentIds，遵守原有路由/批准/預算及接收者能力檢查。歷史背景只有引用，沒有無限制重送原始圖片。

Codex 將 DB 原檔實體化到該回合專用暫存資料夾，傳官方 `localImage` input，程序終止後只刪除本回合檔案與空資料夾。Claude CLI 送出原生 stream-json user image/source/base64 blocks；SDK/API 用 typed SDKUserMessage streaming input。沒有改成一般 Chat API。模型若不支援圖片或帳號不可用，照原生錯誤顯示失敗。

Antigravity 經逐回合批准後，把相同 DB 原檔以 `wx` 建立於指派工作區內隨機 `.agenthub-images-*` 資料夾，附上明確原生讀圖指示；該資料夾另有原生禁止寫入規則。必須收到每張圖片成功原生讀取的工具事件，否則以 `IMAGE_NOT_READ` 失敗，不能把猜測當辨識成功。程序結束後只 unlink 本回合檔案及 rmdir 空資料夾；canonical 邊界檢查防止清理時跟隨替換的 junction。突發系統崩潰可能留下暫存資料夾供人工檢查，不會遞迴刪除使用者檔案。圖片會傳至原生供應商；檔名不是辨識結果。

JSON 匯出含 Base64 原檔；Markdown 使用 data-image URI（外部 Markdown viewer 需支援 data URI）。匯出圖片總量限制 32 MiB，更多內容使用 SQLite Backup。SQLite 備份/還原包含完整圖片 BLOB；不包含原生供應商 Session 或 Git Worktree。清除歷史會刪除不再被其他訊息/Task 引用的附件；移除未送出預覽會清掉該草稿。手動維護可清除一天前未引用草稿。

診斷 JSONL 沒有 Base64、圖像內容或 Prompt；圖片會依使用者選擇傳給相應原生供應商，圖片資料作為聊天內容儲存在本機 SQLite，資料庫本身不加密。

## 驗收

- `tests/attachments.test.ts`：刪除原檔仍可用、SQLite backup/restore、migration 3→4、大小/尺寸/格式/跨專案/完整性、三家附件路由、原生訊息格式、暫存清理、已引用保留/草稿刪除。
- `tests/claude.test.ts`：官方 SDK 圖片走 AsyncIterable SDKUserMessage，而非只有檔名的字串；這是 Mock SDK 合約測試。
- `tests/e2e/attachments.spec.ts`：真實 Electron/SQLite/IPC 的縮圖、原圖、刪除來源、JSON 原檔匯出、重啟、回覆再附加與三家路由；原生檔案對話框與 OS 剪貼簿邊界指定測試 fixture，沒有冒稱驗證所有 OS 剪貼簿格式。
- `scripts/live-images.ts`：三家真實 Runtime 各自在獨立聊天室看不同隨機數字/底色。數字不放在 Prompt 或檔名；匯入後刪除原始檔，Codex/Claude 禁止工具，AGY 只用其原生讀圖工具，必須讀出正確數字與顏色，再驗證原生 Session resume 與暫存清理。打包版以 `AGENTHUB_IMAGES_PACKAGED=1 npm run test:live-images` 驗收，報告在 `.local/live-images/packaged-report.json`，以 app.asar SHA-256 綁定實際版本。

官方依據：[Codex turn image inputs](https://learn.chatgpt.com/docs/app-server#turns)、[Claude SDK streaming images](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)、[Antigravity text-only stream input](https://antigravity.google/docs/cli/headless/)、[Electron ClipboardItem API](https://www.electronjs.org/docs/latest/api/clipboard)。
