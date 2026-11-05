# AgentHub v0.12.1 距離正式版的缺口

核對日期：2026-11-05（Asia/Taipei）。本文件依目前程式、歷史 BUILD_MANIFEST 與 v0.12.1 Windows CI 整理，不以版本號或任意完成百分比代替驗收。

v0.11 通知及 v0.12 工作流程範本已加入，操作與限制見 NOTIFICATIONS／WORKFLOW_TEMPLATES。v0.12.1 建立公開 Git 原始碼、模組拆分及真實 Windows CI；[本輪 CI](https://github.com/ethan222ddd/AgentHub/actions/runs/41943842088) 的 161 項離線測試、11 項 Electron E2E 與 NSIS／Portable 建置通過。本輪沒有重跑付費 Live；以下原生 Runtime 實測仍標示其歷史版本，不以工程維護測試冒充新的三家 Live 證據。

## 現在已能做什麼

三家真實原生 Runtime、同室 @Mention、多成員／角色、聊天室模型及強度、結構化跨代理訊息、獨立 Worktree、Diff、Checkpoint、確切版本 Review、整合快照測試與批准合併、聊天／Session 紀錄、手動復原、圖片及原生聯網均已有可執行路徑。Codex／Claude 原生訂閱額度可自動刷新。Windows NSIS 安裝檔已產生。

v0.6.1 的 74 tests／6 Electron E2E 與六份 Live 是已保存的歷史證據。v0.7.0 新增安全的自動初始化、工作區重用／同步、主資料夾整合與原生沙盒測試，最終本版結果須以 VALIDATION、BUILD_MANIFEST 的實際報告為準，不能沿用舊版雜湊。

v0.7.0 歷史紀錄為 94 tests／7 Electron E2E 與自動開發／整合。v0.9.0 已完成 121 tests／8 Electron E2E、Windows Job／程序診斷、真實 Main／Runtime／Renderer 故障及 metadata 中關閉；三家平行改檔與原生沙盒測試後整合、圖片、模型／背景、原生網路與恢復均用新版 EXE 重新驗證。完整 peer-review 和 installer roundtrip 仍是下列另外的缺口，正式產物及額度／Portable 結果以 Manifest 為準。

這代表核心可使用；不代表原始規格的每個細節、所有供應商版本及所有 Windows 組態均已完成驗收。

## 優先補齊的功能

這輪已補上「不用手動 Git／Worktree」及繁中使用手冊／離線 HTML；目前的其餘缺口如下。Git 的敏感檔案、模糊暫存、衝突和測試失敗仍需要人檢查，這是保護資料，不應用 Force／Hard Reset 消除。

| 項目 | v0.9.0 現況 | 正式驗收還需什麼 |
| --- | --- | --- |
| Antigravity 的 Host 讀取結果（本輪已完成） | 同一原生 Session 的有界下一回合續接，保留權限、回合／用量預算、來源追蹤與取消。不是直接 MCP 注入。 | 真實 EXE 已驗證來源／契約／停止／重啟；官方直接 MCP 是未來替換方案，不再是此功能完成的阻礙。詳見 AGY_HOST_READS。 |
| Antigravity 公開串流 | 最終 Schema 驗證完成才顯示答案；尚非真正增量串流。 | 使用官方實際發出的公開文字事件，保留完整路由驗證，不用切字動畫冒充串流。若 Runtime 不提供，需明示版本限制。 |
| Antigravity 剩餘額度 | 無已驗證的 headless 查詢，介面引導官方 /usage。 | 等待或驗證官方機器介面；不能讀私密 Token／內部帳號端點或用 Token 用量推算剩餘額度。此項受上游能力限制。 |
| 完整 UI／規格逐項收尾 | 自動專案流程及使用手冊已加入，核心流程已存在。 | 仍需逐條核對原始設定／錯誤／完整產品細節，舊階段紀錄不能當最新版全部驗收。 |

## 可靠性、安全與相容性驗收

| 項目 | 還缺的證據或處理 |
| --- | --- |
| Windows 10/11 | 目前主要實測 Windows 11 build 26300。需要乾淨 VM、不同帳號／權限、安裝路徑、PATH 和非 ASCII 路徑矩陣。AGY 必要 Sandbox 在舊 Windows 不可用；不能承諾三家在 Windows 10 全可運作。要達成原目標需官方支援或可驗證的官方替代整合。 |
| 硬崩潰與程序生命週期 | v0.9 新增 Windows Job／keeper、真實 Main 與 Codex Runtime 強制終止、metadata 查詢中退出、Renderer 崩潰、WIP 保留及不重播驗收，另有真實 detached 孫程序測試。仍需磁碟錯誤、長時間壓力、乾淨 VM 與 broker／service 邊界矩陣；Job 不是 Shell 沙盒。詳見 PROCESS_LIFECYCLE。 |
| Shell／網路權限 | 已有路徑與批准測試，但任意已批准 Shell 可執行專案程式。尤其 Claude Host 檔案 gate 不等於 Windows 系統層 Shell 隔離，需補強／驗證，並明確公開邊界。 |
| 最新版完整協作開發（本輪已補） | v0.10 真正打包版已驗證 Codex→Claude 委派／契約、兩份 AGY 唯讀批准、精確測試與合併／主專案測試；真正 NSIS 0.9→0.10 升級與卸載、聊天／設定及原生 Codex Session 恢復成功。Manifest 改為核對當版證據，未沿用早期報告。仍需乾淨 VM、不同權限／安裝位置的矩陣。 |
| 更多 Runtime／語言組態 | 模型清單依帳號而異；Claude SDK/API 模式只有合約測試，未做本環境 API Key Live。Python/.NET/Rust/Go 測試入口未完成全部真實工具鏈矩陣。 |
| 依賴與安全檢查 | 先前 production audit 為 0，開發工具鏈仍有 25 個衍生 moderate minimatch 公告；需相容修復及重新掃描。尚無獨立安全稽核。 |

## 正式發佈準備

目前已有 [公開 GitHub 原始碼](https://github.com/ethan222ddd/AgentHub)、MIT 授權及實際成功的 Windows CI；安裝版／Portable 透過保留七天的 Actions Artifact 提供。尚未建立正式 GitHub Release、簽章與自動更新；仍需完成正式發佈流程、相容性矩陣和最終驗收。程式碼簽章需要合法發行者憑證。

本次已新增繁中使用手冊與離線 HTML 閱讀版，補上先前只有 README 和分散技術文件的缺口。

## 不應混成基本完成門檻的進階項目

向量索引／模型語意摘要、更大的圖像／動畫支援、更多供應商等屬後續進階範圍。現有 FTS5、繁中檢索、節錄摘要、釘選及來源預算已可使用，不能說背景管理完全沒做，也不能把節錄稱為模型語意摘要。

## 接下來如何推進

1. AGY 有界工具結果續接已接入；接著處理上游串流／額度能力差異與更完整的故障矩陣。
2. 完成故障復原、系統層安全與 Windows 相容矩陣，處理開發依賴。
3. 候選版完整協作與安裝升級已補；接續乾淨 VM／權限／故障與壓力矩陣、相依修復及逐項產品核對，再準備簽章與正式發佈。

這是三組工作里程碑，不是保證再三個版本就會完成。上游 Runtime 能力、測試結果與發行準備會影響實際版本數；目前不能誠實給出固定完成百分比或日期。
