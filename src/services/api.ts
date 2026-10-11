import { NativeModules } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import {
  AIAnalysisResult,
  AITerm,
  AISentenceItem,
  AIQuest,
  ChunkAnalysisItem,
  DialogueTurn,
  DialogueTurnResponse,
  VocabularyItem,
  WordContextExplanation,
  SituationalPhraseResult,
} from '../types';
import { buildOptions, buildOptionsWithMeta, buildOptionsWithPinyin, OptionWithMeta, shuffle } from '../utils/shuffle';
import { getField } from '../constants/fields';
import { getTopic } from '../constants/topics';
import { cleanChineseText, splitPinyinIntoSyllables, normalizeSearchText } from '../utils/similarity';
import {
  getCache,
  setCache,
  getFuzzyCache,
  setFuzzyCache,
  findOfflinePhraseFuzzy,
  findOfflinePhraseChinese,
  getSavedApiKeys,
  getOtherVietnameseMeanings,
  getOtherSentences,
  getSentenceChunksPool,
  getAllVocabulary,
  getPhraseCorrections,
  lookupLocalVocabulary,
  getUserTopics,
} from '../database/repository';
import {
  recordGeminiRequest,
  recordGemini429,
  checkAndNotifyLastKeyQuota,
  getKeyQuotaInfo,
  isLastAvailableKey,
  KeyQuotaInfo,
  GEMINI_RPM_LIMIT,
  GEMINI_RPD_LIMIT,
  getNextPacificMidnight,
} from './quotaTracker';

export {
  getKeyQuotaInfo,
  isLastAvailableKey,
  KeyQuotaInfo,
  GEMINI_RPM_LIMIT,
  GEMINI_RPD_LIMIT,
  getNextPacificMidnight,
};

// ─── Cấu hình API Keys & Xoay tua khi hết Quota (Key Rotation) ───────────────
let customUserKeys: string[] = [];

export function setCustomUserKeys(keys: string[]): void {
  customUserKeys = keys.map((k) => k.trim()).filter(Boolean);
  console.log(`[Gemini] Đã nạp ${customUserKeys.length} API Key từ cài đặt người dùng`);
}

// Tự động đồng bộ key từ SQLite khi khởi động
getSavedApiKeys()
  .then((saved) => {
    if (saved && saved.length > 0) {
      setCustomUserKeys(saved);
    }
  })
  .catch(() => {});

export function getGeminiKeys(): string[] {
  const envRaw = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '';
  const envKeys = envRaw
    .split(',')
    .map((k: string) => k.trim())
    .filter(Boolean);
  const combined = Array.from(new Set([...customUserKeys, ...envKeys]));
  return combined;
}

let currentKeyIndex = 0;

export function getActiveGeminiKey(): string {
  const keys = getGeminiKeys();
  if (keys.length === 0) return '';
  return keys[currentKeyIndex % keys.length];
}

export function rotateGeminiKey(): string {
  const keys = getGeminiKeys();
  if (keys.length <= 1) return getActiveGeminiKey();
  currentKeyIndex = (currentKeyIndex + 1) % keys.length;
  console.log(`[Gemini] 🔄 Đã tự động đổi sang API Key #${(currentKeyIndex % keys.length) + 1}/${keys.length}`);
  return getActiveGeminiKey();
}

export interface KeyValidationResult {
  valid: boolean;
  reason: string;
}

/**
 * Kiểm tra ngầm xem một Gemini API Key có hoạt động và hợp lệ không
 */
export async function testGeminiApiKey(key: string): Promise<KeyValidationResult> {
  const trimmed = key.trim();
  if (!trimmed) {
    return { valid: false, reason: 'Khóa không được để trống.' };
  }

  // Chặn nếu chuỗi có chứa khoảng trắng (như dán nhầm câu văn bản)
  if (/\s/.test(trimmed)) {
    return {
      valid: false,
      reason: 'Khóa API không được chứa khoảng trắng. Vui lòng kiểm tra lại.',
    };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6500);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${trimmed}`,
      {
        method: 'GET',
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (res.status === 200) {
      return { valid: true, reason: 'Khóa hoạt động tốt' };
    }

    if (res.status === 400 || res.status === 403) {
      const data: any = await res.json().catch(() => ({}));
      const errReason = data?.error?.details?.[0]?.reason || data?.error?.status;
      if (errReason === 'API_KEY_INVALID') {
        return { valid: false, reason: 'Khóa không tồn tại hoặc sai ký tự.' };
      }
      return { valid: false, reason: data?.error?.message || 'Khóa không được phép truy cập Gemini API.' };
    }

    if (res.status === 429) {
      return { valid: true, reason: 'Khóa hợp lệ (nhưng đang tạm chạm hạn mức RPM).' };
    }

    return { valid: false, reason: `Máy chủ Google báo mã ${res.status}.` };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { valid: false, reason: 'Hết thời gian chờ phản hồi (kết nối mạng quá chậm).' };
    }
    const msg = String(err?.message || '');
    if (msg.includes('Network request failed') || msg.includes('Failed to fetch')) {
      return { valid: false, reason: 'Không có kết nối Internet để kiểm tra khóa.' };
    }
    return { valid: false, reason: `Không thể kết nối tới Google: ${msg}` };
  }
}

const LOCAL_AI_URL = (process.env.EXPO_PUBLIC_LOCAL_AI_URL ?? '').replace(/\/$/, '');

let lastWorkingGpuUrl: string | null = null;

// Lấy danh sách các địa chỉ IP của Laptop có thể kết nối
export function getLocalGpuCandidates(): string[] {
  const candidates: string[] = [];

  // 1. Địa chỉ vừa kết nối thành công gần nhất được ưu tiên hàng đầu
  if (lastWorkingGpuUrl) {
    candidates.push(lastWorkingGpuUrl);
  }

  // 2. IP trực tiếp trên mạng nội bộ (LAN / Wi-Fi) - tốc độ nhanh nhất (<100ms)
  try {
    const scriptURL: string | undefined = NativeModules?.SourceCode?.scriptURL;
    if (scriptURL) {
      const match = scriptURL.match(/^https?:\/\/([^:/]+)/);
      if (match && match[1] && match[1] !== 'localhost' && match[1] !== '127.0.0.1') {
        candidates.push(`http://${match[1]}:8000`);
      }
    }
  } catch {
    // bỏ qua
  }

  // Fallback IP hiện tại của máy chủ trên mạng nội bộ (LAN / Wi-Fi)
  candidates.push('http://172.17.14.48:8000');
  candidates.push('http://172.17.14.63:8000');

  // 3. Cloudflare Tunnel URL (khi ở xa mạng gia đình)
  if (LOCAL_AI_URL) {
    candidates.push(LOCAL_AI_URL);
  }

  return Array.from(new Set(candidates));
}

// Thứ tự thử model: Ưu tiên model thông minh chuẩn (Gemini 2.5 Flash / Flash Latest) lên đầu,
// tự động fallback sang các model nhẹ hơn khi chạm hạn mức, xoay tua linh hoạt
const MODEL_POOL: string[] = Array.from(
  new Set(
    [
      process.env.EXPO_PUBLIC_GEMINI_MODEL,
      'gemini-2.5-flash',
      'gemini-flash-latest',
      'gemini-2.0-flash',
      'gemini-2.5-flash-lite',
      'gemini-flash-lite-latest',
      'gemini-1.5-flash',
    ].filter(Boolean) as string[]
  )
);

const RETRYABLE = new Set([400, 404, 429, 500, 502, 503, 504]);

// ─── Schemas ───────────────────────────────────────────────────────────────

const TERM_ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    original_term: { type: 'STRING' },
    tw_traditional: { type: 'STRING' },
    pinyin: { type: 'STRING' },
    vi: { type: 'STRING' },
  },
  required: ['original_term', 'tw_traditional', 'pinyin'],
};

const SENTENCE_ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    sentence_en: { type: 'STRING' },
    sentence_tw: { type: 'STRING' },
    pinyin: { type: 'STRING' },
    vi: { type: 'STRING' },
    topic: { type: 'STRING' },
    chunks: { type: 'ARRAY', items: { type: 'STRING' } },
    terms: { type: 'ARRAY', items: TERM_ITEM_SCHEMA },
  },
  required: ['sentence_en', 'sentence_tw', 'pinyin', 'vi', 'topic', 'chunks', 'terms'],
};

const ANALYSIS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: { type: 'ARRAY', items: SENTENCE_ITEM_SCHEMA },
  },
  required: ['items'],
};

const AUDIO_ANALYSIS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcribed_text: { type: 'STRING' },
    items: { type: 'ARRAY', items: SENTENCE_ITEM_SCHEMA },
  },
  required: ['transcribed_text', 'items'],
};

const SPEECH_TRANSCRIBE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcribed_text: { type: 'STRING' },
  },
  required: ['transcribed_text'],
};

export interface TranscribeResult {
  text: string;
  pinyin?: string;
  source: 'local' | 'gemini';
  error?: string;
}

const CHUNKS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    chunks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          tw: { type: 'STRING' },
          pinyin: { type: 'STRING' },
          vi: { type: 'STRING' },
        },
        required: ['tw', 'pinyin', 'vi'],
      },
    },
  },
  required: ['chunks'],
};

const WORD_CONTEXT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    word: { type: 'STRING' },
    pinyin: { type: 'STRING' },
    vi_in_context: { type: 'STRING' },
    en_in_context: { type: 'STRING' },
    general_meaning: { type: 'STRING' },
    example_tw: { type: 'STRING' },
    example_pinyin: { type: 'STRING' },
    example_vi: { type: 'STRING' },
  },
  required: ['word', 'pinyin', 'vi_in_context', 'en_in_context', 'general_meaning'],
};

const CONVERSATION_TURN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    translation_tw: { type: 'STRING' },
    pinyin: { type: 'STRING' },
    translation_vi: { type: 'STRING' },
    translation_en: { type: 'STRING' },
    chunks: { type: 'ARRAY', items: { type: 'STRING' } },
    terms: { type: 'ARRAY', items: TERM_ITEM_SCHEMA },
  },
  required: ['translation_tw', 'pinyin', 'translation_vi', 'translation_en', 'chunks'],
};

const INSTANT_TRANSLATION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    topic: { type: 'STRING' },
    translation_tw: { type: 'STRING' },
    pinyin: { type: 'STRING' },
    translation_vi: { type: 'STRING' },
    translation_en: { type: 'STRING' },
    chunks: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['topic', 'translation_tw', 'pinyin', 'translation_vi'],
};

const BACKGROUND_ANALYSIS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    chunks: { type: 'ARRAY', items: { type: 'STRING' } },
    terms: { type: 'ARRAY', items: TERM_ITEM_SCHEMA },
    natural_note: { type: 'STRING' },
  },
  required: ['chunks', 'terms'],
};

const DIALOGUE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    character_tw: { type: 'STRING' },
    character_pinyin: { type: 'STRING' },
    character_vi: { type: 'STRING' },
    character_en: { type: 'STRING' },
    options: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          tw: { type: 'STRING' },
          pinyin: { type: 'STRING' },
          vi: { type: 'STRING' },
          en: { type: 'STRING' },
        },
        required: ['tw', 'pinyin', 'vi', 'en'],
      },
    },
    is_final: { type: 'BOOLEAN' },
  },
  required: ['character_tw', 'character_pinyin', 'character_vi', 'character_en', 'options'],
};

const FULL_DIALOGUE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    user_role_name: { type: 'STRING' },
    partner_role_name: { type: 'STRING' },
    turns: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          character_name: { type: 'STRING' },
          character_tw: { type: 'STRING' },
          character_pinyin: { type: 'STRING' },
          character_vi: { type: 'STRING' },
          character_en: { type: 'STRING' },
          options: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                tw: { type: 'STRING' },
                pinyin: { type: 'STRING' },
                vi: { type: 'STRING' },
                en: { type: 'STRING' },
              },
              required: ['tw', 'pinyin', 'vi', 'en'],
            },
          },
          correct_index: { type: 'INTEGER' },
          is_final: { type: 'BOOLEAN' },
        },
        required: ['character_tw', 'character_pinyin', 'character_vi', 'character_en', 'options'],
      },
    },
  },
  required: ['turns', 'user_role_name', 'partner_role_name'],
};

const DISTRACTOR_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { i: { type: 'INTEGER' }, wrong: { type: 'ARRAY', items: { type: 'STRING' } } },
        required: ['i', 'wrong'],
      },
    },
  },
  required: ['items'],
};

const SYSTEM_INSTRUCTION =
  'Bạn là trợ lý học ngôn ngữ song ngữ Anh - Việt - Trung Phồn thể chuẩn Đài Loan (Taiwan Traditional Chinese).\n' +
  'TUYỆT ĐỐI TUÂN THỦ:\n' +
  '1. KHÔNG BAO GIỜ dùng chữ Hán Giản thể (Simplified Chinese). Luôn dùng Phồn thể Đài Loan.\n' +
  '2. Pinyin luôn có dấu thanh đầy đủ.\n' +
  '3. Trả về đúng định dạng JSON được yêu cầu, không kèm thêm lời giải thích nào.';

const CHINESE_SPEECH_SYSTEM_INSTRUCTION =
  'You are a strict Taiwanese Mandarin (Traditional Chinese) Speech-to-Text engine.\n' +
  'CRITICAL RULES:\n' +
  '1. The speaker is speaking Taiwanese Mandarin (Traditional Chinese / 繁體中文). Accurately capture their phonetics and tones.\n' +
  '2. Output MUST be 100% Traditional Chinese characters (繁體中文). NEVER output Simplified Chinese.\n' +
  '3. If a single isolated word or short phrase is spoken, transcribe the exact Traditional Chinese word or Taiwanese terminology matching those syllables. Do not hallucinate or expand into full sentences.\n' +
  '4. NEVER TRANSCRIBE INTO VIETNAMESE. NEVER TRANSLATE INTO VIETNAMESE. ZERO VIETNAMESE WORDS ALLOWED.\n' +
  '5. Return JSON: {"text": "chữ Hán nghe được", "pinyin": "pinyin có dấu thanh"}.';

// ─── Tự động phục hồi JSON khi bị đứt đoạn / thiếu token (JSON Auto-Repair) ──
function repairTruncatedJson(str: string): string {
  let inString = false;
  let escape = false;
  const stack: string[] = [];

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (char === '\\') {
      escape = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{' || char === '[') {
        stack.push(char);
      } else if (char === '}') {
        if (stack.length > 0 && stack[stack.length - 1] === '{') stack.pop();
      } else if (char === ']') {
        if (stack.length > 0 && stack[stack.length - 1] === '[') stack.pop();
      }
    }
  }

  let repaired = str.trim();
  // Nếu kết thúc giữa chừng trong một chuỗi chưa đóng ngoặc kép -> đóng lại
  if (inString) {
    repaired += '"';
  }

  // Loại bỏ dấu phẩy thừa ở cuối trước khi đóng ngoặc
  repaired = repaired.replace(/,\s*$/, '');

  // Đóng tất cả các ngoặc nhọn hoặc vuông còn mở theo thứ tự ngược lại
  while (stack.length > 0) {
    const open = stack.pop();
    if (open === '{') repaired += '}';
    else if (open === '[') repaired += ']';
  }

  return repaired;
}

