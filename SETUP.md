# DaiDai (呆呆鸚) — Hướng Dẫn Cài Đặt & Chạy

> **Kiến trúc mới**: Không còn dùng Groq! Gemini 2.5 Flash xử lý trực tiếp cả
> audio lẫn phân tích thuật ngữ trong **1 lần gọi API duy nhất**.

## Bước 1: Lấy API Key (Miễn phí — chỉ cần 1 key)

| Service | Link | Thao tác |
|---------|------|----------|
| 🔵 **Google AI Studio** | https://aistudio.google.com/ | Đăng nhập Google → "Get API Key" → Create |
| 🟠 **Cloudflare** | https://dash.cloudflare.com/ | Đăng ký → Workers & Pages (miễn phí 100k req/ngày) |

## Bước 2: Deploy Cloudflare Worker

```bash
# Cài Wrangler CLI (1 lần duy nhất)
npm install -g wrangler

# Đăng nhập Cloudflare (mở trình duyệt)
wrangler login

# Vào thư mục worker
cd E:\UCHIMI\DAIDAI\daidai-app\cloudflare-worker
npm install

# Thêm API key của Gemini (an toàn — không lưu trong code)
wrangler secret put GEMINI_API_KEY
# → Dán key từ Google AI Studio vào, nhấn Enter

# Deploy lên Cloudflare
wrangler deploy
```

Sau khi deploy xong, terminal in ra URL dạng:
```
https://daidai-worker.YOURNAME.workers.dev
```
**Copy URL này.**

## Bước 3: Cập nhật URL trong App

Mở file `E:\UCHIMI\DAIDAI\daidai-app\.env` và thay:
```
EXPO_PUBLIC_WORKER_URL=https://daidai-worker.YOURNAME.workers.dev
```

## Bước 4: Chạy trên iPhone

1. Cài **Expo Go** từ App Store trên iPhone
2. Đảm bảo iPhone và máy tính **cùng mạng Wi-Fi**
3. Mở terminal tại thư mục `daidai-app`:
   ```bash
   npx expo start
   ```
4. Mở **Camera** iPhone → quét mã QR → chọn "Open in Expo Go"

> **Nếu khác mạng / dùng 4G**: `npx expo start --tunnel`

---

## Luồng xử lý mới (Zero Groq)

```
iPhone ghi âm .m4a
       ↓
Cloudflare Worker /process-audio
       ↓  (audio base64 inline)
Gemini 2.5 Flash Multimodal
       ↓  (1 API call duy nhất)
Transcription + Terms + Quest
       ↓
SQLite + FSRS on device
```
