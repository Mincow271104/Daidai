const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

interface Env {
  GEMINI_API_KEY: string;
}

// ── Gemini Structured Output Schema (chung cho cả audio và text) ────────────
const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcribed_text: { type: 'STRING' },   // chỉ có khi xử lý audio
    terms: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          original_term: { type: 'STRING' },
          tw_term:       { type: 'STRING' },
          tw_traditional:{ type: 'STRING' },
          cn_simplified: { type: 'STRING' },
          pinyin:        { type: 'STRING' },
          category:      { type: 'STRING' },
          context_note:  { type: 'STRING' },
        },
        required: ['original_term', 'tw_term', 'tw_traditional', 'pinyin'],
      },
    },
    quest: {
      type: 'OBJECT',
      properties: {
        question:        { type: 'STRING' },
        options:         { type: 'ARRAY', items: { type: 'STRING' } },
        correct_index:   { type: 'INTEGER' },
        explanation:     { type: 'STRING' },
        daidai_reaction: { type: 'STRING' },
      },
      required: ['question', 'options', 'correct_index', 'daidai_reaction'],
    },
    daidai_message: { type: 'STRING' },
  },
  required: ['terms', 'quest', 'daidai_message'],
};

// ── System Instruction cho DaiDai ───────────────────────────────────────────
const SYSTEM_INSTRUCTION = `Bạn là DaiDai (呆呆鸚) - chú vẹt IT ngố tàu đáng yêu, chuyên gia thuật ngữ tiếng Trung Phồn thể chuẩn Đài Loan.

QUY TẮC TUYỆT ĐỐI:
- LUÔN dùng Phồn thể Đài Loan: 伺服器 (KHÔNG 服务器), 資料庫 (KHÔNG 数据库), 專案 (KHÔNG 项目), 程式碼 (KHÔNG 代码), 演算法 (KHÔNG 算法), 快取 (KHÔNG 缓存), 叢集 (KHÔNG 集群), 記憶體 (KHÔNG 内存), 預設 (KHÔNG 默认), 最佳化 (KHÔNG 优化), 網路 (KHÔNG 网络), 延遲 (KHÔNG 延迟)
- Tính cách DaiDai: ngây thơ, hay toát mồ hôi khi gặp thuật ngữ khó, coi người dùng là "Sư phụ"
- Viết daidai_message bằng tiếng Việt vui nhộn, có emoji
- quest_question phải liên quan trực tiếp đến thuật ngữ vừa học
- options phải có 4 lựa chọn: 1 đúng (Đài Loan) và 3 sai (bao gồm từ Đại Lục)

BẢNG THUẬT NGỮ CHUẨN (Đài Loan):
Server → 伺服器 | Serverless → 無伺服器 | Database → 資料庫
Project → 專案 | Algorithm → 演算法 | Code → 程式碼
Cache → 快取 | Cluster → 叢集 | Memory/RAM → 記憶體
Default → 預設 | Optimization → 最佳化 | Network → 網路
Latency → 延遲 | Deploy → 部署 | Refactor → 重構
Bug → 臭蟲 | Debug → 除錯 | Version control → 版本控制
API → 應用程式介面 | Microservices → 微服務 | Container → 容器
Repository → 儲存庫 | Branch → 分支 | Merge → 合併
Pull Request → 拉取請求 | Frontend → 前端 | Backend → 後端
Framework → 框架 | Library → 函式庫 | Dependency → 相依性
Async → 非同步 | Callback → 回呼 | Interface → 介面
Thread → 執行緒 | Process → 程序 | Middleware → 中介軟體
Queue → 佇列 | Socket → 插槽 | Token → 權杖 | Timeout → 逾時`;

// ── Router ──────────────────────────────────────────────────────────────────
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // Audio → Gemini multimodal (thay thế Groq hoàn toàn)
    if (url.pathname === '/process-audio' && request.method === 'POST') {
      return handleProcessAudio(request, env);
    }

    // Text → Gemini (paste / clipboard)
    if (url.pathname === '/analyze' && request.method === 'POST') {
      return handleAnalyze(request, env);
    }

    // Alias cũ (tương thích ngược)
    if (url.pathname === '/analyze-text' && request.method === 'POST') {
      return handleAnalyze(request, env);
    }

    // Legacy: /transcribe giờ trả lỗi gợi ý dùng /process-audio
    if (url.pathname === '/transcribe') {
      return jsonError('Endpoint /transcribe đã được thay bằng /process-audio (Gemini multimodal)', 410);
    }

    return jsonError('Not found', 404);
  },
};