// ─── Chuẩn hóa và Parse JSON an toàn (Bỏ markdown fences & text thừa) ─────────
function cleanAndParseJson<T>(raw: string): T {
  let text = String(raw || '').trim();
  // Bỏ markdown fences ```json ... ```
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
  }

  // Cắt từ ký tự mở JSON đầu tiên { hoặc [
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  let startIdx = -1;
  if (firstBrace !== -1 && firstBracket !== -1) {
    startIdx = Math.min(firstBrace, firstBracket);
  } else if (firstBrace !== -1) {
    startIdx = firstBrace;
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
  }

  if (startIdx > 0) {
    text = text.slice(startIdx);
  }

  // Cắt tới ký tự đóng JSON cuối cùng } hoặc ] nếu có
  const lastBrace = text.lastIndexOf('}');
  const lastBracket = text.lastIndexOf(']');
  const endIdx = Math.max(lastBrace, lastBracket);
  if (endIdx !== -1 && endIdx < text.length - 1) {
    text = text.slice(0, endIdx + 1);
  }

  // 1. Thử parse trực tiếp
  try {
    return JSON.parse(text) as T;
  } catch (initialErr) {
    // 2. Tự động phục hồi JSON nếu bị đứt đoạn giữa chừng
    try {
      const repaired = repairTruncatedJson(text);
      return JSON.parse(repaired) as T;
    } catch {
      throw initialErr;
    }
  }
}

// ─── Lõi gọi Gemini: Tự động đổi key & model khi lỗi hoặc hết quota ──────────
async function callGemini<T>(
  parts: any[],
  schema: object,
  maxTokens: number,
  customSystem?: string
): Promise<T> {
  const keys = getGeminiKeys();
  if (keys.length === 0) {
    throw new Error(
      'Bạn chưa thêm Gemini API Key. Vui lòng bấm biểu tượng Cài đặt (⚙️) ở góc trên để thêm API Key miễn phí nhé!'
    );
  }

  // Chuẩn hóa parts: nếu có inline_data (snake_case) thì đổi thành inlineData (camelCase)
  const normalizedParts = parts.map((p) => {
    if (p?.inline_data) {
      return {
        inlineData: {
          mimeType: p.inline_data.mime_type ?? p.inline_data.mimeType,
          data: p.inline_data.data,
        },
      };
    }
    return p;
  });

  let lastError = '';
  let hadQuotaExceeded = false;

  // Lặp qua tất cả API Keys có sẵn (nếu key hiện tại lỗi hoặc hết quota, chuyển sang key tiếp theo)
  const totalKeysToTry = Math.max(1, keys.length);
  for (let k = 0; k < totalKeysToTry; k++) {
    const currentKey = getActiveGeminiKey();
    let keySucceeded = false;
    let quotaHitOnThisKey = false;

    for (let i = 0; i < MODEL_POOL.length; i++) {
      const model = MODEL_POOL[i];
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${currentKey}`;

      const generationConfig: any = {
        responseMimeType: 'application/json',
        responseSchema: schema,
        temperature: 0.1,
        // Đặt tối thiểu 1024 token để đảm bảo JSON sinh ra không bao giờ bị cắt cụt
        maxOutputTokens: maxTokens > 0 ? Math.max(1024, maxTokens) : 2048,
      };

      try {
        const controller = new AbortController();
        // Tăng timeout lên 14s để phù hợp với đường truyền mạng di động
        const timer = setTimeout(() => controller.abort(), 14000);

        // Ghi nhận lượt gọi và kiểm tra cảnh báo nếu key cuối cùng sắp hết hạn mức
        recordGeminiRequest(currentKey);
        checkAndNotifyLastKeyQuota(keys, currentKey);

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            system_instruction: { parts: [{ text: customSystem ?? SYSTEM_INSTRUCTION }] },
            contents: [{ role: 'user', parts: normalizedParts }],
            generationConfig,
          }),
        });
        clearTimeout(timer);

        if (!res.ok) {
          const body = await res.text();
          lastError = `${model} (${res.status}): ${body.slice(0, 150)}`;

          if (res.status === 429) {
            hadQuotaExceeded = true;
            quotaHitOnThisKey = true;
            recordGemini429(currentKey, body);
            checkAndNotifyLastKeyQuota(keys, currentKey);
            console.warn(`[Gemini] Key #${(currentKeyIndex % keys.length) + 1} hết quota (429) trên model ${model}. Đổi ngay key mới...`);
            if (keys.length > 1) {
              rotateGeminiKey();
              break; // Thoát model loop của key này để thử ngay key mới
            }
          }

          if (RETRYABLE.has(res.status)) {
            console.warn(`[Gemini] Model ${model} gặp lỗi status ${res.status}, chuyển model kế tiếp...`);
            continue;
          }
          throw new Error(lastError);
        }

        const data: any = await res.json();
        const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!raw) {
          lastError = `${model}: phản hồi rỗng (${data?.candidates?.[0]?.finishReason ?? 'UNKNOWN'})`;
          console.warn(`[Gemini] ${lastError}, chuyển model...`);
          continue;
        }

        try {
          const parsed = cleanAndParseJson<T>(raw);
          // Đưa model thành công lên đầu pool để lần gọi sau phản hồi nhanh nhất
          if (i > 0) {
            MODEL_POOL.splice(i, 1);
            MODEL_POOL.unshift(model);
          }
          keySucceeded = true;
          return parsed;
        } catch (parseErr: any) {
          lastError = `${model} parse error: ${parseErr?.message}`;
          console.warn(`[Gemini] Model ${model} sinh JSON lỗi (${parseErr?.message}), chuyển model...`);
          continue;
        }
      } catch (e: any) {
        lastError = e?.message ?? String(e);
        if (lastError.includes('Network request failed') || lastError.includes('Failed to fetch')) {
          throw new Error('Không có kết nối Internet. Vui lòng kiểm tra lại kết nối Wi-Fi hoặc 4G/5G.');
        }
        console.warn(`[Gemini] Model ${model} gặp ngoại lệ (${lastError}), đang đổi model...`);
      }
    }

    if (keySucceeded) break;

    // Nếu toàn bộ model trên key hiện tại đều thất bại và còn key khác:
    // Tự động xoay sang key tiếp theo ngay lập tức thay vì dừng lại!
    if (!quotaHitOnThisKey && keys.length > 1 && k < totalKeysToTry - 1) {
      console.warn(`[Gemini] Key #${(currentKeyIndex % keys.length) + 1} gặp lỗi trên các model, tự động chuyển sang API Key #${((currentKeyIndex + 1) % keys.length) + 1}...`);
      rotateGeminiKey();
    }
  }

  if (hadQuotaExceeded) {
    throw new Error(
      'Hết Quota Gemini (429): Tất cả các API Key hiện có đều đã chạm hạn mức trong ngày. ' +
      'Vui lòng mở file .env thêm Key mới từ tài khoản Google khác hoặc đợi Google reset quota nhé!'
    );
  }

  throw new Error(`Các model Gemini đang bận hoặc lỗi: ${lastError}`);
}

// ─── Local GPU Transcription (Whisper trên Laptop GPU) ─────────────────────

/** Kiểm tra nhanh xem server GPU laptop có khả dụng không (timeout 1.2s) */
async function pingServer(baseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

// ─── BỘ LỌC ẢO GIÁC YOUTUBE SUBTITLES CỦA WHISPER (CLIENT SIDE) ────────
const WHISPER_HALLUCINATIONS = [
  /hãy\s+subscribe\s+cho\s+kênh/i,
  /đăng\s+ký\s+kênh.*để\s+không\s+bỏ\s+lỡ/i,
  /ghiền\s+mì\s+gõ/i,
  /la\s+la\s+school/i,
  /đừng\s+quên\s+(like|subscribe|đăng\s+ký)/i,
  /cảm\s+ơn\s+các\s+bạn\s+đã\s+(theo\s+dõi|xem)/i,
  /chúc\s+các\s+bạn\s+(một\s+ngày|vui\s+vẻ|xem\s+video)/i,
  /hẹn\s+gặp\s+lại\s+các\s+bạn/i,
  /subtitles?\s+by/i,
  /thanks\s+for\s+watching/i,
  /please\s+(subscribe|like)/i,
  /like\s+and\s+subscribe/i,
];

export function isWhisperHallucination(text: string): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  return WHISPER_HALLUCINATIONS.some((re) => re.test(trimmed));
}

/** Phiên âm qua GPU máy tính, hỗ trợ tham số language và field (chuyên ngành để Whisper prompt) */
export async function transcribeLocal(
  uri: string,
  language?: string,
  field?: string,
  durationMs?: number
): Promise<{ text: string; language?: string; error?: string } | null> {
  const candidates = getLocalGpuCandidates();
  if (candidates.length === 0) return null;

  for (const baseUrl of candidates) {
    try {
      // 1. Kiểm tra nhanh server trong 1.2s để tránh bị treo khi tắt laptop
      const alive = await pingServer(baseUrl);
      if (!alive) {
        console.log(`[Local GPU] Server ${baseUrl} không phản hồi (offline/timeout), bỏ qua.`);
        continue;
      }

      console.log(`[Local GPU] Gửi âm thanh tới: ${baseUrl}/transcribe (field: ${field ?? 'it'})`);
      const params: Record<string, string> = {};
      if (language) params.language = language;
      if (field) params.field = field;
      if (durationMs) params.duration_ms = String(durationMs);

      const uploadRes = await FileSystem.uploadAsync(`${baseUrl}/transcribe`, uri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: 'audio',
        mimeType: 'audio/m4a',
        parameters: Object.keys(params).length > 0 ? params : undefined,
      });

      if (uploadRes.status === 200) {
        const data = JSON.parse(uploadRes.body);
        if (data?.error) {
          console.log(`[Local GPU - ${baseUrl}] Server trả về lỗi:`, data.error);
          return { text: '', language: data.language, error: data.error };
        }
        if (data?.text !== undefined) {
          lastWorkingGpuUrl = baseUrl;
          let textResult = String(data.text).trim();
          if (isWhisperHallucination(textResult)) {
            console.log(`[Local GPU - ${baseUrl}] 🛑 Đã chặn ảo giác YouTube Whisper: "${textResult}"`);
            textResult = '';
          }
          console.log(
            `[Local GPU - ${baseUrl}] Nhận diện thành công (${language ?? 'auto'}):`,
            textResult
          );
          return {
            text: textResult,
            language: data.language,
          };
        }
      } else {
        console.log(`[Local GPU - ${baseUrl}] Phản hồi HTTP status: ${uploadRes.status}`);
      }
    } catch (e: any) {
      console.log(`[Local GPU] uploadAsync thất bại trên ${baseUrl}:`, e?.message || e);
    }
  }

  return null;
}

/** Tinh chỉnh câu văn bản (giữ nguyên khi không dùng Qwen) */
export async function refineTextWithLocalQwen(text: string, _field: string = 'it'): Promise<string> {
  return text;
}

// ─── Audio → base64 ─────────────────────────────────────────────────────────
async function audioUriToBase64(uri: string) {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const ext = uri.split('.').pop()?.toLowerCase() ?? 'm4a';
  const mimeMap: Record<string, string> = {
    m4a: 'audio/m4a', mp4: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac', webm: 'audio/webm', ogg: 'audio/ogg',
  };
  return { base64, mimeType: mimeMap[ext] ?? 'audio/m4a' };
}

/**
 * Nhận diện giọng nói linh hoạt (hỗ trợ tiếng Trung Phồn thể Đài Loan, tiếng Việt, hoặc đa ngữ)
 * - Lớp 1: Thử Local GPU / CPU server trên laptop với auto-detection đa ngữ (timeout 7.5s)
 * - Lớp 2: Tự động fallback sang Gemini Cloud Multimodal Audio chuẩn xác, đa ngữ
 */
