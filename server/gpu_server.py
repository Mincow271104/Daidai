"""
DaiDai Local Accelerator Server - Multilingual (English + Vietnamese + zh-TW Traditional)
Tự động tối ưu hóa phần cứng:
- Ưu tiên GPU NVIDIA CUDA (RTX) siêu tốc nếu có thư viện CUDA / cuBLAS.
- Tự động chuyển đổi mượt mà sang CPU (int8) nếu thiếu DLL CUDA, đảm bảo KHÔNG BAO GIỜ bị crash.
- Tự động vá lỗi metadata_errors của PyAV 19.x trên Windows.
- Tích hợp OpenCC chuyển đổi sang Phồn thể chuẩn Đài Loan (s2twp) phục vụ Luyện nói.
"""

import sys
import os
import re

# Cấu hình UTF-8 cho console Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# 1. Vá lỗi PyAV 14+ / 19+ (loại bỏ tham số metadata_errors mà faster_whisper gọi)
import av

_orig_av_open = av.open


def _safe_av_open(*args, **kwargs):
    kwargs.pop("metadata_errors", None)
    return _orig_av_open(*args, **kwargs)


av.open = _safe_av_open

# 2. Tự động thêm đường dẫn DLL NVIDIA (nếu có nvidia-cublas-cu12, nvidia-cudnn) vào search path và preload
import ctypes
site_packages = [p for p in sys.path if "site-packages" in p]
for sp in site_packages:
    nvidia_dir = os.path.join(sp, "nvidia")
    if os.path.exists(nvidia_dir):
        for root, dirs, files in os.walk(nvidia_dir):
            dll_files = [f for f in files if f.endswith(".dll")]
            if dll_files:
                try:
                    if hasattr(os, "add_dll_directory"):
                        os.add_dll_directory(root)
                    os.environ["PATH"] = root + os.pathsep + os.environ.get("PATH", "")
                    for dll in dll_files:
                        if "cublas" in dll.lower() or "cudnn" in dll.lower():
                            try:
                                ctypes.CDLL(os.path.join(root, dll))
                            except Exception:
                                pass
                except Exception:
                    pass

import tempfile
from contextlib import asynccontextmanager
from typing import Optional
import numpy as np
import ctranslate2
import httpx
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

WHISPER_MODEL_NAME = "large-v3-turbo"
whisper_model = None
opencc_converter = None
active_device = "cpu"
active_compute_type = "int8"
cuda_count = ctranslate2.get_cuda_device_count()

# ─── BƯỚC 1: BẢNG NGỮ CẢNH SONG NGỮ THEO NGÀNH (INITIAL PROMPT) ────────────
# Chỉ dùng từ khóa thuần túy, tuyệt đối không dùng câu văn mô tả dài dòng để tránh Whisper bị hallucinate
FIELD_PROMPTS = {
    "it": (
        "deploy, server, cache, database, latency, container, bug, debug, refactor, query, API, frontend, backend, framework, "
        "library, merge, pull request, branch, commit, push code, sprint, release, staging, production, docker, redis, microservices, "
        "auth token, test case, logic, interface, socket, webhook, CI CD, devops, cloud, UI, UX."
    ),
    "medical": (
        "check-up, test, CT scan, MRI, ICU, clinic, prescription, report, triệu chứng, xét nghiệm, chẩn đoán, bác sĩ, điều trị."
    ),
    "manufacturing": (
        "QC, QA, line, mold, CNC, sample, tolerance, ca làm việc, kiểm tra linh kiện, lắp ráp, đóng gói, tiêu chuẩn."
    ),
    "business": (
        "meeting, deadline, KPI, budget, report, client, forecast, hợp đồng, đàm phán, chiết khấu, doanh thu, thanh toán."
    ),
    "hospitality": (
        "check-in, check-out, booking, room service, buffet, voucher, lễ tân, đặt phòng, hành lý, thực đơn."
    ),
    "general": (
        "meeting, deadline, online, offline, check, test, note, feedback, call, chat, link, app."
    ),
    "daily": (
        "meeting, deadline, online, offline, check, test, note, feedback, call, chat, link, app, ăn cơm, về nhà, mấy giờ."
    ),
}

