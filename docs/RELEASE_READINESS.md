# AgentHub v0.13.0 發佈驗收

本版收斂原始規格與四項收尾，不以版本號或估算百分比代替驗收。20 項原始需求見 [ACCEPTANCE_MATRIX](ACCEPTANCE_MATRIX.md)，具體紀錄見 [FINAL_VALIDATION_PLAN](FINAL_VALIDATION_PLAN.md)。

## 本版結果

Typecheck、ESLint、全量離線單元／整合 40 檔 217 項通過，包含真實 Git、SQLite 容量故障／備份損壞／I/O 與 Runtime 合約。NSIS／Portable 建置成功，完整 Electron E2E 13 項通過，無略過，包含實際 packaged EXE。完整及 production npm audit 均為 0。

同一最終 app.asar／守護器的 15 份打包驗收通過，另有 Windows 通知實測。SHA-256、測試摘要、證據雜湊見 [BUILD_MANIFEST](BUILD_MANIFEST.json)。

- Codex／Claude 訂閱／AGY 同室回覆 OK；三家實際讀取本地圖像、聯網、選模型與強度，並從官方來源取得額度和前景刷新。AGY 發出 331 個完成前的公開文字增量；Host 續接保留單一原生 Session，停止或重啟不重播。
- AGY 發布契約後，Codex 和 Claude 的實作約有 20 秒重疊，三個工作區分離。兩份審查通過後，兩個確切整合快照都通過原生沙盒測試。另驗 Codex 真實委派、Claude 讀不可變產物、AGY 審查及兩次核准整合；最終專案實際測試通過。
- 空白／既有專案、自動初始化／測試／整合、Stop／手動復原、主程序／Runtime／Renderer 故障、Portable 均通過。NSIS 0.12.3 → 0.13.0 保留聊天、主題、原生 Codex Session，升級前後真實回覆 OK，最後卸載測試副本。
- 打包版負載：4,000 則歷史、約 121 秒內持續保存 234 則筆記，IPC p95 9 ms；搜尋、虛擬列表與重啟復原通過。通知／工作列／勿擾由實際 OS API 觀測；點擊導覽由 Electron E2E 驗證。

乾淨 GitHub Windows Server 2022／2025 的 [Windows CI](https://github.com/ethan222ddd/AgentHub/actions/workflows/windows.yml) 分別執行全量離線、Electron、建置及 NSIS 安裝／重裝／卸載。[v0.13.0 Release](https://github.com/ethan222ddd/AgentHub/releases/tag/v0.13.0) 僅在同一 Commit 的 Windows CI 成功後發佈，並附實際 run 連結。

## 產品流程

真實 Codex App Server、Claude Code 訂閱 CLI、AGY CLI；共享聊天室與獨立 Session；模型／強度、額度；原生檔案／圖像／聯網；角色團隊與自訂工作流程；結構化委派、immutable artifact、獨立 Worktree、確切 SHA Review、整合快照測試與合併；Stop／故障復原；通知／待處理數及 GitHub Issue／PR／CI 交付均有實作。

AGY 1.5.1+ 公開 ACTIVE 串流及零回合 /usage 取代舊版缺口。部分模型只提供結構化最終內容時保留緩衝回覆，不顯示路由 JSON，不宣稱所有模型都提供 Token 串流。契約發布由 Host 安全 checkpoint，不要求額外 Git Shell 權限。

## 保留缺口

1. 使用者接受先做乾淨 CI、保留乾淨 Windows 10／11 實機缺口；Server runner 不能當成 client OS。本機原生 Live 在 Windows 11 Home build 26300。
2. 未簽章、無自動更新、無外部安全稽核；核對來源及 SHA256。
3. Claude API-key SDK 為合約測試；本輪真人帳號採原生 CLI 訂閱。不同 CLI／模型／帳號權限仍影響能力。
4. 使用者保留審查第 2 項自動批准政策。Windows Job 是程序樹管理，不等於檔案／網路隔離；Claude Windows Shell 隔離矩陣不完整。
5. 負載測試為 4,000 則生成歷史加有界持久化／IPC／虛擬列表觀測，不是多日 soak 或所有故障保證。

本機 Live 與 CI 下載版分別追蹤雜湊。CI 產物只宣稱實際執行的免帳號測試，本機 Live 不冒充 CI 的付費驗收。