export async function transcribeSpeech(
  uri: string,
  targetLang?: string,
  fieldKey?: string,
  durationMs?: number
): Promise<TranscribeResult | null> {
  // Lớp 1: Thử Local GPU / CPU của laptop (timeout 7.5s)
  try {
    const localTimeout = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error('local_timeout')), 7500)
    );
    const localRes = await Promise.race([
      transcribeLocal(uri, targetLang, fieldKey, durationMs),
      localTimeout,
    ]);
    if (localRes && localRes.text && localRes.text.trim()) {
      let t = localRes.text.trim();
      if (targetLang === 'zh') {
        t = cleanChineseText(t);
      }
      if (t) return { text: t, source: 'local' };
    }
  } catch {
    // Local server tắt hoặc timeout -> tiếp tục sang Lớp 2
  }

  // Lớp 2: Fallback sang Gemini Cloud Multimodal Audio
  if (!getActiveGeminiKey()) return null;
  try {
    const { base64, mimeType } = await audioUriToBase64(uri);

    const isShortAudio = typeof durationMs === 'number' && durationMs > 0 && durationMs <= 1800;
    let instruction = '';
    let customSystemToUse: string | undefined = undefined;

    if (targetLang === 'zh') {
      customSystemToUse = CHINESE_SPEECH_SYSTEM_INSTRUCTION;
      instruction = isShortAudio
        ? 'Nghe đoạn âm thanh ngắn này (phát âm MỘT TỪ ĐƠN LẺ hoặc CỤM TỪ NGẮN tiếng Trung Phồn thể Đài Loan) và chép lại trung thực 100% ngữ âm người nói phát ra kèm Pinyin có dấu thanh điệu.\n' +
          'QUY TẮC BẮT BUỘC:\n' +
          '1. Tập trung vào âm thanh ngữ âm thực tế (Phonetics/Pinyin). Không tự ý ghép thành câu, không suy đoán ngữ cảnh, không tự đổi sang từ thông dụng khác nếu âm thanh không khớp.\n' +
          '2. Nếu có nhiều chữ Hán đồng âm, ưu tiên từ vựng Phồn thể chuẩn Đài Loan (Taiwan Traditional Chinese).\n' +
          '3. Nếu âm thanh im lặng hoặc chỉ có tiếng ồn, trả về text: "", pinyin: "".\n' +
          '4. TUYỆT ĐỐI KHÔNG GHI TIẾNG VIỆT, KHÔNG DÙNG GIẢN THỂ.\n' +
          '5. Chỉ trả về JSON với trường text và pinyin.'
        : 'Nghe đoạn âm thanh này và chép lại trung thực nguyên văn 100% từng từ từng âm người nói phát ra bằng tiếng Trung Phồn thể chuẩn Đài Loan (Taiwan Traditional Chinese) kèm Pinyin có dấu thanh điệu.\n' +
          'QUY TẮC BẮT BUỘC:\n' +
          '1. Người nói phát âm chữ nào thì ghi đúng chữ đó, tuyệt đối không tự ý sửa từ, không suy đoán ngữ cảnh, không tự thêm bớt từ.\n' +
          '2. Nếu âm thanh im lặng, chỉ có tiếng thở hoặc tiếng ồn môi trường mà không có tiếng nói rõ ràng, trả về text: "", pinyin: "". TUYỆT ĐỐI KHÔNG TỰ BỊA RA TỪ NGỮ.\n' +
          '3. TUYỆT ĐỐI KHÔNG GHI TIẾNG VIỆT, KHÔNG DÙNG GIẢN THỂ.\n' +
          '4. Chỉ trả về JSON với trường text và pinyin.';
    } else if (targetLang === 'vi') {
      instruction =
        'Nghe đoạn âm thanh này và chép lại trung thực nguyên văn 100% từng từ từng âm người nói phát ra (Verbatim Speech-to-Text).\n' +
        'Quy tắc:\n' +
        '1. Người nói phát âm chữ nào thì ghi đúng chữ đó, tuyệt đối không tự ý sửa từ, không suy đoán ngữ cảnh, không tự thêm bớt từ.\n' +
        '2. Chép lại chính xác nội dung bằng chữ Quốc ngữ tiếng Việt chuẩn xác (nếu có từ tiếng Anh xen kẽ thì giữ nguyên chữ Latinh).\n' +
        '3. Chỉ trả về lời nói đã nghe được trong trường text, không kèm lời giải thích nào.';
    } else {
      instruction = isShortAudio
        ? 'Nghe đoạn âm thanh ngắn này (phát âm MỘT TỪ ĐƠN LẺ hoặc CỤM THUẬT NGỮ NGẮN) và chép lại trung thực 100% từng từ từng âm người nói phát ra (có thể là tiếng Việt, tiếng Anh, hoặc tiếng Trung Phồn thể chuẩn Đài Loan) kèm Pinyin nếu là tiếng Trung.\n' +
          'Quy tắc:\n' +
          '1. Tập trung vào âm thanh ngữ âm thực tế. Tuyệt đối không tự ý suy đoán ghép thành câu dài, không tự thêm bớt từ.\n' +
          '2. Phần tiếng Trung BẮT BUỘC dùng chữ Phồn thể chuẩn Đài Loan (Taiwan Traditional Chinese), TUYỆT ĐỐI KHÔNG DÙNG GIẢN THỂ.\n' +
          '3. Giữ nguyên các từ tiếng Anh hoặc tiếng Việt viết bằng chữ Latinh nếu có.\n' +
          '4. Chỉ trả về JSON với trường text và pinyin.'
        : 'Nghe đoạn âm thanh này và chép lại trung thực nguyên văn 100% từng từ từng âm người nói phát ra (Verbatim Speech-to-Text, có thể là tiếng Việt, tiếng Anh, hoặc tiếng Trung Phồn thể chuẩn Đài Loan).\n' +
          'Quy tắc:\n' +
          '1. Người nói phát âm chữ nào thì ghi đúng chữ đó, tuyệt đối không tự ý sửa từ, không suy đoán ngữ cảnh, không tự thêm bớt từ.\n' +
          '2. Phần tiếng Trung BẮT BUỘC dùng chữ Phồn thể chuẩn Đài Loan (Taiwan Traditional Chinese), TUYỆT ĐỐI KHÔNG DÙNG GIẢN THỂ.\n' +
          '3. Giữ nguyên các từ tiếng Anh hoặc tiếng Việt viết bằng chữ Latinh nếu có.\n' +
          '4. Chỉ trả về lời nói đã nghe được trong trường text, không kèm lời giải thích nào.';
    }

    const speechSchema = {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING' },
        pinyin: { type: 'STRING' },
        transcribed_text: { type: 'STRING' },
      },
    };

    const res = await callGemini<{ text?: string; pinyin?: string; transcribed_text?: string }>(
      [
        { text: instruction },
        { inlineData: { mimeType, data: base64 } },
      ],
      speechSchema,
      isShortAudio ? 180 : 250,
      customSystemToUse
    );
    let text = (res?.text || res?.transcribed_text || '').trim();

    // Chặn triệt để nếu đang nhận diện tiếng Trung mà AI hallucinate ra tiếng Việt
    if (targetLang === 'zh') {
      const hasVietnamese = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(text);
      if (hasVietnamese) {
        console.warn(`[Gemini Cloud STT] 🛑 Đã chặn ảo giác tiếng Việt: "${text}"`);
        return null;
      }
      text = cleanChineseText(text);
    }

    if (text && !isWhisperHallucination(text)) {
      const pinyinResult = res?.pinyin ? String(res.pinyin).trim() : undefined;
      return { text, pinyin: pinyinResult, source: 'gemini' };
    }
  } catch (err: any) {
    console.log('[Gemini Cloud STT] Lỗi nhận diện âm thanh:', err?.message || err);
  }

  return null;
}

// ─── Tách câu tại máy (0 token) ─────────────────────────────────────────────
export function splitIntoSentences(text: string): string[] {
  if (!text || !text.trim()) return [];

  // Tách theo dấu chấm, chấm hỏi, chấm than hoặc xuống dòng
  const rawSentences = text
    .split(/[\n.?!]+/)
    .map((s) => s.trim())
    .filter((s) => {
      // Bỏ câu rỗng hoặc dưới 2 từ
      const wordCount = s.split(/\s+/).filter(Boolean).length;
      return wordCount >= 2;
    });

  // Tối đa 5 câu mỗi lần, mỗi câu tối đa 300 ký tự
  return rawSentences.slice(0, 5).map((s) => s.slice(0, 300));
}

// ─── Làm sạch và chuẩn hóa khẩu ngữ bản xứ (Natural TW Sanitizers) ───────────
export function sanitizeNaturalTw(naturalTw?: string): string | undefined {
  if (!naturalTw) return undefined;
  let text = cleanChineseText(naturalTw.trim());
  // Bỏ dấu ngoặc giải thích (ví dụ: 哈囉（最常見的口語...） -> 哈囉)
  text = text.replace(/（[^）]*）|\([^)]*\)/g, '').trim();
  // Nếu có xuống dòng, chỉ lấy dòng đầu
  if (text.includes('\n')) {
    text = text.split('\n')[0].trim();
  }
  // Nếu quá dài (> 35 chữ), chỉ lấy vế/câu đầu tiên kết thúc bằng dấu câu
  if (text.length > 35) {
    const match = text.match(/^[^。！？!?,，]+[。！？!?,，]?/);
    if (match && match[0].trim().length >= 2) {
      text = match[0].trim();
    } else {
      text = text.slice(0, 30).trim();
    }
  }
  return text || undefined;
}

export function sanitizeNaturalPinyin(pinyin?: string): string | undefined {
  if (!pinyin) return undefined;
  let text = pinyin.trim().replace(/（[^）]*）|\([^)]*\)/g, '').trim();
  if (text.includes('\n')) {
    text = text.split('\n')[0].trim();
  }
  return text || undefined;
}

export function sanitizeNaturalNote(note?: string): string | undefined {
  if (!note) return undefined;
  let text = note.trim();
  if (text.includes('\n')) {
    text = text.split('\n')[0].trim();
  }
  if (text.length > 120) {
    text = text.slice(0, 117).trim() + '...';
  }
  return text || undefined;
}

// ─── Kiểm tra kết quả câu tại máy ──────────────────────────────────────────
function validateAndCleanSentenceItem(item: any): AISentenceItem | null {
  if (!item?.sentence_tw || !item?.sentence_en) return null;

  const sentence_en = String(item.sentence_en).trim();
  const sentence_tw = String(item.sentence_tw).trim();
  const pinyin = String(item.pinyin || '').trim();
  const vi = String(item.vi || '').trim();
  const topic = getTopic(item.topic).key;

  // Kiểm tra chunks: ghép lại phải bằng sentence_tw đã làm sạch
  let chunks: string[] = [];
  if (Array.isArray(item.chunks) && item.chunks.length >= 2 && item.chunks.length <= 6) {
    const validChunks = item.chunks.map((c: any) => String(c).trim()).filter(Boolean);
    const joinedCleaned = cleanChineseText(validChunks.join(''));
    const targetCleaned = cleanChineseText(sentence_tw);
    if (joinedCleaned === targetCleaned) {
      chunks = validChunks;
    }
  }

  // Lọc và làm sạch terms
  const terms: AITerm[] = [];
  if (Array.isArray(item.terms)) {
    const seen = new Set<string>();
    for (const t of item.terms) {
      if (t?.original_term && t?.tw_traditional) {
        const orig = String(t.original_term).trim();
        const tw = String(t.tw_traditional).trim();
        const key = orig.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          terms.push({
            original_term: orig,
            tw_traditional: tw,
            pinyin: String(t.pinyin || '').trim(),
            vi: t.vi ? String(t.vi).trim() : undefined,
          });
        }
      }
    }
  }

  return {
    sentence_en,
    sentence_tw,
    pinyin,
    vi,
    topic,
    chunks,
    terms,
  };
}

// ─── API Phân tích câu & Phân loại thông minh ──────────────────────────────

/** Phân tích văn bản (dán hoặc đã nhận diện) với 1 lần gọi Gemini duy nhất */
export async function analyzeText(
  text: string,
  fieldKey: string,
  spokenPinyin?: string
): Promise<AIAnalysisResult> {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const cacheKey = spokenPinyin
    ? `analyze2:${fieldKey}:${normalized}:${spokenPinyin.trim().toLowerCase()}`
    : `analyze2:${fieldKey}:${normalized}`;

  // Kiểm tra SQLite cache
  try {
    const cached = await getCache(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as AIAnalysisResult;
      if (parsed?.items && parsed.items.length > 0) {
        return parsed;
      }
    }
  } catch {
    // bỏ qua lỗi đọc cache
  }

  // Kiểm tra Offline Phrasebook (0ms, 0 token)
  try {
    const hasChinese = /[\u4e00-\u9fa5]/.test(text);
    const offline = hasChinese
      ? await findOfflinePhraseChinese(text.trim())
      : await findOfflinePhraseFuzzy(text.trim());
    if (offline) {
      return {
        items: [
          {
            sentence_en: offline.en || text.trim(),
            sentence_tw: offline.tw,
            pinyin: offline.pinyin,
            vi: offline.vi,
            topic: offline.category,
            chunks: [offline.tw],
            terms: [],
          },
        ],
        terms: [],
      };
    }
  } catch {
    // bỏ qua
  }

  const trimmed = text.trim();
  const sentences = splitIntoSentences(trimmed);
  const inputToAnalyze = sentences.length > 0 ? sentences.join('\n- ') : trimmed;
  const isSingleWordOrShort =
    sentences.length <= 1 &&
    trimmed.length <= 6 &&
    !/[\n.?!,，。？！]/.test(trimmed) &&
    trimmed.split(/\s+/).length <= 3;
  const field = getField(fieldKey);

  let topicsListDesc = 'other (Khác), work (Công sở), daily (Đời sống), food (Ăn uống), shopping (Mua sắm), travel (Di chuyển), greeting (Chào hỏi), feelings (Cảm xúc), health (Sức khỏe)';
  try {
    const userTopics = await getUserTopics();
    if (userTopics && userTopics.length > 0) {
      topicsListDesc = userTopics.map((t) => `${t.key} (${t.label})`).join(', ');
    }
  } catch {}

  const fieldPromptDesc = isSingleWordOrShort
    ? (field.key !== 'daily'
        ? `Lĩnh vực chuyên ngành tham chiếu: ${field.prompt} (${field.label}).\nLƯU Ý QUAN TRỌNG: Đầu vào là MỘT TỪ ĐƠN HOẶC ĐOẢN NGỮ NGẮN ("${trimmed}"). Hãy ưu tiên dịch đúng nghĩa thực tế gốc tự nhiên nhất của từ theo chuẩn tiếng Trung Phồn thể Đài Loan. CHỈ phân loại vào thuật ngữ chuyên ngành ${field.label} nếu từ này thực sự là thuật ngữ kỹ thuật đặc thù của ngành đó, tuyệt đối không gượng ép gán ghép sai nghĩa đời thường.`
        : `Ngữ cảnh: Đời sống & giao tiếp sinh hoạt thường ngày chuẩn Đài Loan (Taiwan Traditional Chinese).`)
    : `Lĩnh vực chuyên ngành: ${field.prompt} (${field.label}).`;

  const pinyinBridgePrompt = spokenPinyin
    ? `\nTHÔNG TIN NGỮ ÂM BỔ TRỢ: Phiên âm Pinyin ghi nhận từ mic là: "${spokenPinyin}". Nếu chữ Hán đầu vào "${trimmed}" có dấu hiệu lệch âm do bộ gõ/STT hoặc là từ Giản thể Đại Lục, hãy đối chiếu với Pinyin "${spokenPinyin}" để khôi phục đúng chữ Hán Phồn thể chuẩn Đài Loan tương ứng.\n`
    : '';

  const promptText =
    `${fieldPromptDesc}\n` +
    `Danh sách các chủ đề (topic) hợp lệ: ${topicsListDesc}.\n` +
    `${pinyinBridgePrompt}\n` +
    `Nhiệm vụ cho từng câu trong đoạn văn sau (đầu vào có thể là tiếng Việt, tiếng Anh, hoặc tiếng Trung Phồn thể Đài Loan - kể cả khi có từ mượn tiếng Anh xen kẽ):\n` +
    `- ${inputToAnalyze}\n\n` +
    `Quy tắc phân tích đa ngữ:\n` +
    `A. NẾU ĐẦU VÀO LÀ TIẾNG TRUNG PHỒN THỂ (kể cả câu có chêm tiếng Anh):\n` +
    `1. sentence_tw: GIỮ NGUYÊN VĂN 100% cách nói đó của người Đài (giữ nguyên cả từ tiếng Anh nếu có, không đổi sang từ Đại Lục, không tự ý sửa đổi từ ngữ đã nói).\n` +
    `2. pinyin: Phiên âm Pinyin tương ứng có đầy đủ dấu thanh, các âm tiết CÁCH NHAU BẰNG DẤU CÁCH rõ ràng (spaced Pinyin, giữ nguyên từ tiếng Anh nếu có xen kẽ).\n` +
    `3. vi: Dịch sang tiếng Việt tự nhiên, thoát ý, đúng ngữ cảnh đời thực (không dịch máy móc).\n` +
    `4. sentence_en: Dịch sang câu tiếng Anh giao tiếp tự nhiên, hoàn chỉnh.\n` +
    `5. terms: Trích xuất thuật ngữ chuyên môn hoặc từ khóa quan trọng trong câu (nếu có). Nếu câu có từ mượn tiếng Anh, hãy bổ sung từ tiếng Trung Phồn thể chuẩn Đài Loan tương đương trong tw_traditional để người học đối chiếu. Nếu không có thuật ngữ chuyên môn thì để mảng rỗng [].\n\n` +
    `B. NẾU ĐẦU VÀO LÀ TIẾNG VIỆT HOẶC TIẾNG ANH:\n` +
    `1. sentence_tw: Dịch sang tiếng Trung Phồn thể chuẩn Đài Loan tự nhiên (TUYỆT ĐỐI KHÔNG DÙNG GIẢN THỂ, KHÔNG DÙNG TỪ ĐẠI LỤC, KHÔNG DỊCH MÁY MÓC).\n` +
    `2. pinyin: Phiên âm Pinyin có đầy đủ dấu thanh, các âm tiết CÁCH NHAU BẰNG DẤU CÁCH rõ ràng (spaced Pinyin).\n` +
    `3. vi: Nghĩa tiếng Việt tự nhiên, ngắn gọn.\n` +
    `4. sentence_en: Chuẩn hóa thành câu tiếng Anh hoàn chỉnh, tự nhiên.\n` +
    `5. terms: Chỉ trích xuất thuật ngữ chuyên ngành THUỘC LĨNH VỰC "${field.label}". Từ phổ thông hằng ngày KHÔNG được đưa vào terms. Nếu không có thuật ngữ chuyên môn thì để mảng rỗng [].\n\n` +
    `C. CHUNG CHO MỌI CÂU:\n` +
    `- topic: Chọn đúng 1 khóa (key) trong danh sách chủ đề trên. Nếu không rõ ràng hoặc không khớp chủ đề nào, bắt buộc chọn "other".\n` +
    `- chunks: Tách sentence_tw thành 2 đến 6 cụm từ có nghĩa, khi ghép các cụm lại phải khớp hoàn toàn sentence_tw.`;

  const tokenBudget = isSingleWordOrShort
    ? 450
    : Math.min(1400, Math.max(600, sentences.length * 280));
  const rawResult = await callGemini<{ items: any[] }>(
    [{ text: promptText }],
    ANALYSIS_SCHEMA,
    tokenBudget
  );

  const cleanedItems: AISentenceItem[] = [];
  const allTerms: AITerm[] = [];
  const seenTermKeys = new Set<string>();

  for (const rawItem of rawResult?.items ?? []) {
    const valid = validateAndCleanSentenceItem(rawItem);
    if (valid) {
      cleanedItems.push(valid);
      for (const t of valid.terms) {
        const k = t.original_term.toLowerCase();
        if (!seenTermKeys.has(k)) {
          seenTermKeys.add(k);
          allTerms.push(t);
        }
      }
    }
  }

  const finalResult: AIAnalysisResult = {
    items: cleanedItems,
    terms: allTerms,
  };

  // Lưu cache
  if (cleanedItems.length > 0) {
    try {
      await setCache(cacheKey, JSON.stringify(finalResult));
    } catch {
      // bỏ qua lỗi cache
    }
  }

  return finalResult;
}

