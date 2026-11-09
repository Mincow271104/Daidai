# DaiDai（呆呆）— 開發環境設定

本文件依照目前 `master` 分支的程式碼整理。DaiDai 是以 React Native、Expo 與 TypeScript 開發的台灣繁體中文學習 App。

## 目前程式的主要處理方式

- **AI Tutor：** `src/services/api.ts` 直接呼叫 Gemini API；AI Chat 提供 Flash 與 Reasoning 兩種模式。
- **語音辨識：** App 先嘗試連線到可選的本地 FastAPI / Faster-Whisper 伺服器；本地服務不可用時，再使用 Gemini 語音辨識。
- **Conversation：** 先做快速翻譯，符合條件時再於背景進行詞彙與語境分析。
- **資料：** SQLite 儲存單字、對話、快取與複習狀態；FSRS 由 `ts-fsrs` 計算複習排程。
- **Cloudflare Worker：** `cloudflare-worker/` 目前是獨立的輔助程式碼。檢查目前 App 的 `src/services/api.ts`，尚未發現它透過 `EXPO_PUBLIC_WORKER_URL` 呼叫這個 Worker。請勿依照舊版文件，假設 Worker 已經接入 App 的主要 AI 流程。

## 1. 安裝相依套件

建議使用 Node.js 22 LTS，並使用 repository 內的 lockfile：

```bash
npm ci
```

## 2. 設定本機環境變數（選用）

複製範本：

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

macOS / Linux：

```bash
cp .env.example .env
```

- `EXPO_PUBLIC_LOCAL_AI_URL`：選填，填入手機可連線到的本地 Whisper Server 網址，例如 `http://192.168.1.20:8000`。請換成實際電腦的 LAN IP；手機上的 `localhost` 指的是手機本身，不是電腦。
- `EXPO_PUBLIC_GEMINI_API_KEY`：僅供個人開發測試。Expo 的 `EXPO_PUBLIC_*` 變數會被編入 App 用戶端程式碼，不能放入共用或正式發行 APK 的私人 API Key。一般使用者應在 App 的 API Key 設定頁自行設定自己的金鑰；正式公開發行前，仍應規劃具有驗證、配額限制及濫用防護的後端 API。

請勿將自己的 `.env`、API Key、Cloudflare Token 或其他憑證提交到 Git。

## 3. 啟動行動應用程式

```bash
npx expo start
```

依照終端機顯示的 QR Code，在手機上開啟 Expo Go。手機與開發電腦建議先連接相同 Wi-Fi。

## 4. 啟動選用的本地語音辨識服務

本地服務位於 `server/`，使用 Python、FastAPI 與 Faster-Whisper。

```bash
python -m venv .venv
```

Windows PowerShell：

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r server/requirements.txt
python server/gpu_server.py
```

若電腦及手機位於不同網路，請設定可安全連線的 HTTPS 服務網址。不要把未經驗證或沒有存取控制的本地服務直接暴露到公網。

## 5. Android APK 建置

Android 已有基本 Expo App 設定，但需要先完成 EAS 專案連結。請依照 [ANDROID_BUILD.md](./ANDROID_BUILD.md) 操作。

快速命令：

```bash
npm run typecheck
npm run eas:init
npm run build:android:apk
```

## 6. iOS 建置

目前 repository 已有 GitHub Actions 工作流程：

`/.github/workflows/build-ios.yml`

該工作流程會在 macOS runner 上執行 Expo Prebuild、CocoaPods 及 unsigned iOS build。實際安裝仍需符合 iOS sideload 的簽署與重新簽署條件。

## 7. 舊版 Cloudflare Worker 的注意事項

`cloudflare-worker/` 保留獨立的 Worker 程式碼，但目前 App 主流程尚未接入。該 Worker 的程式碼目前也需要補上使用者驗證、配額限制及濫用防護，並重新檢查 CORS 設定，才適合公開部署。不要將它視為已完成的安全 API Proxy。
