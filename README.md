# running-analysis

跑姿對比分析網站：上載一段側面跑步片，喺瀏覽器入面同標準跑姿片逐格對比。

**網站：** https://banjai.github.io/running-analysis/

- 影片只喺訪客自己部機分析（MediaPipe Pose Landmarker，WebAssembly／WebGL），唔會上載去任何伺服器。
- 自動揀最穩定、同標準片一樣長（2.47 秒）嘅一段，兩條片都由近鏡腳落地前 0.17 秒開始，同步循環播放，畫埋骨架同關節角度。
- 四個分頁：腳掌著地位置、著地方式、微幅前傾、肩膀放鬆，每個都有判定、數據表、做得好／可以改善同小練習。
- 之前嘅 3D 動作捕捉報告搬咗去 [`motion-capture/`](motion-capture/)。

## 檔案

| 路徑 | 內容 |
|---|---|
| `index.html`, `app/style.css`, `app/main.js` | 網頁、上載、同步播放、骨架疊圖 |
| `app/detect.js` | 逐格骨架偵測（MediaPipe Pose Landmarker heavy／full） |
| `app/analysis.js` | 左右腳修正、平滑、角度、落地／離地（Zeni 2008）、穩定段、各項指標 |
| `app/verdicts.js` | 四個分頁嘅判定同文字 |
| `app/std/` | 標準片（H.264）同佢預先計好嘅骨架數據 `std_pose.json` |
| `app/vendor/tasks-vision/` | `@mediapipe/tasks-vision@0.10.21`（Apache-2.0） |
| `tools/extract-std.*` | 用同一個偵測器重新產生 `std_pose.json` |

## 本地測試

任何靜態伺服器都得，例如 `python3 -m http.server`，再開 http://localhost:8000/。

重新計標準片骨架：瀏覽器開 `tools/extract-std.html`，會下載新嘅 `std_pose.json`；或者用 Playwright 跑 `node tools/extract-std.mjs`（Playwright 內置嘅 Chromium 冇 H.264，要傳一個 VP9 版本嘅標準片路徑）。