/** Xử lý âm thanh ghi âm: GPU Whisper trước, fallback Gemini Multimodal */
export async function processAudio(
  audioUri: string,
  fieldKey: string,
  durationMs?: number
): Promise<AIAnalysisResult> {
  const isShortAudio = typeof durationMs === 'number' && durationMs > 0 && durationMs <= 1800;

  // 1. Thử nhận diện bằng GPU của laptop nếu server đang chạy (timeout tối đa 7.5s)
  try {
    const localTimeout = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error('local_timeout')), 7500)
    );
    const localRes = await Promise.race([
      transcribeLocal(audioUri, undefined, fieldKey, durationMs),
      localTimeout,
    ]);
    if (localRes?.text && !isWhisperHallucination(localRes.text)) {
      // 1.1: Kiểm tra Offline Phrasebook 2 chiều (0ms, 0 token)
      try {
        const hasChinese = /[\u4e00-\u9fa5]/.test(localRes.text);
        const offline = hasChinese
          ? await findOfflinePhraseChinese(localRes.text)
          : await findOfflinePhraseFuzzy(localRes.text);
        if (offline) {
          console.log('[processAudio] ⚡ Khớp Offline Phrasebook 0 token:', offline.tw);
          return {
            transcribed_text: localRes.text,
            items: [
              {
                sentence_en: offline.en || localRes.text,
                sentence_tw: offline.tw,
                pinyin: offline.pinyin,
                vi: offline.vi,
                topic: offline.category,
                chunks: [offline.tw],
                terms: [],
              },
            ],
            terms: [],
            source: 'local',
          };
        }
      } catch {
        // bỏ qua
      }

      const analysis = await analyzeText(localRes.text, fieldKey);
      return {
        ...analysis,
        transcribed_text: localRes.text,
        source: 'local',
      };
    }
  } catch {
    // Laptop tắt hoặc không phản hồi -> tiếp tục fallback Gemini
  }

  // 2. Fallback: gửi file âm thanh lên Gemini Multimodal
  const { base64, mimeType } = await audioUriToBase64(audioUri);

  // 2.1: Phiên âm lời nói qua Gemini (nhanh ~1.5s, hỗ trợ Việt, Anh, và Trung Phồn thể chêm Anh)
  const speechRes = await callGemini<{ text: string; pinyin?: string }>(
    [
      {
        text: isShortAudio
          ? 'Nghe đoạn âm thanh ngắn này (phát âm MỘT TỪ ĐƠN LẺ hoặc CỤM THUẬT NGỮ NGẮN) và chép lại trung thực 100% ngữ âm người nói phát ra (Verbatim Speech-to-Text, có thể là tiếng Việt, tiếng Anh, hoặc tiếng Trung Phồn thể chuẩn Đài Loan) kèm Pinyin có dấu thanh điệu.\n' +
            'Quy tắc:\n' +
            '1. Tập trung vào âm thanh ngữ âm thực tế. Tuyệt đối không tự ý suy đoán ghép thành câu dài, không tự thêm bớt từ.\n' +
            '2. Phần tiếng Trung BẮT BUỘC dùng chữ Phồn thể chuẩn Đài Loan (Taiwan Traditional Chinese), TUYỆT ĐỐI KHÔNG DÙNG GIẢN THỂ.\n' +
            '3. Giữ nguyên các từ tiếng Anh hoặc tiếng Việt viết bằng chữ Latinh nếu có.\n' +
            '4. Trả về JSON: text (lời nói đã nghe được) và pinyin (nếu là tiếng Trung).'
          : 'Nghe đoạn âm thanh này và chép lại trung thực nguyên văn 100% từng từ từng âm người nói phát ra (Verbatim Speech-to-Text, có thể là tiếng Việt, tiếng Anh, hoặc tiếng Trung Phồn thể chuẩn Đài Loan).\n' +
            'Quy tắc:\n' +
            '1. Người nói phát âm chữ nào thì ghi đúng chữ đó, tuyệt đối không tự ý sửa từ, không suy đoán ngữ cảnh, không tự thêm bớt từ.\n' +
            '2. Phần tiếng Trung BẮT BUỘC dùng chữ Phồn thể chuẩn Đài Loan (Taiwan Traditional Chinese), TUYỆT ĐỐI KHÔNG DÙNG GIẢN THỂ.\n' +
            '3. Giữ nguyên các từ tiếng Anh hoặc tiếng Việt viết bằng chữ Latinh nếu có.\n' +
            '4. Chỉ trả về lời nói đã nghe được trong trường text, không kèm lời giải thích nào.',
      },
      { inlineData: { mimeType, data: base64 } },
    ],
    { type: 'OBJECT', properties: { text: { type: 'STRING' }, pinyin: { type: 'STRING' } }, required: ['text'] },
    isShortAudio ? 180 : 300
  );

  const spokenText = speechRes?.text?.trim() ?? '';
  const spokenPinyin = speechRes?.pinyin?.trim();
  if (!spokenText) {
    return {
      transcribed_text: '',
      items: [],
      terms: [],
      source: 'gemini',
    };
  }

  // 2.2: Phân tích ngữ nghĩa chuyên ngành bằng analyzeText (có cache SQLite, chuẩn hóa Phồn thể)
  const analysis = await analyzeText(spokenText, fieldKey, spokenPinyin);
  return {
    ...analysis,
    transcribed_text: spokenText,
    source: 'gemini',
  };
}

// ─── Phân tích cụm từ theo yêu cầu (On-demand Chunk Breakdown) ─────────────

export async function analyzeChunks(
  sentenceTw: string,
  existingChunks?: string[]
): Promise<ChunkAnalysisItem[]> {
  const normSentence = cleanChineseText(sentenceTw);
  const cacheKey = `chunks:${normSentence}`;

  // Kiểm tra cache SQLite
  try {
    const cached = await getCache(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as ChunkAnalysisItem[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // bỏ qua
  }

  const chunksHint = existingChunks && existingChunks.length >= 2
    ? `Các cụm đã tách: ${existingChunks.join(', ')}.`
    : 'Hãy tự tách câu thành 2-5 cụm từ có nghĩa.';

  const promptText =
    `Phân tích câu Phồn thể Đài Loan: "${sentenceTw}".\n` +
    `${chunksHint}\n` +
    `Với mỗi cụm từ: tw (chữ Phồn thể Đài Loan, KHÔNG Giản thể), pinyin (có dấu), vi (nghĩa tiếng Việt ngắn 1-3 từ). ` +
    `Không giải thích dài.`;

  const res = await callGemini<{ chunks: ChunkAnalysisItem[] }>(
    [{ text: promptText }],
    CHUNKS_SCHEMA,
    500
  );

  const result = res.chunks ?? [];
  if (result.length > 0) {
    try {
      await setCache(cacheKey, JSON.stringify(result));
    } catch {
      // bỏ qua
    }
  }

  return result;
}

// ─── Giải thích từ trong ngữ cảnh cụ thể (In-Context Word Explanation) ──────

export async function explainWordInContext(
  word: string,
  fullSentence: string,
  fieldKey?: string,
  forceAI: boolean = false
): Promise<WordContextExplanation> {
  const normWord = cleanChineseText(word.trim());
  const normSentence = cleanChineseText(fullSentence.trim());
  const cacheKey = `wordctx:${normWord}:${normSentence}`;

  // 1. Kiểm tra cache SQLite (0ms, 0 API quota)
  if (!forceAI) {
    try {
      const cached = await getCache(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached) as WordContextExplanation;
        if (parsed?.word && parsed?.vi_in_context) return { ...parsed, is_local: false };
      }
    } catch {
      // bỏ qua lỗi đọc cache
    }

    // 2. Tra cứu kho từ vựng nội bộ (Local-First: 0ms, 0 token)
    try {
      const localVocab = await lookupLocalVocabulary(normWord || word.trim());
      if (localVocab) {
        return {
          word: localVocab.tw_traditional || normWord,
          pinyin: localVocab.pinyin || '',
          vi_in_context: localVocab.vi || localVocab.original_term || '',
          en_in_context: localVocab.original_term || '',
          general_meaning: localVocab.vi || localVocab.original_term || '',
          example_tw: localVocab.context_sentence || undefined,
          example_vi: localVocab.context_note || undefined,
          is_local: true,
        };
      }
    } catch {
      // Tiếp tục xuống gọi Gemini nếu lỗi đọc DB
    }
  }

  // 3. Gọi Gemini API phân tích ngữ cảnh sâu
  const field = fieldKey ? getField(fieldKey) : undefined;
  const fieldHint = field ? `Lĩnh vực chuyên ngành liên quan: ${field.label} (${field.prompt}).` : '';

  const promptText =
    `Giải thích từ/cụm từ tiếng Trung Phồn thể Đài Loan: "${word.trim()}" nằm trong ngữ cảnh câu: "${fullSentence.trim()}".\n` +
    `${fieldHint}\n\n` +
    `Nhiệm vụ:\n` +
    `1. word: Giữ nguyên chữ Phồn thể Đài Loan chuẩn (TUYỆT ĐỐI KHÔNG DÙNG GIẢN THỂ).\n` +
    `2. pinyin: Phiên âm Pinyin có đầy đủ dấu thanh của từ này.\n` +
    `3. vi_in_context: Nghĩa tiếng Việt của từ này ĐÚNG TRONG NGỮ CẢNH CÂU TRÊN (ngắn gọn 1-4 từ).\n` +
    `4. en_in_context: Nghĩa tiếng Anh tương ứng của từ này trong câu trên.\n` +
    `5. general_meaning: Nghĩa thông thường phổ biến nhất khi đứng độc lập.\n` +
    `6. example_tw: 1 câu ví dụ ngắn khác (chuẩn Phồn thể Đài Loan) sử dụng từ này.\n` +
    `7. example_pinyin: Pinyin của câu ví dụ.\n` +
    `8. example_vi: Nghĩa tiếng Việt của câu ví dụ.`;

  try {
    const res = await callGemini<WordContextExplanation>(
      [{ text: promptText }],
      WORD_CONTEXT_SCHEMA,
      450
    );

    const result: WordContextExplanation = {
      word: res?.word?.trim() || normWord,
      pinyin: res?.pinyin?.trim() || '',
      vi_in_context: res?.vi_in_context?.trim() || '',
      en_in_context: res?.en_in_context?.trim() || '',
      general_meaning: res?.general_meaning?.trim() || '',
      example_tw: res?.example_tw ? res.example_tw.trim() : undefined,
      example_pinyin: res?.example_pinyin?.trim(),
      example_vi: res?.example_vi?.trim(),
      is_local: false,
    };

    if (result.vi_in_context) {
      try {
        await setCache(cacheKey, JSON.stringify(result));
      } catch {
        // bỏ qua lỗi cache
      }
    }

    return result;
  } catch (err: any) {
    // 4. Fallback offline nếu mạng lỗi, không làm crash ứng dụng
    return {
      word: normWord,
      pinyin: '',
      vi_in_context: `(Offline) ${normWord}`,
      en_in_context: '',
      general_meaning: 'Không thể kết nối mạng để phân tích ngữ cảnh. Bạn vẫn có thể lưu từ này vào kho.',
      is_local: true,
    };
  }
}

// ─── Tự động phân loại Chủ đề thông minh với AI (Smart Topic Classifier) ────

/**
 * Tự động phân tích nội dung (từ hoặc câu) và đề xuất chủ đề phù hợp nhất.
 * Quét toàn bộ chủ đề của người dùng (custom topics + default topics).
 * Mặc định trả về 'other' ("Khác") nếu không có chủ đề nào trùng khớp hoặc AI không xác định được.
 */
export async function classifyTopicForContent(
  content: string,
  contextSentence?: string
): Promise<string> {
  const trimmed = (content || '').trim();
  if (!trimmed) return 'other';

  try {
    const topics = await getUserTopics();
    const candidateKeys = new Set(topics.map((t) => t.key.toLowerCase()));

    // 1. Kiểm tra cache SQLite
    const cacheKey = `topic_clf:${normalizeSearchText(trimmed).slice(0, 40)}`;
    const cached = await getCache(cacheKey);
    if (cached && candidateKeys.has(cached.toLowerCase())) {
      return cached.toLowerCase();
    }

    // 2. Khớp nhanh từ khóa cục bộ nếu nội dung chứa trực tiếp tên chủ đề
    const normContent = normalizeSearchText(trimmed + ' ' + (contextSentence || ''));
    for (const t of topics) {
      if (t.key === 'other') continue;
      const normLabel = normalizeSearchText(t.label);
      if (normLabel.length >= 3 && normContent.includes(normLabel)) {
        await setCache(cacheKey, t.key);
        return t.key;
      }
    }

    // 3. Gọi Gemini phân loại thông minh
    const topicPromptList = topics.map((t) => `- "${t.key}": ${t.label}`).join('\n');
    const prompt =
      `Bạn là chuyên gia phân loại chủ đề tiếng Trung Phồn thể Đài Loan và tiếng Việt.\n` +
      `Nhiệm vụ: Phân loại nội dung sau vào DUY NHẤT 1 chủ đề (topic_key) phù hợp nhất trong danh sách bên dưới.\n\n` +
      `Nội dung cần phân loại: "${trimmed}"\n` +
      (contextSentence ? `Ngữ cảnh bổ sung: "${contextSentence}"\n\n` : '\n') +
      `Danh sách chủ đề hợp lệ (chọn đúng 1 'topic_key'):\n${topicPromptList}\n\n` +
      `QUY TẮC BẮT BUỘC:\n` +
      `- Nếu nội dung rõ ràng thuộc về một chủ đề trong danh sách (kể cả chủ đề người dùng tự tạo), hãy trả về topic_key tương ứng.\n` +
      `- NẾU KHÔNG CHẮC CHẮN, HOẶC KHÔNG KHỚP RÕ VỚI CHỦ ĐỀ NÀO: BẮT BUỘC CHỌN "other" (Khác).\n` +
      `- Trả về JSON: {"topic_key": "..."}`;

    const res = await callGemini<{ topic_key?: string }>(
      [{ text: prompt }],
      {
        type: 'OBJECT',
        properties: {
          topic_key: { type: 'STRING' },
        },
        required: ['topic_key'],
      },
      256
    );

    const picked = (res?.topic_key || '').trim().toLowerCase();
    const finalTopic = candidateKeys.has(picked) ? picked : 'other';

    await setCache(cacheKey, finalTopic);
    return finalTopic;
  } catch (err) {
    console.warn('classifyTopicForContent error, fallback to other:', err);
    return 'other';
  }
}

// ─── Trợ lý Diễn đạt theo Ngữ cảnh thực tế (Tư duy người Đài Loan) ─────────

const SITUATIONAL_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    tw: { type: 'STRING' },
    pinyin: { type: 'STRING' },
    vi: { type: 'STRING' },
    chunks: { type: 'ARRAY', items: { type: 'STRING' } },
    cultural_note: { type: 'STRING' },
    avoid_note: { type: 'STRING' },
    suggested_topic: { type: 'STRING' },
  },
  required: ['tw', 'pinyin', 'vi', 'chunks', 'cultural_note', 'suggested_topic'],
};

