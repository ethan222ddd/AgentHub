# Image codec notices

AgentHub 的原始碼採 MIT 授權；第三方元件仍遵守各自授權。

| 元件 | 本次版本 | 套件宣告授權 | 原始碼 |
|---|---|---|---|
| image-size | 見 package-lock.json | MIT | https://codeberg.org/image-size/image-size |
| sharp | 0.35.5 | Apache-2.0 | https://github.com/lovell/sharp/tree/v0.35.5 |
| @img/sharp-win32-x64 | 0.35.5 | Apache-2.0 AND LGPL-3.0-or-later | https://github.com/lovell/sharp-libvips |

Windows 套件包含原生 addon、libvips DLL、版本資訊與原套件 LICENSE，位於 `resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64/`。本次包含 libvips 8.18.7；各底層函式庫版本見該資料夾的 `versions.json`，libvips 原始碼：https://github.com/libvips/libvips/tree/v8.18.7 。應用沒有禁止使用者檢查或替換這些獨立原生函式庫。

其他 JavaScript、Electron 與官方 Agent SDK 的授權文字保留在各套件，完整依賴版本由 package-lock.json 記錄。官方外部 Codex/Claude/Antigravity Runtime 的登入與使用條件由其供應商管理。