# ─── BỘ LỌC ẢO GIÁC YOUTUBE SUBTITLES CỦA WHISPER (HALLUCINATION FILTER) ────────
# Whisper được huấn luyện trên kho dữ liệu video YouTube khổng lồ, nên khi gặp đoạn im lặng hoặc nói quá nhỏ,
# mô hình thường tự động "bịa" ra các câu outro quen thuộc của YouTube (đặc biệt là Ghiền Mì Gõ, La La School, Subtitles by...)
HALLUCINATION_PATTERNS = [
    re.compile(r"hãy\s+subscribe\s+cho\s+kênh.*", re.IGNORECASE),
    re.compile(r"đăng\s+ký\s+kênh.*để\s+không\s+bỏ\s+lỡ.*", re.IGNORECASE),
    re.compile(r"ghiền\s+mì\s+gõ", re.IGNORECASE),
    re.compile(r"la\s+la\s+school", re.IGNORECASE),
    re.compile(r"đừng\s+quên\s+(like|subscribe|đăng\s+ký).*", re.IGNORECASE),
    re.compile(r"cảm\s+ơn\s+các\s+bạn\s+đã\s+(theo\s+dõi|xem).*", re.IGNORECASE),
    re.compile(r"chúc\s+các\s+bạn\s+(một\s+ngày|vui\s+vẻ|xem\s+video).*", re.IGNORECASE),
    re.compile(r"hẹn\s+gặp\s+lại\s+các\s+bạn.*", re.IGNORECASE),
    re.compile(r"subtitles?\s+by\s+.*", re.IGNORECASE),
    re.compile(r"thanks\s+for\s+watching.*", re.IGNORECASE),
    re.compile(r"please\s+(subscribe|like).*", re.IGNORECASE),
    re.compile(r"like\s+and\s+subscribe.*", re.IGNORECASE),
]

def is_hallucination(text: str) -> bool:
    if not text:
        return True
    cleaned = text.strip()
    for pat in HALLUCINATION_PATTERNS:
        if pat.search(cleaned):
            return True
    return False

def clean_hallucinations(text: str) -> str:
    if not text:
        return ""
    result = text.strip()
    for pat in HALLUCINATION_PATTERNS:
        result = pat.sub("", result).strip()
    return result



def init_whisper_model():
    global whisper_model, active_device, active_compute_type
    from faster_whisper import WhisperModel

    if cuda_count > 0:
        for ctype in ["float16", "int8_float16", "int8"]:
            try:
                print(f"[DaiDai AI] Đang nạp model '{WHISPER_MODEL_NAME}' lên NVIDIA CUDA GPU ({ctype})...")
                m = WhisperModel(WHISPER_MODEL_NAME, device="cuda", compute_type=ctype)
                n_mels = getattr(m.feature_extractor, "mel_filters", None)
                mel_bins = n_mels.shape[0] if n_mels is not None else 128
                m.encode(np.zeros((1, mel_bins, 3000), dtype=np.float32))
                whisper_model = m
                active_device = "cuda"
                active_compute_type = ctype
                print(f"[DaiDai AI] ✅ Khởi chạy thành công '{WHISPER_MODEL_NAME}' trên NVIDIA CUDA GPU ({ctype})!")
                return
            except Exception as e:
                print(f"[DaiDai AI] ⚠️ CUDA GPU ({ctype}) chưa nạp được ({e}). Thử cấu hình tiếp theo...")

    try:
        print(f"[DaiDai AI] 🔄 Tự động chuyển sang nạp '{WHISPER_MODEL_NAME}' trên CPU tối ưu (int8)...")
        whisper_model = WhisperModel(WHISPER_MODEL_NAME, device="cpu", compute_type="int8")
        active_device = "cpu"
        active_compute_type = "int8"
        print(f"[DaiDai AI] ✅ Khởi chạy thành công '{WHISPER_MODEL_NAME}' trên CPU (int8)!")
    except Exception as e:
        print(f"[DaiDai AI] ❌ Lỗi khởi động Whisper '{WHISPER_MODEL_NAME}': {e}")



@asynccontextmanager
async def lifespan(app: FastAPI):
    global opencc_converter
    init_whisper_model()

    try:
        import opencc
        opencc_converter = opencc.OpenCC("s2twp")
        print("[DaiDai AI] ✅ Bộ chuyển đổi OpenCC (s2twp - Phồn thể Đài Loan) đã sẵn sàng!")
    except Exception as e:
        print(f"[DaiDai AI] ⚠️ Không thể nạp OpenCC: {e}")

    yield