/**
 * Tạo 1 câu giao tiếp chuẩn bản xứ Đài Loan dựa trên ngữ cảnh thực tế (Tối ưu quota & tối giản).
 */
export async function generateSituationalPhrases(
  contextDescription: string
): Promise<SituationalPhraseResult> {
  const context = (contextDescription || '').trim();
  if (!context) {
    throw new Error('Vui lòng nhập mô tả ngữ cảnh.');
  }

  let userTopicsStr = 'daily (Đời sống), travel (Di chuyển), food (Ăn uống), shopping (Mua sắm), work (Công sở), greeting (Chào hỏi), feelings (Cảm xúc), health (Sức khỏe), other (Khác)';
  try {
    const userTopics = await getUserTopics();
    if (userTopics && userTopics.length > 0) {
      userTopicsStr = userTopics.map((t) => `${t.key} (${t.label})`).join(', ');
    }
  } catch {}

  const promptText =
    `Bạn là chuyên gia ngôn ngữ khẩu ngữ chuẩn bản xứ Đài Loan (Taiwanese Pragmatics).\n\n` +
    `BỐI CẢNH / Ý MUỐN NÓI CỦA NGƯỜI DÙNG:\n` +
    `"${context}"\n\n` +
    `YÊU CẦU (TỐI GIẢN, CHUẨN XÁC, TIẾT KIỆM TỪ):\n` +
    `1. tw: Đưa ra ĐÚNG 1 CÂU PHỒN THỂ ĐÀI LOAN tự nhiên, chuẩn khẩu ngữ nhất (TUYỆT ĐỐI KHÔNG DÙNG GIẢN THỂ, KHÔNG DÙNG TỪ ĐẠI LỤC, KHÔNG DỊCH WORD-BY-WORD TIẾNG VIỆT).\n` +
    `2. pinyin: Bính âm có dấu thanh, các chữ cách nhau bằng dấu cách rõ ràng.\n` +
    `3. vi: Nghĩa tiếng Việt thoát ý, tự nhiên.\n` +
    `4. chunks: Tách câu tw thành 2-4 cụm từ có nghĩa để người dùng chạm tra cứu.\n` +
    `5. cultural_note: GIẢI THÍCH TƯ DUY NGƯỜI ĐÀI thật ngắn gọn (tối đa 2 câu súc tích, dưới 35 từ), nêu lý do người bản xứ nói như vậy thay vì cách dịch thô.\n` +
    `6. avoid_note: Nêu 1 câu dịch thô người Việt hay nhầm lẫn cần tránh (tối đa 20 từ). Nếu không có lỗi dịch thô phổ biến thì để trống.\n` +
    `7. suggested_topic: 1 topic_key phù hợp nhất từ: ${userTopicsStr}. Mặc định "other".\n\n` +
    `Trả về đúng JSON theo schema.`;

  try {
    const result = await callGemini<SituationalPhraseResult>(
      [{ text: promptText }],
      SITUATIONAL_RESPONSE_SCHEMA,
      380
    );
    return result;
  } catch (err: any) {
    console.error('generateSituationalPhrases error:', err);
    throw new Error(`Không thể tạo câu theo ngữ cảnh: ${err.message || 'Lỗi kết nối AI'}`);
  }
}

// ─── Dịch siêu tốc 2 thì (Instant 2-Pass Translation) ──────────────────────

export interface InstantTranslationResult {
  spoken_text: string;
  translation_tw: string;
  pinyin: string;
  translation_vi: string;
  translation_en: string;
  chunks?: string[];
  source: 'offline' | 'local' | 'gemini';
}

export interface BackgroundAnalysisResult {
  chunks: string[];
  terms: AITerm[];
  natural_note?: string;
}

/**
 * Pass 1: Dịch tức thì siêu tốc (~0.5s - 0.7s)
 * - Kiểm tra trước Offline Phrasebook & Fuzzy Cache (0ms, 0 tokens)
 * - Prompt tối giản, 0 thinking tokens, trả về chữ Phồn thể + Pinyin ngay lập tức
 */
export async function translateInstantFirstPass(
  spokenText: string,
  sender: 'me' | 'partner',
  fieldKey: string = 'daily'
): Promise<InstantTranslationResult> {
  const trimmed = spokenText.trim();
  if (!trimmed) {
    throw new Error('Văn bản rỗng');
  }

  const field = getField(fieldKey);

  // 1. Kiểm tra Offline Phrasebook hai chiều cho các câu chào hỏi / khẩu ngữ siêu ngắn chuẩn xác (0ms, 0 token)
  if (sender === 'me') {
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    // Chỉ kiểm tra offline khi câu cực ngắn (<= 3 từ) để tránh so khớp nhầm các câu hội thoại biến thể
    if (wordCount <= 3) {
      try {
        const match = await findOfflinePhraseFuzzy(trimmed);
        if (match) {
          console.log('[FastTrack] ⚡ Khớp Offline Phrasebook chuẩn Đài (VI):', match.tw);
          return {
            spoken_text: trimmed,
            translation_tw: match.tw,
            pinyin: match.pinyin,
            translation_vi: match.vi,
            translation_en: match.en || trimmed,
            source: 'offline',
          };
        }
      } catch {
        // bỏ qua lỗi tra offline
      }
    }
  } else {
    const cleanedTw = cleanChineseText(trimmed);
    if (cleanedTw && cleanedTw.length <= 4) {
      try {
        const match = await findOfflinePhraseChinese(trimmed);
        if (match) {
          console.log('[FastTrack] ⚡ Khớp Offline Phrasebook chuẩn Đài (TW):', match.tw);
          return {
            spoken_text: trimmed,
            translation_tw: match.tw,
            pinyin: match.pinyin,
            translation_vi: match.vi,
            translation_en: match.en || '',
            source: 'offline',
          };
        }
      } catch {
        // bỏ qua lỗi tra offline
      }
    }
  }

  // 2. Kiểm tra Exact Cache chính xác 100% từng từ và dấu câu (0ms, 0 token)
  // Tuyệt đối không dùng Fuzzy Cache bỏ dấu tiếng Việt để tránh bị ô nhiễm hoặc nhầm lẫn câu khác nghĩa
  const exactKey = `conv_exact:${sender}:${fieldKey}:${trimmed.toLowerCase().replace(/\s+/g, ' ')}`;
  try {
    const cachedStr = await getCache(exactKey);
    if (cachedStr) {
      const cached = JSON.parse(cachedStr);
      if (cached && cached.translation_tw) {
        console.log('[FastTrack] ⚡ Khớp Exact Cache câu chuẩn xác:', cached.translation_tw);
        return {
          ...cached,
          spoken_text: trimmed,
          source: 'local',
        };
      }
    }
  } catch {
    // bỏ qua lỗi cache
  }

  // 3. Lấy góp ý của người bản xứ Đài Loan nếu có
  let nativeNotes = '';
  try {
    const corrections = await getPhraseCorrections(3, fieldKey);
    if (corrections && corrections.length > 0) {
      nativeNotes =
        '\n\nQUY TẮC BẢN XỨ (Góp ý trực tiếp từ người bản xứ Đài Loan):\n' +
        corrections
          .map((c) => `- KHÔNG DÙNG "${c.original_phrase}", HÃY DÙNG "${c.native_sample}" (${c.reason || 'chuẩn bản xứ'})`)
          .join('\n');
    }
  } catch {
    // ignore
  }

  // 4. Gọi Gemini với Prompt thông minh ngang tầm analyzeText:
  // - Có phân loại chủ đề (Topic Classifier) để AI định hình ngữ cảnh trước
  // - Phân định rõ ràng giữa đời thường (daily) và công việc (work)
  // - Bảo toàn trọn vẹn ngữ khí Phồn thể Đài Loan chuẩn xác
  const promptText =
    (sender === 'me'
      ? `Lĩnh vực đang chọn: ${field.label} (${field.prompt}).\n` +
        `Danh sách các chủ đề (topic) hợp lệ: daily, greeting, food, shopping, travel, work, feelings, health, other.\n\n` +
        `Người dùng vừa nói câu tiếng Việt: "${trimmed}".\n\n` +
        `Nhiệm vụ dịch thuật sang tiếng Trung Phồn thể chuẩn Đài Loan (Taiwan Traditional Chinese):\n` +
        `1. topic: Xác định đúng 1 chủ đề của câu nói (ví dụ: các câu hỏi thăm, sinh hoạt, đi lại, ăn uống -> chọn "daily" hoặc "greeting").\n` +
        `2. translation_tw: Dịch sang tiếng Trung Phồn thể chuẩn Đài Loan theo ĐÚNG Ý NGUYÊN BẢN của người nói:\n` +
        `   - QUY TẮC TỰ NHIÊN ĐỜI THƯỜNG: Với các câu giao tiếp, hỏi thăm, đi lại, sinh hoạt thông thường (ví dụ: "Nãy mấy giờ về?" -> dịch tự nhiên đúng nghĩa là "剛剛幾點回來的？" hoặc "剛剛幾點回去的？"), TUYỆT ĐỐI KHÔNG tự tiện suy diễn câu đời thường thành thuật ngữ công sở (không tự biến "về" thành "tan làm/下班", không tự biến "nói chuyện" thành "họp/開會").\n` +
        `   - CHỈ KHI câu nói thực sự chứa nội dung hoặc thuật ngữ công việc thuộc lĩnh vực "${field.label}", mới áp dụng thuật ngữ chuyên ngành đó.\n` +
        `   - Sử dụng chữ Phồn thể chuẩn Đài Loan (Taiwan Traditional Chinese), TUYỆT ĐỐI KHÔNG DÙNG GIẢN THỂ. Kết hợp ngữ khí và khẩu ngữ tự nhiên của người Đài (好喔, 了解, 麻煩您, 對啊, 好的, 沒問題, 辛苦了...).\n` +
          `   - Giữ nguyên các từ tiếng Anh mượn nếu có trong câu nói.\n` +
        `3. pinyin: Phiên âm Pinyin có đầy đủ dấu thanh, các âm tiết CÁCH NHAU BẰNG DẤU CÁCH rõ ràng (spaced Pinyin).\n` +
        `4. translation_vi: Câu tiếng Việt hoàn chỉnh, chuẩn mực, đúng ý người nói.\n` +
        `5. translation_en: Câu tiếng Anh giao tiếp tự nhiên ngắn gọn, chuẩn bản ngữ.\n` +
        `6. chunks: Tách translation_tw thành 2 đến 5 cụm từ có nghĩa. Khi ghép các cụm lại phải khớp hoàn toàn translation_tw.`
      : `Lĩnh vực đang chọn: ${field.label} (${field.prompt}).\n` +
        `Danh sách các chủ đề (topic) hợp lệ: daily, greeting, food, shopping, travel, work, feelings, health, other.\n\n` +
        `Đối tác người Đài Loan vừa nói: "${trimmed}".\n\n` +
        `Nhiệm vụ dịch thuật sang tiếng Việt:\n` +
        `1. topic: Xác định đúng 1 chủ đề của câu nói (daily, work, food, greeting...).\n` +
        `2. translation_tw: Chuẩn hóa và giữ nguyên văn chính xác lời nói của đối tác bằng chữ Hán Phồn thể chuẩn Đài Loan (Taiwan Traditional Chinese) cùng các từ mượn tiếng Anh nếu có. TUYỆT ĐỐI KHÔNG DÙNG GIẢN THỂ (Simplified Chinese). Tuyệt đối không tự ý thay đổi hay đoán sửa từ ngữ đối tác đã nói.\n` +
        `3. pinyin: Phiên âm Pinyin có đầy đủ dấu thanh cho phần chữ Hán, giữ nguyên từ tiếng Anh nếu có xen kẽ, các âm tiết CÁCH NHAU BẰNG DẤU CÁCH rõ ràng (spaced Pinyin).\n` +
        `4. translation_vi: Dịch sang TIẾNG VIỆT CỰC KỲ TỰ NHIÊN, TRÔI CHẢY, THOÁT Ý, đúng văn phong đời thực người Việt nói chuyện (TUYỆT ĐỐI KHÔNG DỊCH MÁY MÓC TỪNG CHỮ cứng nhắc, KHÔNG tự suy diễn thêm ý mà đối tác không nói):\n` +
        `   - Chuyển ngữ mềm mại, tinh tế các hư từ cảm thán và khẩu ngữ thực tế của người Đài (喔, 啦, 耶, 吧, 呢, 好的, 辛苦了, 不好意思...).\n` +
        `   - Nếu câu nói đề cập đến công việc ${field.label}, dùng đúng thuật ngữ tương đương người Việt trong ngành hiểu ngay.\n` +
        `   - Nếu câu nói chêm tiếng Anh, hãy dung hòa tự nhiên vào câu tiếng Việt.\n` +
        `5. translation_en: Dịch sang tiếng Anh giao tiếp tự nhiên (Conversational English), ngắn gọn, chuẩn bản ngữ.\n` +
        `6. chunks: Tách translation_tw thành 2 đến 5 cụm từ có nghĩa (ví dụ: ["明天早上", "十點開會", "喔"]). Khi ghép các cụm lại phải khớp hoàn toàn translation_tw.`) +
    nativeNotes;

  const res = await callGemini<{
    topic?: string;
    translation_tw: string;
    pinyin: string;
    translation_vi: string;
    translation_en?: string;
    chunks?: string[];
  }>(
    [{ text: promptText }],
    INSTANT_TRANSLATION_SCHEMA,
    800
  );

  const cleanTw = (res?.translation_tw || trimmed).trim();
  let validChunks: string[] = [];
  if (Array.isArray(res?.chunks)) {
    const rawChunks = res.chunks.map((c) => String(c).trim()).filter(Boolean);
    if (rawChunks.length > 0) {
      const joinedCleaned = cleanChineseText(rawChunks.join(''));
      const targetCleaned = cleanChineseText(cleanTw);
      if (joinedCleaned === targetCleaned) {
        validChunks = rawChunks;
      }
    }
  }

  const result: InstantTranslationResult = {
    spoken_text: trimmed,
    translation_tw: cleanTw,
    pinyin: res?.pinyin?.trim() || '',
    translation_vi: (res?.translation_vi?.trim()) || (sender === 'me' ? trimmed : ''),
    translation_en: res?.translation_en?.trim() || '',
    chunks: validChunks.length > 0 ? validChunks : [cleanTw],
    source: 'gemini',
  };

  // Lưu vào Exact Cache an toàn (100% khớp chuỗi nguyên vẹn)
  try {
    await setCache(exactKey, JSON.stringify(result));
  } catch {
    // ignore
  }

  return result;
}