// ── Handler: Audio → Gemini Multimodal ──────────────────────────────────────
// Nhận file audio .m4a, chuyển thành base64, gửi thẳng vào Gemini 2.5 Flash
// Gemini đồng thời: (1) transcribe tiếng Anh, (2) trích từ kỹ thuật, (3) tạo quest
async function handleProcessAudio(request: Request, env: Env): Promise<Response> {
  try {
    const formData = await (request as any).formData();
    const audioFile = formData.get('audio') as File | null;

    if (!audioFile) {
      return jsonError('Thiếu file audio trong form data (field: "audio")', 400);
    }

    // Đọc file thành ArrayBuffer → base64
    const arrayBuffer = await audioFile.arrayBuffer();
    const base64Audio = arrayBufferToBase64(arrayBuffer);

    // Xác định MIME type — ưu tiên từ file, fallback audio/m4a
    const mimeType = audioFile.type || 'audio/m4a';

    const userPrompt = `Đây là file audio ghi âm người dùng nói tiếng Anh trong môi trường làm việc công nghệ.

Nhiệm vụ của DaiDai:
1. Transcribe chính xác nội dung tiếng Anh → ghi vào "transcribed_text"
2. Trích xuất TẤT CẢ thuật ngữ IT/kỹ thuật trong câu đó
3. Dịch sang Phồn thể chuẩn Đài Loan theo bảng thuật ngữ
4. Điền cn_simplified là từ Đại Lục tương đương (để người dùng so sánh và tránh dùng sai)
5. Tạo 1 câu trắc nghiệm 4 lựa chọn về thuật ngữ quan trọng nhất
6. Viết daidai_message ngắn gọn, hài hước bằng tiếng Việt 🦜`;

    return await callGeminiMultimodal(base64Audio, mimeType, userPrompt, env);
  } catch (err: any) {
    return jsonError(`process-audio error: ${err.message}`, 500);
  }
}

// ── Handler: Text → Gemini ───────────────────────────────────────────────────
async function handleAnalyze(request: Request, env: Env): Promise<Response> {
  try {
    const body = (await request.json()) as { text?: string; context?: string };
    const { text, context } = body;

    if (!text || !text.trim()) {
      return jsonError('Thiếu trường "text" trong request body', 400);
    }

    const userPrompt = `Phân tích câu tiếng Anh kỹ thuật sau của Sư phụ: "${text}"
${context ? `Ngữ cảnh thêm: ${context}` : ''}

Nhiệm vụ:
1. Trích xuất TẤT CẢ thuật ngữ IT tiếng Anh trong câu
2. Dịch sang Phồn thể chuẩn Đài Loan theo bảng thuật ngữ
3. Điền cn_simplified là từ Đại Lục tương đương
4. Tạo quest trắc nghiệm 1 câu có 4 lựa chọn về thuật ngữ quan trọng nhất
5. Viết daidai_message ngắn gọn, vui nhộn bằng tiếng Việt với emoji 🦜
6. Để "transcribed_text" rỗng (không phải audio)`;

    return await callGeminiText(userPrompt, env);
  } catch (err: any) {
    return jsonError(`analyze error: ${err.message}`, 500);
  }
}

// ── Gemini Multimodal (Audio + Text) ────────────────────────────────────────
async function callGeminiMultimodal(
  base64Audio: string,
  mimeType: string,
  userPrompt: string,
  env: Env
): Promise<Response> {
  const body = {
    system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{
      role: 'user',
      parts: [
        {
          inline_data: {
            mime_type: mimeType,
            data: base64Audio,
          },
        },
        { text: userPrompt },
      ],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: GEMINI_RESPONSE_SCHEMA,
      temperature: 0.6,
    },
  };

  return await callGeminiAPI(body, env);
}

// ── Gemini Text Only ─────────────────────────────────────────────────────────
async function callGeminiText(userPrompt: string, env: Env): Promise<Response> {
  const body = {
    system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: GEMINI_RESPONSE_SCHEMA,
      temperature: 0.7,
    },
  };

  return await callGeminiAPI(body, env);
}

// ── Gemini API Call chung ────────────────────────────────────────────────────
async function callGeminiAPI(body: unknown, env: Env): Promise<Response> {
  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!geminiRes.ok) {
    const errText = await geminiRes.text();
    return jsonError(`Gemini API error ${geminiRes.status}: ${errText}`, 502);
  }

  const geminiData: any = await geminiRes.json();
  const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    // Có thể Gemini trả về finishReason=SAFETY hoặc lỗi khác
    const reason = geminiData?.candidates?.[0]?.finishReason ?? 'UNKNOWN';
    return jsonError(`Gemini không trả về nội dung. Lý do: ${reason}`, 502);
  }

  try {
    const parsed = JSON.parse(rawText);
    return jsonResponse(parsed);
  } catch {
    // Fallback: trả raw text nếu parse thất bại
    return jsonResponse({ raw: rawText, terms: [], quest: null, daidai_message: rawText });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}