app = FastAPI(title="DaiDai Accelerator Server", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {
        "status": "ready" if whisper_model is not None else "loading",
        "device": active_device,
        "compute_type": active_compute_type,
        "cuda_devices": cuda_count,
        "model": WHISPER_MODEL_NAME,
        "opencc_ready": opencc_converter is not None,
    }


@app.post("/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    language: Optional[str] = Form(None),
    field: Optional[str] = Form(None),
):
    global whisper_model, active_device, active_compute_type
    if not whisper_model:
        return {"error": "Whisper model chưa được khởi động", "text": "", "language": ""}

    suffix = os.path.splitext(audio.filename or "recording.m4a")[1] or ".m4a"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp_path = tmp.name
        content = await audio.read()
        tmp.write(content)

    try:
        lang_code = language.strip().lower() if language else ""
        selected_field = (field or "it").strip().lower()

        transcribe_args = {
            "vad_filter": True,
            "vad_parameters": dict(
                min_silence_duration_ms=500,
                speech_pad_ms=200,
                threshold=0.55,
            ),
            "beam_size": 3,
            "temperature": 0.0,
            "condition_on_previous_text": False,  # BẮT BUỘC False cho mọi ngôn ngữ để triệt tiêu lặp vô tận và ảo giác
            "repetition_penalty": 1.15,            # Ngăn chặn triệt để lặp ký tự/từ (ví dụ: 更更更更...)
            "no_repeat_ngram_size": 3,             # Tuyệt đối không lặp lại cụm 3 từ
            "hallucination_silence_threshold": 2.0, # Bỏ qua đoạn im lặng, không tự bịa ra chữ
            "compression_ratio_threshold": 2.4,    # Phát hiện và loại bỏ chuỗi lặp bất thường
            "no_speech_threshold": 0.5,            # Bỏ qua nếu xác suất im lặng >= 0.5
            "log_prob_threshold": -1.0,            # Bỏ qua nếu logprob quá thấp
        }

        if lang_code == "zh":
            transcribe_args["language"] = "zh"
            # Tuyệt đối không dùng câu mệnh lệnh như "請使用繁體字" vì Whisper sẽ tưởng là lời thoại và đọc lại!
            # Chỉ dùng từ khóa từ điển tự nhiên để định hướng ngữ cảnh:
            transcribe_args["initial_prompt"] = (
                "繁體中文，臺灣腔調，生活，工作，會議，專案，排程，報告，簡報，剛剛，幾點，回來，下班，吃飯，在哪裡，"
                "meeting, check, project, deadline, report, client, slide, confirm, order, cancel, vibe, chill。"
            )
        elif lang_code == "vi":
            transcribe_args["language"] = "vi"
            transcribe_args["initial_prompt"] = FIELD_PROMPTS.get(selected_field, FIELD_PROMPTS["it"])
        elif lang_code == "en":
            transcribe_args["language"] = "en"
            transcribe_args["initial_prompt"] = "Conversational English with technical, business, and daily terms."
        else:
            # Chế độ tự động nhận diện ngôn ngữ (Auto-detection): Hỗ trợ Việt, Anh, và Trung Phồn thể Đài Loan
            field_prompt = FIELD_PROMPTS.get(selected_field, FIELD_PROMPTS["it"])
            transcribe_args["initial_prompt"] = (
                f"{field_prompt} 繁體中文，臺灣，Tiếng Việt, English, "
                "meeting, check, project, deadline, slide, client, test, report, bug, database, server, review, PR, cancel, order, coffee, vibe, chill。"
            )

        def extract_clean_text(segs):
            valid_parts = []
            for s in segs:
                if getattr(s, "no_speech_prob", 0) > 0.5:
                    continue
                if getattr(s, "avg_logprob", 0) < -1.0:
                    continue
                if getattr(s, "compression_ratio", 0) > 2.4:
                    continue
                txt = s.text.strip()
                if is_hallucination(txt):
                    continue
                valid_parts.append(txt)
            raw = " ".join(valid_parts).strip()
            raw = clean_hallucinations(raw)
            return raw

        try:
            segments, info = whisper_model.transcribe(tmp_path, **transcribe_args)
            raw_text = extract_clean_text(segments)
        except RuntimeError as e:
            # Nếu xảy ra lỗi runtime CUDA giữa chừng, tự động fallback sang CPU và thử lại ngay lập tức
            if "cuda" in str(e).lower() or "cublas" in str(e).lower():
                print(f"[DaiDai AI] ⚠️ Gặp lỗi CUDA ({e}), tự động chuyển sang CPU...")
                from faster_whisper import WhisperModel
                whisper_model = WhisperModel(WHISPER_MODEL_NAME, device="cpu", compute_type="int8")
                active_device = "cpu"
                active_compute_type = "int8"
                segments, info = whisper_model.transcribe(tmp_path, **transcribe_args)
                raw_text = extract_clean_text(segments)
            else:
                raise

        converted = False
        text = raw_text

        # Xử lý Phồn thể Đài Loan nếu là tiếng Trung
        is_zh_detected = (lang_code == "zh") or (info and info.language == "zh")
        if opencc_converter and is_zh_detected:
            try:
                text = opencc_converter.convert(raw_text)
                converted = True
            except Exception as e:
                print(f"[DaiDai AI] Lỗi OpenCC convert: {e}")

        detected_lang = info.language if info else (language or "")
        try:
            print(f"[DaiDai AI] 🎯 Kết quả STT [{detected_lang.upper()}] ({info.duration:.2f}s): {text}")
        except Exception:
            pass

        return {
            "text": text,
            "raw_text": raw_text,
            "duration": info.duration if info else 0,
            "language": detected_lang,
            "converted": converted,
        }
    except Exception as e:
        print(f"[DaiDai AI] ❌ Lỗi phiên âm: {e}")
        return {"error": str(e), "text": "", "language": ""}
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


def update_env_file(url: str):
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if not os.path.exists(env_path):
        return
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
        new_lines = []
        found = False
        for line in lines:
            if line.startswith("EXPO_PUBLIC_LOCAL_AI_URL="):
                new_lines.append(f"EXPO_PUBLIC_LOCAL_AI_URL={url}\n")
                found = True
            else:
                new_lines.append(line)
        if not found:
            new_lines.append(f"EXPO_PUBLIC_LOCAL_AI_URL={url}\n")
        with open(env_path, "w", encoding="utf-8") as f:
            f.writelines(new_lines)
    except Exception as e:
        print(f"[DaiDai AI] Không thể tự cập nhật file .env: {e}")


def start_tunnel():
    import subprocess
    import re
    import time

    cf_exe = os.path.join(os.path.dirname(__file__), "cloudflared.exe")
    if not os.path.exists(cf_exe):
        cf_exe = "cloudflared.exe"

    try:
        print("[DaiDai AI] ⏳ Đang khởi tạo Cloudflare Tunnel công khai...")
        proc = subprocess.Popen(
            [cf_exe, "tunnel", "--url", "http://localhost:8000"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            encoding="utf-8",
            errors="replace",
        )

        tunnel_url = None
        start_time = time.time()
        while time.time() - start_time < 15:
            line = proc.stdout.readline()
            if not line:
                break
            m = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
            if m:
                tunnel_url = m.group(0)
                break

        if tunnel_url:
            update_env_file(tunnel_url)
            return proc, tunnel_url
        else:
            print("[DaiDai AI] ⚠️ Chưa lấy được URL Cloudflare trong 15s.")
            return proc, None
    except Exception as e:
        print(f"[DaiDai AI] ❌ Không thể chạy cloudflared: {e}")
        return None, None


if __name__ == "__main__":
    import argparse
    import socket

    parser = argparse.ArgumentParser(description="DaiDai Local AI Server")
    parser.add_argument("--public", "--tunnel", action="store_true", help="Mở Cloudflare Tunnel công khai dùng cho 4G")
    args = parser.parse_args()

    hostname = socket.gethostname()
    local_ip = "172.17.14.63"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass

    tunnel_proc = None
    public_url = None
    if args.public:
        tunnel_proc, public_url = start_tunnel()

    print("=" * 60)
    print("🚀 DAIDAI LOCAL AI ACCELERATOR (Bilingual EN/VI + zh-TW Practice)")
    print(f"• Thiết bị: {active_device.upper()} ({active_compute_type})")
    print(f"• Model: {WHISPER_MODEL_NAME} (Song ngữ Anh, Việt & Phồn thể Đài Loan)")
    print(f"• Địa chỉ LAN (Wi-Fi nội bộ): http://{local_ip}:8000")
    if public_url:
        print(f"• 🌐 ĐỊA CHỈ PUBLIC (4G / NGOÀI TRƯỜNG): {public_url}")
        print(f"• ✅ Đã tự động cập nhật vào file .env!")
    else:
        print(f"• Cấu hình trong file .env: EXPO_PUBLIC_LOCAL_AI_URL=http://{local_ip}:8000")
        print(f"• Mẹo: Chạy 'python gpu_server.py --public' để dùng được qua 4G khi lên lớp!")
    print("=" * 60)

    try:
        uvicorn.run(app, host="0.0.0.0", port=8000)
    finally:
        if tunnel_proc:
            try:
                tunnel_proc.terminate()
            except Exception:
                pass