/**
 * Pass 2: Phân tích ngầm sau khi đã hiển thị bản dịch
 * - Bóc tách thuật ngữ chuyên ngành (IT, Y tế...)
 * - Cắt cụm từ chunks để ghép câu
 */
export async function analyzeBackgroundSecondPass(
  spokenText: string,
  translationTw: string,
  fieldKey: string = 'daily',
  sender: 'me' | 'partner' = 'me'
): Promise<BackgroundAnalysisResult> {
  const cacheKey = `bg_analysis_${sender}_${fieldKey}_${spokenText.trim()}`;
  try {
    const cachedStr = await getCache(cacheKey);
    if (cachedStr) {
      return JSON.parse(cachedStr);
    }
  } catch {
    // ignore
  }

  const field = getField(fieldKey);
  const promptText =
    `Phân tích câu giao tiếp tiếng Trung Đài Loan: "${translationTw}" (gốc: "${spokenText}").\n` +
    `Ngữ cảnh tham chiếu: ${field.label}.\n` +
    `1. chunks: Cắt "${translationTw}" thành 2 đến 5 cụm từ có nghĩa.\n` +
    `2. terms: Chỉ trích xuất thuật ngữ chuyên môn thuộc lĩnh vực "${field.label}" nếu câu thực sự chứa thuật ngữ chuyên ngành đó (với câu giao tiếp phổ thông đời thường hoặc không có thuật ngữ, bắt buộc trả về mảng rỗng []).\n` +
    `3. natural_note: Lời khuyên ngắn (1 câu) về cách nói của người Đài nếu có điểm thú vị.`;

  try {
    const res = await callGemini<BackgroundAnalysisResult>(
      [{ text: promptText }],
      BACKGROUND_ANALYSIS_SCHEMA,
      350
    );

    const safeChunks = Array.isArray(res?.chunks) ? res.chunks : [];
    const safeTerms = Array.isArray(res?.terms) ? res.terms : [];

    const result: BackgroundAnalysisResult = {
      chunks: safeChunks,
      terms: safeTerms,
      natural_note: res?.natural_note || undefined,
    };

    await setCache(cacheKey, JSON.stringify(result));
    return result;
  } catch (err) {
    console.warn('[Background 2nd Pass] Bỏ qua lỗi phân tích ngầm:', err);
    return {
      chunks: [],
      terms: [],
    };
  }
}

// ─── Dịch hội thoại 2 chiều thông minh (2-Way Conversation Turn) ──────────

export interface ConversationTurnResult {
  spoken_text: string;
  translation_tw: string;
  translation_vi: string;
  translation_en: string;
  pinyin: string;
  natural_tw?: string;
  natural_pinyin?: string;
  natural_note?: string;
  chunks?: string[];
  terms?: AITerm[];
  source: 'local' | 'gemini' | 'offline';
}

export async function translateConversationTurn(
  audioUri: string,
  sender: 'me' | 'partner',
  fieldKey: string
): Promise<ConversationTurnResult> {
  let spokenText = '';
  let source: 'local' | 'gemini' = 'local';

  // 1. Thử nhận diện bằng Whisper Local trước (timeout 7.5s)
  try {
    const localTimeout = new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error('local_timeout')), 7500)
    );
    const targetLang = sender === 'partner' ? 'zh' : undefined;
    const localRes = await Promise.race([transcribeLocal(audioUri, targetLang, fieldKey), localTimeout]);
    if (localRes?.text) {
      spokenText = sender === 'partner' ? cleanChineseText(localRes.text) : localRes.text.trim();
      source = 'local';
    }
  } catch {
    // Local offline -> tiếp tục với Gemini
  }

  // 2. Fallback Gemini Multimodal STT
  if (!spokenText) {
    source = 'gemini';
    const { base64, mimeType } = await audioUriToBase64(audioUri);
    const sttPrompt =
      sender === 'partner'
        ? 'Hãy nghe đoạn âm thanh này và chép lại chính xác lời nói tiếng Trung Phồn thể Đài Loan (Taiwan Traditional Chinese).\n' +
          'TUYỆT ĐỐI KHÔNG DÙNG GIẢN THỂ (SIMPLIFIED CHINESE).\n' +
          'Chỉ trả về chữ Hán trong transcribed_text.'
        : 'Hãy nghe đoạn âm thanh này và chép lại chính xác nội dung người dùng vừa nói (tiếng Anh, tiếng Việt, hoặc song ngữ).\n' +
          'Chỉ trả về lời nói đã nghe được trong transcribed_text.';

    const res = await callGemini<{ transcribed_text: string }>(
      [
        { text: sttPrompt },
        { inlineData: { mimeType, data: base64 } },
      ],
      SPEECH_TRANSCRIBE_SCHEMA,
      250
    );
    spokenText = res?.transcribed_text?.trim() ?? '';
  }

  if (!spokenText) {
    throw new Error('Không nhận diện được giọng nói. Xin hãy thử nói lại.');
  }

  // ─── Tối ưu 4A: Kiểm tra Offline Phrasebook chuẩn Đài (0ms, 0 token) ──────
  if (sender === 'me') {
    try {
      const offlineMatch = await findOfflinePhraseFuzzy(spokenText.trim());
      if (offlineMatch) {
        console.log('[Conversation] ⚡ Khớp Offline Phrasebook 0 token (VI):', offlineMatch.tw);
        return {
          spoken_text: spokenText.trim(),
          translation_tw: offlineMatch.tw,
          pinyin: offlineMatch.pinyin,
          translation_vi: offlineMatch.vi,
          translation_en: offlineMatch.en || spokenText.trim(),
          chunks: [offlineMatch.tw],
          terms: [],
          source: 'offline',
        };
      }
    } catch {
      // bỏ qua lỗi tra offline
    }
  } else {
    try {
      const offlineMatch = await findOfflinePhraseChinese(spokenText.trim());
      if (offlineMatch) {
        console.log('[Conversation] ⚡ Khớp Offline Phrasebook 0 token (TW):', offlineMatch.tw);
        return {
          spoken_text: spokenText.trim(),
          translation_tw: offlineMatch.tw,
          pinyin: offlineMatch.pinyin,
          translation_vi: offlineMatch.vi,
          translation_en: offlineMatch.en || '',
          chunks: [offlineMatch.tw],
          terms: [],
          source: 'offline',
        };
      }
    } catch {
      // bỏ qua lỗi tra offline
    }
  }

  // ─── Tối ưu 4B: Kiểm tra Exact Cache trước khi gọi AI (0 token Gemini) ──────
  const convExactKey = `conv_turn_exact:${sender}:${fieldKey}:${spokenText.trim().toLowerCase().replace(/\s+/g, ' ')}`;
  try {
    const cachedStr = await getCache(convExactKey);
    if (cachedStr) {
      const cached = JSON.parse(cachedStr);
      if (cached && cached.translation_tw) {
        return {
          ...cached,
          source: 'local' as const,
        };
      }
    }
  } catch {
    // ignore
  }

  // ─── Tối ưu 5: Lọc tối đa 5 góp ý của người Đài để ép AI tránh lỗi cũ ───────
  let nativeNotes = '';
  try {
    const corrections = await getPhraseCorrections(5, fieldKey);
    if (corrections.length > 0) {
      nativeNotes =
        '\n\nQUY TẮC BẢN XỨ (Góp ý trực tiếp từ người bản xứ Đài Loan):\n' +
        corrections
          .map((c) => `- KHÔNG DÙNG "${c.original_phrase}", HÃY DÙNG "${c.native_sample}" (${c.reason || 'chuẩn bản xứ'})`)
          .join('\n') +
        '\n';
    }
  } catch {
    // ignore
  }

  // 3. Phân tích ngữ nghĩa & dịch 2 chiều với Gemini
  const field = getField(fieldKey);
  const isShortTurn = spokenText.length <= 6 && !/[\n.?!,，。？！]/.test(spokenText) && spokenText.split(/\s+/).length <= 3;
  const contextHintTurn =
    field.key !== 'daily'
      ? (isShortTurn
          ? `Lĩnh vực chuyên ngành tham chiếu: ${field.label} (${field.prompt}) (Lưu ý: Đầu vào là từ/đoản ngữ ngắn. Ưu tiên dịch đúng nghĩa thực tế đời sống tự nhiên của từ, chỉ gán vào thuật ngữ chuyên ngành nếu câu nói thực sự liên quan đến kỹ thuật chuyên môn).\n`
          : `Ngữ cảnh chuyên ngành tham chiếu (chỉ áp dụng khi câu nói có đề cập công việc chuyên môn): ${field.label} (${field.prompt}).\n`)
      : '';

  const promptText =
    (sender === 'me'
      ? `${contextHintTurn}` +
        `Người dùng vừa nói (tiếng Việt hoặc tiếng Anh): "${spokenText}".\n\n` +
        `Nhiệm vụ:\n` +
        `1. translation_tw: Dịch sang tiếng Trung Phồn thể chuẩn Đài Loan tự nhiên theo đúng ý nguyên bản của người nói. Với câu giao tiếp, hỏi thăm đời thường (đi lại, ăn uống, chào hỏi...) thì dịch nghĩa đời thường tự nhiên (ví dụ: "về" -> 回來/回去/回家, TUYỆT ĐỐI KHÔNG tự suy diễn thành "tan làm/下班"). Chỉ áp dụng thuật ngữ chuyên ngành khi câu nói thực sự liên quan công việc.\n` +
        `2. pinyin: Phiên âm Pinyin có dấu thanh của translation_tw, các âm tiết CÁCH NHAU BẰNG DẤU CÁCH rõ ràng.\n` +
        `3. translation_vi: Câu tiếng Việt hoàn chỉnh, chuẩn mực, giữ đúng ý người nói.\n` +
        `4. translation_en: Câu tiếng Anh hoàn chỉnh, tự nhiên.\n` +
        `5. chunks: Tách translation_tw thành 2 đến 5 cụm từ có nghĩa.\n` +
        `6. terms: Chỉ trích xuất các thuật ngữ chuyên môn THUỘC LĨNH VỰC "${field.label}" xuất hiện trong câu. Nếu là câu phổ thông hằng ngày hoặc không có thuật ngữ chuyên môn, trả về mảng rỗng [].`
      : `${contextHintTurn}` +
        `Đối tác Đài Loan vừa nói: "${spokenText}".\n\n` +
        `Nhiệm vụ:\n` +
        `1. translation_tw: Chuẩn hóa chữ Hán Phồn thể người Đài vừa nói (Taiwan Traditional Chinese) cùng từ tiếng Anh nếu có. Không dùng Giản thể, không dùng từ Đại Lục. Nếu là từ đơn hoặc cụm từ ngắn đồng âm, hãy ưu tiên từ vựng Phồn thể chuẩn Đài Loan phù hợp nhất.\n` +
        `2. pinyin: Phiên âm có dấu thanh tương ứng từng chữ, các âm tiết cách nhau bằng dấu cách.\n` +
        `3. translation_vi: Dịch sang tiếng Việt tự nhiên, thoát ý, đúng ngữ cảnh đời thực (không dịch máy móc từng chữ, không tự suy diễn thêm ý mà đối tác không nói). Chuyển ngữ mềm mại trợ từ ngữ khí người Đài (喔, 啦, 耶, 吧, 呢...).\n` +
        `4. translation_en: Dịch sang tiếng Anh giao tiếp tự nhiên (Conversational English), ngắn gọn, chuẩn bản ngữ.\n` +
        `5. chunks: Tách translation_tw thành 2 đến 5 cụm từ có nghĩa.\n` +
        `6. terms: Chỉ trích xuất các thuật ngữ chuyên môn THUỘC LĨNH VỰC "${field.label}" xuất hiện trong câu nếu có, ngược lại trả về mảng rỗng [].`) +
    nativeNotes;

  const turnRes = await callGemini<any>(
    [{ text: promptText }],
    CONVERSATION_TURN_SCHEMA,
    isShortTurn ? 350 : 500
  );

  const rawTw = (turnRes?.translation_tw || spokenText).trim();
  let chunks: string[] = [];
  if (Array.isArray(turnRes?.chunks)) {
    chunks = turnRes.chunks.map((c: any) => cleanChineseText(String(c).trim())).filter(Boolean);
  }

  const validTerms: AITerm[] = [];
  if (Array.isArray(turnRes?.terms)) {
    for (const t of turnRes.terms) {
      if (t && typeof t === 'object' && t.tw_traditional && t.pinyin) {
        validTerms.push({
          original_term: String(t.original_term || t.tw_traditional).trim(),
          tw_traditional: cleanChineseText(String(t.tw_traditional).trim()),
          pinyin: String(t.pinyin || '').trim(),
          vi: t.vi ? String(t.vi).trim() : undefined,
        });
      }
    }
  }

  const result = {
    spoken_text: spokenText,
    translation_tw: rawTw,
    translation_vi: String(turnRes?.translation_vi || '').trim(),
    translation_en: String(turnRes?.translation_en || '').trim(),
    pinyin: String(turnRes?.pinyin || '').trim(),
    chunks: chunks.length >= 2 ? chunks : undefined,
    terms: validTerms.length > 0 ? validTerms : undefined,
    source,
  };

  // Lưu vào Exact cache để lần sau câu này không tốn quota
  try {
    await setCache(convExactKey, JSON.stringify(result));
  } catch {
    // ignore
  }

  return result;
}

