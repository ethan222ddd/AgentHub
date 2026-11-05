# v0.13.0 原始規格驗收對照

以下項目以 v0.13.0 的本機驗收逐項核對；已保留的權限政策和環境限制列於下方。相同打包檔的 15 份報告及額外通知實測由 [BUILD_MANIFEST](BUILD_MANIFEST.json) 驗證雜湊，不把合約測試或舊版當成本版 Live。結果與兩種 Windows 證據的差異見 [RELEASE_READINESS](RELEASE_READINESS.md)。

| #   | 原始最低條件            | 實作／本版證據入口                                                                                                     |
| --- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 1   | Windows 啟動            | NSIS、Portable、打包版 Electron E2E；乾淨 Server CI 安裝／重裝／卸載                                                   |
| 2   | 建立／載入本機專案      | 自動初始 Git、重用工作區；live-automatic、Electron E2E                                                                 |
| 3   | 真實 Codex              | 原生 exe App Server JSON-RPC；packaged-team-chat                                                                       |
| 4   | 真實 Claude Code        | 官方 CLI 訂閱、restricted／HTTP hooks；packaged-team-chat                                                              |
| 5   | 真實 Antigravity        | 原生 CLI NDJSON／Sandbox；packaged-team-chat                                                                           |
| 6   | 三家同室                | 共享時間軸、原生 Session 分離；packaged-team-chat                                                                      |
| 7   | @Mentions               | Renderer 路由／接收者；E2E、packaged-team-chat                                                                         |
| 8   | 真實開發工具            | 原生檔案、圖像、聯網；live-images、live-web、live-release-coding                                                       |
| 9   | Orchestrator 跨代理傳訊 | Codex dynamic tool、Claude MCP、AGY structured bridge；live-release-coding                                             |
| 10  | 真正收到並回覆請求      | Codex 委派 Claude、不可變契約交接、AGY 審查；live-release-coding                                                       |
| 11  | 三個獨立 Worktree       | WorkspaceManager、immutable artifact；live-automatic、live-workflow                                                    |
| 12  | 即時狀態                | 事件正規化／Activity、工具／批准、AGY 公開增量；live-agy-stream                                                        |
| 13  | 檔案 Diff               | Git UTF-8／引用路徑、行內評論；diff-review、Git 整合測試、E2E                                                          |
| 14  | 互相 Review             | 指定 Reviewer／確切 SHA／結構化結論＋成功 Runtime；live-release-coding、live-workflow                                  |
| 15  | Stop／取消              | Abort、原生 interrupt、Windows Job 程序樹；live-recovery、live-lifecycle                                               |
| 16  | 危險工具批准            | 原生 Sandbox＋Host gate、手動批准及可選自動政策；permission／native-bridge 測試。使用者保留審查第 2 項政策，見下方限制 |
| 17  | 重啟歷史                | SQLite Migration、FTS、復原不重播；live-recovery、release-soak、installed-upgrade                                      |
| 18  | 整合測試                | 離線 Vitest、Git／真實 SQLite、Electron E2E、可選 Native live；無付費 CI                                               |
| 19  | 安全合併                | 確切整合快照原生沙盒測試、Review gate、衝突／dirty 停止；live-automatic、live-workflow、live-release-coding            |
| 20  | Windows Installer       | electron-builder NSIS／Portable、SHA256、受 CI gate 的 GitHub Release                                                  |

## 範本與新功能

工作流程可增修、角色綁定、DAG dependencies、parallel、交叉審查、有界回修及整合均沿用同一排程器／Review gate。live-workflow 必須由真實 AGY 發契約，Codex／Claude 平行實作、交叉審查及原生沙盒測試通過；Mock 範本測試不能替代它。

模型／思考強度來自原生目錄或明確相容設定；live-models-context 驗證原生請求與重啟保存。官方額度 live-quota 不建立任務或模型回合；AGY 使用 1.5.1+ 獨立 `/usage`，未知欄位不當作剩餘量。通知、工作列、勿擾、批准模式另有 NOTIFICATIONS 說明及相關測試。

## 保留限制

- 使用者已同意以乾淨 Windows Server CI 代替目前不可取得的乾淨 Win10／11 實機；這兩者不可等同。AGY Sandbox 依本機 Windows 相容性而定。
- 使用者指定不修復審查第 2 項自動批准政策。本版保留該政策；Windows Job 是程序所有權，不是完整檔案／網路隔離；Claude Windows Shell 隔離未全面驗證。
- 未簽章、未提供自動更新；Claude API-key SDK 路徑為合約測試，原生訂閱才是本輪 Live 路徑。
- 本輪負載測試是有界的生成歷史／IPC／持久化觀測，不代表長期多日 soak 或所有供應商版本相容保證。無獨立外部安全稽核。
