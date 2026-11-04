# Chat model selection and context — v0.6.0

## 聊天室直接選模型與思考強度

輸入框底部「模型與思考」可直接設定每個 Agent。單一接收者時顯示該模型與強度，多位接收者則各自設定。選擇只作用於本聊天室；不會改寫全域 Agent 或其他聊天室。任務在排程時保存設定，後續切換不會改變執行中／已排程的回合。任務細節可查看當時的模型與強度。

- **Codex**：官方 App Server `model/list` 取得模型及 `supportedReasoningEfforts`，包含帳號實際提供的 GPT-6.1-Sol、GPT-6-Astra 等。模型與強度以 `turn/start.model`、`effort` 傳入，完成後透過原生 thread/resume 回報的實際設定核對。沒有寫死模型清單。
- **Claude Code native**：啟動未修改的官方 CLI，以 SDK 同源的 control initialize 查詢 selectable model catalog；沒有送出 user/model turn，工具與外部 MCP 關閉。從回應只取模型名稱、ID 和 `supportedEffortLevels`，捨棄 account 等欄位。此環境提供 Opus、Sonnet、Fable、Haiku 等；模型的實際版本及權限以使用者 CLI 為準。模型／強度用原生 `--model`、`--effort`。不擷取登入 Token。
- **Antigravity**：直接讀取 `agy models`。此環境列出 Gemini 4 **Argon**（不是 Agron）、Gemini 3.8 Flash、Claude 等原生選項；不補入清單中不存在的名稱。模型變體的 Low/Medium/High 用於呈現該家實際提供的強度，啟動時仍用官方 `--model`／`--effort`。

模型不支援的設定、缺少 Runtime、未登入或限額會顯示真正錯誤，不切換成別家模型偽裝成功。原生清單抓取失敗時可輸入自訂合法 ID；Claude SDK/API 是獨立認證模式，沒有 API Key 的 Live 驗收，不能拿 CLI 訂閱清單冒充 API 帳號權限。

切回空白的 Runtime／模型預設時，如果舊原生 Session 保存了明確設定，會開始新的原生 Session，保留共享聊天並顯示通知，避免原生 sticky 選項偷偷沿用。改選明確模型時沿用支援的原生 resume／override。思考強度是執行選項，不顯示未公開的私人推理。

## 長對話背景與來源

Migration 6 建立 SQLite FTS5 索引，支援英文及繁中雙字詞；不是向量庫或付費模型摘要。只在訊息完成／終態時更新索引，不為每個串流 delta 重建。Agent 的搜尋不限於原本最近 1000 則視窗，來源仍限制同一聊天室，且不能把失敗或未完成回覆當成功知識。

釘選按鈕可將最多 12 則已完成公開訊息加入背景。背景為明確來源的節錄，包含 ID、發送者、時間與截短標示；釘選不是提高指令權限。四種區塊保留分別預算：釘選、相關檢索、契約／決策節錄、近期訊息，總量不超過 24k 字元，同次不重複來源。釘選可能跨回合重送以保留重要條件，並非無限制重送完整歷史。

原本以訊息 rowid 推進的游標會漏掉較早建立、但較晚完成的平行回覆。現在用公開訊息完成時的獨立遞增 delivery sequence；只在原生回合成功後推進 Session 游標。升級時將舊游標歸零一次，重送有上限的共享背景，不重播任務，也不修改供應商的私有 Session 歷史。

活動抽屜的「Agent 背景與來源」可檢查實際準備的背景、引用節錄、字元數、游標與原始來源預覽。每室保留最近 50 份背景快照，面板按需載入最新 12 份。這是送出前準備的內容，不代表失敗回合一定已被供應商接收。

原生結構化工具增加 `search_context` 與 `read_context`，分別回傳最多六份限長來源。工具身分與聊天室由 Host 決定，不接受 Agent 任意指定其他專案／聊天室。清除歷史會一併清理索引、釘選與背景紀錄；備份包含本機資料，並不包含供應商私有 Session。

## 驗證與剩餘工作

Runtime 差異：Codex／Claude 可取得 inline Host 來源工具結果；v0.8.0 的 AGY 使用官方 stdin NDJSON，在上一原生回合 result 驗證後，將 search_context／read_context／read_artifact 結果送入同一原生 Session 的下一回合。最多三次續接，額外回合計入原請求的共享預算；不偽稱原生 MCP 直接工具回傳。只公開最終答案，活動可追蹤來源請求 ID／回合。詳見 AGY_HOST_READS。

- 合約與單元：模型／effort 傳參、排程快照、Claude metadata 不保留 account、繁中舊來源、晚完成回覆、釘選失效清理、跨室拒絕、24k 上限、串流不重建索引。
- Electron E2E：聊天室模型／強度與釘選重啟保存，沒有為 CI 呼叫付費 Agent。
- `npm run test:live-models-context`：真正打包 UI 選 Sol/high、Astra/medium、Opus、Sonnet、Argon、Flash；重啟後讓真實 Agent 讀出 1600 則歷史以前的繁中隨機驗收碼，並驗證來源快照與實際二進位雜湊。
- `npm run benchmark:context`：生成 5000 則訊息，在真實本機 SQLite 記錄索引／查詢／背景組裝時間，不將開發機測量當所有 Windows 的效能保證。

尚未完成：語意／向量檢索或模型摘要、AGY 真正增量公開串流、所有 Windows 版本／硬崩潰矩陣、開發工具鏈 minimatch 相容修復。完整發行驗證見 VALIDATION 與 IMPLEMENTATION_STATUS。

官方來源：[Codex App Server](https://learn.chatgpt.com/docs/app-server)、[Claude SDK TypeScript](https://code.claude.com/docs/en/agent-sdk/typescript)、[Claude CLI flags](https://code.claude.com/docs/en/cli-reference)、[AGY CLI flags](https://antigravity.google/docs/cli/reference)。CLI catalog wire 與 ModelInfo 另核對安裝的官方 SDK 型別與程式碼。