// ─── Tối ưu 1: Gom kịch bản toàn bộ 3-4 lượt trong 1 lần gọi (Tiết kiệm 80% Quota) ──

export async function generateFullDialogueScenario(
  scenarioPrompt: string,
  topic?: string,
  userSpecifiedRole?: string
): Promise<DialogueTurn[]> {
  // Lấy tối đa 3 luật của người bản xứ liên quan
  let nativeNotes = '';
  try {
    const corrections = await getPhraseCorrections(3);
    if (corrections.length > 0) {
      nativeNotes = `\nChú ý các cách nói tự nhiên chuẩn Đài Loan: ${corrections.map((c) => `ưu tiên dùng "${c.native_sample}" thay vì "${c.original_phrase}"`).join(', ')}.`;
    }
  } catch {
    // ignore
  }

  const promptText =
    `Bạn là chuyên gia ngôn ngữ tiếng Trung Phồn thể chuẩn Đài Loan (Taiwan Traditional Chinese).\n` +
    `BỐI CẢNH KỊCH BẢN NHẬP VAI: "${scenarioPrompt}". Chủ đề: ${topic || 'giao tiếp'}.\n` +
    (userSpecifiedRole ? `VAI TRÒ NGƯỜI DÙNG CHỈ ĐỊNH: "${userSpecifiedRole}".\n` : '') +
    nativeNotes +
    `\nQUY TẮC PHÂN TÍCH VAI TRÒ & GÓC NHÌN (CỰC KỲ QUAN TRỌNG - TUYỆT ĐỐI KHÔNG ĐẢO NGƯỢC VAI):\n` +
    `1. VAI CỦA NGƯỜI DÙNG (user_role_name):\n` +
    `   - Hãy phân tích chính xác người dùng muốn đóng vai gì trong bối cảnh "${scenarioPrompt}":\n` +
    `     * Nếu người dùng viết "Làm nhân viên...", "Tôi là phục vụ...", "Làm bác sĩ...", "Đóng vai tài xế...", "Tôi là cảnh sát...", "Làm gia sư...":\n` +
    `       -> Người dùng ĐÓNG VAI nhân viên phục vụ / bác sĩ / tài xế / cảnh sát / gia sư.\n` +
    `     * Nếu người dùng viết "Đi ăn lẩu...", "Mua sắm...", "Khám bệnh...", "Đi phỏng vấn...", "Hỏi đường...":\n` +
    `       -> Người dùng ĐÓNG VAI khách ăn lẩu / người mua sắm / bệnh nhân / ứng viên / người hỏi đường.\n` +
    (userSpecifiedRole ? `     * Người dùng đã chọn vai: "${userSpecifiedRole}" -> Hãy TUÂN THỦ 100% vai này.\n` : '') +
    `   - QUAN TRỌNG: Các câu trong mảng options LUÔN LUÔN LÀ CÂU NÓI CỦA NGƯỜI DÙNG (User Role) để phản hồi lại đối tác!\n\n` +
    `2. VAI CỦA NHÂN VẬT ĐỐI THOẠI AI (partner_role_name / character_name):\n` +
    `   - Là người đối diện tương tác với người dùng trong bối cảnh đó:\n` +
    `     * Người dùng là Nhân viên phục vụ -> Nhân vật AI là Khách hàng (khách đến ăn, hỏi bàn, gọi món, nhờ vả, thanh toán).\n` +
    `     * Người dùng là Bác sĩ -> Nhân vật AI là Bệnh nhân (tả triệu chứng, hỏi thuốc).\n` +
    `     * Người dùng là Khách ăn -> Nhân vật AI là Nhân viên phục vụ (chào khách, hỏi số người, dẫn bàn).\n` +
    `     * Người dùng là Ứng viên -> Nhân vật AI là Người phỏng vấn / Nhà tuyển dụng.\n` +
    `     * Người dùng là Tài xế -> Nhân vật AI là Hành khách đi xe.\n` +
    `   - CÂU THOẠI character_tw, character_pinyin, character_vi LUÔN LUÔN LÀ CỦA NHÂN VẬT ĐỐI THOẠI AI (Partner) nói với người dùng!\n` +
    `   - TUYỆT ĐỐI KHÔNG ĐỂ NHÂN VẬT AI NÓI CÂU THOẠI CỦA NGƯỜI DÙNG!\n` +
    `     (Ví dụ: Nếu người dùng làm nhân viên phục vụ, nhân vật AI là Khách hàng, thì nhân vật AI KHÔNG ĐƯỢC chào mừng quý khách đến quán, mà Khách hàng phải là người bước vào hỏi bàn hoặc gọi món: "不好意思，請問現在有位子嗎？我們有四位。"!).\n\n` +
    `3. NHIỆM VỤ TẠO KỊCH BẢN (ĐÚNG 3 HOẶC 4 LƯỢT):\n` +
    `   - Lượt 1: Nhân vật đối thoại AI (partner) mở lời trước với người dùng (ví dụ: Khách hàng hỏi bàn hoặc Nhân viên chào khách tùy theo vai của partner). Đưa 3 options cho NGƯỜI DÙNG phản hồi (option 0 chuẩn tự nhiên nhất theo ngữ cảnh, 2 option sau sai/vụng về/lạc đề).\n` +
    `   - Lượt 2, 3 và lượt cuối: Diễn biến tiếp theo của tình huống theo đúng 2 vai trò đã phân định. Ở mỗi lượt, đưa 3 options cho NGƯỜI DÙNG phản hồi (option 0 luôn là câu chuẩn tự nhiên nhất, 2 option sau sai/vụng về/lạc đề).\n` +
    `   - QUY TẮC PINYIN: Mọi trường pinyin (character_pinyin, pinyin của options) PHẢI tách từng âm tiết bằng dấu cách cho từng chữ Hán tương ứng (ví dụ: "Nǐ hǎo, wǒ men yǒu sì wèi.").`;

  const res = await callGemini<{ user_role_name: string; partner_role_name: string; turns: any[] }>(
    [{ text: promptText }],
    FULL_DIALOGUE_SCHEMA,
    1400
  );

  const rawTurns = res?.turns || [];
  if (rawTurns.length === 0) {
    throw new Error('Không tạo được kịch bản hội thoại');
  }

  const uRole = res.user_role_name || userSpecifiedRole || 'Bạn';
  const pRole = res.partner_role_name || 'Đối tác bản xứ';

  // Xử lý và trộn options ở từng turn (client-side, 0 token)
  return rawTurns.map((turn, tIdx) => {
    const isLastTurn = tIdx === rawTurns.length - 1;
    const rawOpts: any[] = Array.isArray(turn.options) ? turn.options : [];
    const charName = turn.character_name || pRole;

    const bestOpt = rawOpts[0] || {
      tw: '好的，沒問題！',
      pinyin: 'hǎo de, méi wèn tí!',
      vi: 'Được rồi, không vấn đề gì!',
      en: 'Alright, no problem!',
    };
    const cleaned = rawOpts.map((o) => ({
      tw: cleanChineseText(o.tw || ''),
      pinyin: o.pinyin || '',
      vi: o.vi || '',
      en: o.en || '',
    }));
    const shuffled = shuffle(cleaned);
    const correctIdx = shuffled.findIndex((o) => o.tw === cleanChineseText(bestOpt.tw));

    return {
      character_tw: cleanChineseText(turn.character_tw || ''),
      character_pinyin: turn.character_pinyin || '',
      character_vi: turn.character_vi || '',
      character_en: turn.character_en || '',
      character_name: charName,
      user_role_name: uRole,
      options: shuffled,
      correct_index: correctIdx !== -1 ? correctIdx : 0,
      is_final: isLastTurn || !!turn.is_final,
    };
  });
}

// ─── Hội thoại nhập vai theo từng lượt (Fallback tương thích) ─────────────

export async function generateDialogueTurn(
  scenarioPrompt: string,
  history: { role: 'character' | 'user'; text: string }[],
  userSpecifiedRole?: string
): Promise<DialogueTurn> {
  const recentHistory = history.slice(-4).map((h) => `${h.role === 'character' ? 'Đối tác AI' : 'Người dùng'}: ${h.text}`).join('\n');

  const promptText =
    `BỐI CẢNH HỘI THOẠI: ${scenarioPrompt}.\n` +
    (userSpecifiedRole ? `Người dùng đang đóng vai: "${userSpecifiedRole}".\n` : '') +
    (recentHistory ? `Lịch sử các lượt gần nhất:\n${recentHistory}\n\n` : '') +
    `Nhiệm vụ:\n` +
    `1. Đóng vai đối tác tương tác với người dùng (ví dụ: nếu người dùng làm nhân viên thì bạn là khách hàng; nếu người dùng là khách hàng thì bạn là nhân viên). Nói câu tiếp theo bằng Phồn thể Đài Loan tự nhiên (character_tw).\n` +
    `2. Đưa 3 phương án phản hồi cho NGƯỜI DÙNG (options) theo đúng vai của người dùng. Phương án ĐẦU TIÊN (index 0) là câu trả lời tốt nhất, 2 phương án còn lại là câu sai ngữ cảnh hoặc vụng về.\n` +
    `3. Nếu cuộc hội thoại đã kết thúc tự nhiên sau câu này, đặt is_final=true.\n` +
    `4. QUY TẮC PINYIN: Trường pinyin và character_pinyin PHẢI tách từng âm tiết bằng dấu cách cho từng chữ Hán tương ứng (ví dụ: "hǎo de, xiè xiè!").`;

  const res = await callGemini<DialogueTurnResponse>(
    [{ text: promptText }],
    DIALOGUE_SCHEMA,
    450
  );

  const rawOptions = res.options ?? [];
  const bestOption = rawOptions[0] ?? {
    tw: '好的，謝謝！',
    pinyin: 'hǎo de, xiè xiè!',
    vi: 'Được rồi, cảm ơn!',
    en: 'Alright, thank you!',
  };

  // Trộn các lựa chọn tại máy (0 token) và ghi lại correct_index
  const shuffledOptions = shuffle(rawOptions);
  const correct_index = shuffledOptions.findIndex((opt) => opt.tw === bestOption.tw);

  return {
    character_tw: res.character_tw,
    character_pinyin: res.character_pinyin,
    character_vi: res.character_vi,
    character_en: res.character_en,
    options: shuffledOptions,
    correct_index: correct_index !== -1 ? correct_index : 0,
    is_final: res.is_final ?? false,
  };
}

// ─── Tạo bài tập cho Thuật ngữ (Chuyên ngành) ──────────────────────────────

const DEFAULT_FILLER_META: Record<string, { pinyin: string; vi: string }> = {
  '系統': { pinyin: 'xì tǒng', vi: 'hệ thống' },
  '資料': { pinyin: 'zī liào', vi: 'dữ liệu' },
  '網路': { pinyin: 'wǎng lù', vi: 'mạng' },
  '程式': { pinyin: 'chéng shì', vi: 'chương trình' },
  '伺服器': { pinyin: 'sì fú qì', vi: 'máy chủ (server)' },
  '介面': { pinyin: 'jiè miàn', vi: 'giao diện' },
  '模組': { pinyin: 'mó zǔ', vi: 'mô-đun' },
  '版本': { pinyin: 'bǎn běn', vi: 'phiên bản' },
  '快取': { pinyin: 'kuài qǔ', vi: 'bộ nhớ đệm (cache)' },
  '專案': { pinyin: 'zhuān àn', vi: 'dự án (project)' },
  '資料庫': { pinyin: 'zī liào kù', vi: 'cơ sở dữ liệu (database)' },
  '演算法': { pinyin: 'yǎn suàn fǎ', vi: 'thuật toán' },
  '記憶體': { pinyin: 'jì yì tǐ', vi: 'bộ nhớ RAM' },
  '叢集': { pinyin: 'cóng jí', vi: 'cụm máy chủ (cluster)' },
  '部署': { pinyin: 'bù shǔ', vi: 'triển khai (deploy)' },
  '除錯': { pinyin: 'chú cuò', vi: 'sửa lỗi (debug)' },
  '最佳化': { pinyin: 'zuì jiā huà', vi: 'tối ưu hóa' },
  '架構': { pinyin: 'jià gòu', vi: 'kiến trúc hệ thống' },
  '非同步': { pinyin: 'fēi tóng bù', vi: 'bất đồng bộ (async)' },
  '安全性': { pinyin: 'ān quán xìng', vi: 'tính bảo mật' },
};

const DEFAULT_COMMUNICATION_CHUNKS: OptionWithMeta[] = [
  { text: '開會', pinyin: 'kāi huì', vi: 'họp' },
  { text: '討論', pinyin: 'tǎo lùn', vi: 'thảo luận' },
  { text: '確認', pinyin: 'què rèn', vi: 'xác nhận' },
  { text: '處理', pinyin: 'chǔ lǐ', vi: 'xử lý' },
  { text: '準備', pinyin: 'zhǔn bèi', vi: 'chuẩn bị' },
  { text: '聯絡', pinyin: 'lián luò', vi: 'liên lạc' },
  { text: '明天', pinyin: 'míng tiān', vi: 'ngày mai' },
  { text: '今天', pinyin: 'jīn tiān', vi: 'hôm nay' },
  { text: '好的', pinyin: 'hǎo de', vi: 'được rồi' },
  { text: '沒問題', pinyin: 'méi wèn tí', vi: 'không có vấn đề gì' },
  { text: '請等一下', pinyin: 'qǐng děng yí xià', vi: 'xin đợi một chút' },
  { text: '謝謝您', pinyin: 'xiè xiè nín', vi: 'cảm ơn bạn' },
  { text: '很抱歉', pinyin: 'hěn bào qiàn', vi: 'rất xin lỗi' },
  { text: '再見', pinyin: 'zài jiàn', vi: 'tạm biệt' },
  { text: '辛苦了', pinyin: 'xīn kǔ le', vi: 'vất vả rồi' },
];

/** Tách Pinyin tương ứng với 1 cụm chữ Hán trong câu */
export function extractChunkPinyin(
  sentenceTw: string,
  sentencePinyin: string,
  chunk: string
): string {
  if (!sentenceTw || !sentencePinyin || !chunk) return '';
  const isChineseChar = (ch: string) => /[\u4e00-\u9fa5\u3400-\u4dbf]/.test(ch);
  const pinyinParts = splitPinyinIntoSyllables(sentencePinyin);

  let pIdx = 0;
  const charPinyinMap: { char: string; pinyin: string; rawIdx: number }[] = [];
  for (let i = 0; i < sentenceTw.length; i++) {
    const ch = sentenceTw[i];
    if (isChineseChar(ch)) {
      charPinyinMap.push({
        char: ch,
        pinyin: pinyinParts[pIdx] || '',
        rawIdx: i,
      });
      pIdx++;
    }
  }

  const chunkStart = sentenceTw.indexOf(chunk);
  if (chunkStart !== -1) {
    const matched = charPinyinMap.filter(
      (item) => item.rawIdx >= chunkStart && item.rawIdx < chunkStart + chunk.length
    );
    if (matched.length > 0) {
      return matched.map((m) => m.pinyin).filter(Boolean).join(' ');
    }
  }

  return '';
}

const FILLER = Object.keys(DEFAULT_FILLER_META);

export function localDistractors(answer: string, pool: string[]): string[] {
  const others = Array.from(new Set(pool.filter((p) => p && p !== answer)));
  const filler = FILLER.filter((f) => f !== answer && !others.includes(f));
  return [...others, ...filler].slice(0, 6);
}

export async function generateQuests(
  items: { original_term: string; tw_traditional: string; pinyin?: string; vi?: string }[],
  fieldKey: string
): Promise<AIQuest[]> {
  const field = getField(fieldKey);
  const pool = items.map((i) => i.tw_traditional);
  const pinyinMap = new Map<string, string>();
  const viMap = new Map<string, string>();

  // Nạp từ điển filler mặc định
  Object.entries(DEFAULT_FILLER_META).forEach(([k, v]) => {
    pinyinMap.set(k, v.pinyin);
    viMap.set(k, v.vi);
  });

  // Nạp thêm từ cơ sở dữ liệu để làm phong phú pinyin & nghĩa việt của đáp án nhiễu
  try {
    const allDomain = await getAllVocabulary('domain');
    for (const v of allDomain) {
      if (v.tw_traditional && v.pinyin && !pinyinMap.has(v.tw_traditional)) {
        pinyinMap.set(v.tw_traditional, v.pinyin);
      }
      if (v.tw_traditional && v.vi && !viMap.has(v.tw_traditional)) {
        viMap.set(v.tw_traditional, v.vi);
      }
    }
  } catch {
    // bỏ qua lỗi đọc db
  }

  items.forEach((it) => {
    if (it.tw_traditional && it.pinyin) {
      pinyinMap.set(it.tw_traditional, it.pinyin);
    }
    if (it.tw_traditional && it.vi) {
      viMap.set(it.tw_traditional, it.vi);
    }
  });

  let wrongByIndex: Record<number, string[]> = {};
  try {
    const list = items.map((it, i) => `${i}. ${it.original_term} = ${it.tw_traditional}`).join('\n');
    const r = await callGemini<{ items: { i: number; wrong: string[] }[] }>(
      [
        {
          text:
            `Ngành: ${field.prompt}. Với mỗi dòng, đưa đúng 3 đáp án SAI nhưng nghe hợp lý ` +
            `(Trung Phồn thể, cùng lĩnh vực, khác đáp án đúng):\n${list}`,
        },
      ],
      DISTRACTOR_SCHEMA,
      60 + items.length * 40
    );
    (r.items ?? []).forEach((x) => (wrongByIndex[x.i] = x.wrong ?? []));
  } catch {
    wrongByIndex = {};
  }

  const quests: AIQuest[] = [];

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let wrongTw = (wrongByIndex[i] ?? []).filter((w) => w && w !== it.tw_traditional);
    if (wrongTw.length < 3) wrongTw = [...wrongTw, ...localDistractors(it.tw_traditional, pool)];

    const wrongPairs: OptionWithMeta[] = wrongTw.map((tw) => ({
      text: tw,
      pinyin: pinyinMap.get(tw) || DEFAULT_FILLER_META[tw]?.pinyin || '',
      vi: viMap.get(tw) || DEFAULT_FILLER_META[tw]?.vi || '',
    }));

    let kind: 'en_to_tw' | 'tw_to_vi' | 'listen_to_tw' = 'en_to_tw';

    if (it.vi && it.vi.trim().length > 0) {
      const otherVis = await getOtherVietnameseMeanings(it.vi, 6, 'domain');
      if (otherVis.length >= 3) {
        const mod = i % 3;
        kind = mod === 1 ? 'tw_to_vi' : mod === 2 ? 'listen_to_tw' : 'en_to_tw';
      } else {
        kind = i % 2 === 1 ? 'listen_to_tw' : 'en_to_tw';
      }
    } else {
      kind = i % 2 === 1 ? 'listen_to_tw' : 'en_to_tw';
    }

    if (kind === 'tw_to_vi' && it.vi) {
      const otherVis = await getOtherVietnameseMeanings(it.vi, 6, 'domain');
      const { options, correct_index } = buildOptions(it.vi, otherVis.slice(0, 3));
      quests.push({
        kind,
        prompt_text: it.tw_traditional,
        prompt_pinyin: it.pinyin,
        question: `Thuật ngữ "${it.tw_traditional}" nghĩa là gì?`,
        options,
        correct_index,
      });
    } else if (kind === 'listen_to_tw') {
      const { options, options_pinyin, options_vi, correct_index } = buildOptionsWithMeta(
        { text: it.tw_traditional, pinyin: it.pinyin, vi: it.vi },
        wrongPairs
      );
      quests.push({
        kind,
        prompt_text: it.original_term,
        prompt_pinyin: it.pinyin,
        audio_text: it.tw_traditional,
        question: 'Nghe phát âm và chọn chữ Trung Phồn thể đúng:',
        options,
        options_pinyin,
        options_vi,
        correct_index,
      });
    } else {
      const { options, options_pinyin, options_vi, correct_index } = buildOptionsWithMeta(
        { text: it.tw_traditional, pinyin: it.pinyin, vi: it.vi },
        wrongPairs
      );
      quests.push({
        kind: 'en_to_tw',
        prompt_text: it.original_term,
        question: `"${it.original_term}" trong tiếng Trung Phồn thể (Đài Loan) là gì?`,
        options,
        options_pinyin,
        options_vi,
        correct_index,
      });
    }
  }

  return quests;
}

// ─── Tạo bài tập cho Câu giao tiếp (Communication) ─────────────────────────

export async function generateSentenceQuests(
  sentences: VocabularyItem[]
): Promise<AIQuest[]> {
  const quests: AIQuest[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const chunks = s.chunks && s.chunks.length >= 2 ? s.chunks : [];

    // Lấy đáp án nhiễu tại máy
    const otherSentences = await getOtherSentences(s.id, 6);
    const chunkPool = await getSentenceChunksPool(s.id, 12);

    // Xác định các kiểu bài tập hợp lệ cho câu này
    const eligibleKinds: ('listen_to_vi' | 'reorder' | 'fill_blank')[] = [];
    if (s.vi && otherSentences.length >= 3) {
      eligibleKinds.push('listen_to_vi');
    }
    if (chunks.length >= 2) {
      eligibleKinds.push('reorder');
    }
    if (chunks.length >= 2) {
      eligibleKinds.push('fill_blank');
    }

    if (eligibleKinds.length === 0) {
      if (chunks.length >= 2) {
        eligibleKinds.push('reorder');
      } else {
        eligibleKinds.push('listen_to_vi');
      }
    }

    // Chọn ngẫu nhiên trong danh sách hợp lệ
    const kind = eligibleKinds[Math.floor(Math.random() * eligibleKinds.length)];

    if (kind === 'reorder' && chunks.length >= 2) {
      let shuffled = shuffle([...chunks]);
      // Đảm bảo không trùng 100% thứ tự ban đầu nếu có từ 3 cụm
      if (chunks.length > 2 && shuffled.every((c, idx) => c === chunks[idx])) {
        shuffled = shuffle([...chunks]);
      }

      quests.push({
        kind: 'reorder',
        prompt_text: s.vi || s.original_term,
        prompt_pinyin: s.pinyin,
        question: 'Sắp xếp các cụm từ theo đúng thứ tự câu tiếng Trung:',
        options: [],
        correct_index: 0,
        chunks_shuffled: shuffled,
        answer_chunks: chunks,
        target_sentence: s.tw_traditional,
      });
    } else if (kind === 'fill_blank' && chunks.length >= 2) {
      const blankIndex = Math.floor(Math.random() * chunks.length);
      const targetChunk = chunks[blankIndex];
      const targetPinyin = extractChunkPinyin(s.tw_traditional, s.pinyin, targetChunk);

      // Meta map cho các cụm từ
      const chunkMetaMap = new Map<string, { pinyin: string; vi: string }>();
      DEFAULT_COMMUNICATION_CHUNKS.forEach((c) => {
        chunkMetaMap.set(c.text, { pinyin: c.pinyin || '', vi: c.vi || '' });
      });
      Object.entries(DEFAULT_FILLER_META).forEach(([k, v]) => {
        if (!chunkMetaMap.has(k)) chunkMetaMap.set(k, v);
      });

      // Bổ sung pinyin từ các câu khác trong cơ sở dữ liệu
      for (const os of otherSentences) {
        if (os.chunks && os.pinyin && os.tw_traditional) {
          for (const c of os.chunks) {
            if (!chunkMetaMap.has(c)) {
              const py = extractChunkPinyin(os.tw_traditional, os.pinyin, c);
              chunkMetaMap.set(c, { pinyin: py, vi: '' });
            }
          }
        }
      }

      // Tập hợp các cụm từ nhiễu
      const fullChunkPool = [
        ...chunkPool,
        ...DEFAULT_COMMUNICATION_CHUNKS.map((c) => c.text),
      ];
      const wrongChunks = Array.from(new Set(fullChunkPool.filter((c) => c && c !== targetChunk))).slice(0, 3);
      const wrongChunksWithMeta: OptionWithMeta[] = wrongChunks.map((wc) => ({
        text: wc,
        pinyin: chunkMetaMap.get(wc)?.pinyin || '',
        vi: chunkMetaMap.get(wc)?.vi || '',
      }));

      const targetVi = chunkMetaMap.get(targetChunk)?.vi || '';

      const { options, options_pinyin, options_vi, correct_index } = buildOptionsWithMeta(
        { text: targetChunk, pinyin: targetPinyin, vi: targetVi },
        wrongChunksWithMeta
      );

      // Tạo câu có ô trống
      const blankedSentence = chunks
        .map((c, idx) => (idx === blankIndex ? ' [ _____ ] ' : c))
        .join('');

      quests.push({
        kind: 'fill_blank',
        prompt_text: s.vi || s.original_term,
        prompt_pinyin: s.pinyin,
        question: 'Chọn cụm từ thích hợp điền vào chỗ trống:',
        options,
        options_pinyin,
        options_vi,
        correct_index,
        target_sentence: blankedSentence,
        audio_text: s.tw_traditional,
        blank_index: blankIndex,
      });
    } else {
      // listen_to_vi
      const otherVis = otherSentences.map((os) => os.vi!).filter(Boolean);
      const fallbackVis = ['Tôi có thể giúp gì cho bạn?', 'Hôm nay thời tiết rất đẹp', 'Bạn đã ăn cơm chưa?'];
      const poolVis = otherVis.length >= 3 ? otherVis : [...otherVis, ...fallbackVis];
      const { options, correct_index } = buildOptions(s.vi || s.original_term, poolVis.slice(0, 3));

      quests.push({
        kind: 'listen_to_vi',
        prompt_text: s.tw_traditional,
        prompt_pinyin: s.pinyin,
        audio_text: s.tw_traditional,
        question: 'Nghe phát âm và chọn nghĩa tiếng Việt đúng của câu:',
        options,
        correct_index,
      });
    }
  }

  return quests;
}

/** Đề xuất thuật ngữ theo ngành */
export async function suggestTerms(
  fieldKey: string,
  exclude: string[],
  count = 8,
  customPrompt?: string
): Promise<AITerm[]> {
  const field = getField(fieldKey);
  const promptToUse = customPrompt || field.prompt || field.label;
  const skip = exclude.slice(0, 80).filter(Boolean).join(', ');
  const r = await callGemini<{ terms: AITerm[] }>(
    [
      {
        text:
          `Ngành: ${promptToUse}. Đưa ${count} thuật ngữ thông dụng nhất của ngành ` +
          `kèm tiếng Anh chuẩn (original_term), Trung Phồn thể Đài Loan (TUYỆT ĐỐI KHÔNG DÙNG GIẢN THỂ), ` +
          `pinyin và vi (nghĩa tiếng Việt ngắn).` +
          `${skip ? ` TUYỆT ĐỐI BỎ QUA không đề xuất bất kỳ từ nào sau đây (đã có trong kho hoặc vừa xem): ${skip}.` : ''}`,
      },
    ],
    {
      type: 'OBJECT',
      properties: { terms: { type: 'ARRAY', items: TERM_ITEM_SCHEMA } },
      required: ['terms'],
    },
    1000
  );
  return r.terms ?? [];
}
