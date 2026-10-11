/**
 * Tính toán độ tương đồng ký tự (Levenshtein Distance)
 * và phân tích khác biệt từng ký tự cho tính năng Luyện nói
 */

export function cleanChineseText(text: string): string {
  // Loại bỏ khoảng trắng và mọi dấu câu (Unicode punctuation)
  return text
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .trim();
}

export function levenshteinDistance(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  if (an === 0) return bn;
  if (bn === 0) return an;

  const matrix: number[][] = [];
  for (let i = 0; i <= an; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= bn; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= an; i++) {
    for (let j = 1; j <= bn; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return matrix[an][bn];
}

export interface DiffChar {
  char: string;
  match: boolean;
}

export interface SimilarityResult {
  score: number; // 0.0 -> 1.0
  percentage: number; // 0 -> 100
  label: 'Chuẩn' | 'Gần đúng' | 'Thử lại';
  diffChars: DiffChar[];
  cleanedTarget: string;
  cleanedActual: string;
}

export function calculateSimilarity(target: string, actual: string): SimilarityResult {
  const cleanedTarget = cleanChineseText(target);
  const cleanedActual = cleanChineseText(actual);

  if (!cleanedTarget && !cleanedActual) {
    return {
      score: 1.0,
      percentage: 100,
      label: 'Chuẩn',
      diffChars: [],
      cleanedTarget: '',
      cleanedActual: '',
    };
  }

  if (!cleanedTarget || !cleanedActual) {
    return {
      score: 0.0,
      percentage: 0,
      label: 'Thử lại',
      diffChars: cleanedTarget.split('').map((char) => ({ char, match: false })),
      cleanedTarget,
      cleanedActual,
    };
  }

  const maxLen = Math.max(cleanedTarget.length, cleanedActual.length);
  const distance = levenshteinDistance(cleanedTarget, cleanedActual);
  const score = Math.max(0, Math.min(1, 1 - distance / maxLen));
  const percentage = Math.round(score * 100);

  let label: 'Chuẩn' | 'Gần đúng' | 'Thử lại';
  if (score >= 0.85) {
    label = 'Chuẩn';
  } else if (score >= 0.6) {
    label = 'Gần đúng';
  } else {
    label = 'Thử lại';
  }

  // Phân tích khớp ký tự của câu mục tiêu để tô màu
  // Ký tự có xuất hiện trong actual theo trình tự tương đối
  const actualChars = cleanedActual.split('');
  let actualIdx = 0;
  const diffChars: DiffChar[] = [];

  for (let i = 0; i < cleanedTarget.length; i++) {
    const targetChar = cleanedTarget[i];
    // Tìm targetChar từ vị trí actualIdx trong phạm vi gần (lookahead 2 ký tự)
    let foundIdx = -1;
    for (let k = actualIdx; k < Math.min(actualIdx + 3, actualChars.length); k++) {
      if (actualChars[k] === targetChar) {
        foundIdx = k;
        break;
      }
    }

    if (foundIdx !== -1) {
      diffChars.push({ char: targetChar, match: true });
      actualIdx = foundIdx + 1;
    } else {
      diffChars.push({ char: targetChar, match: false });
    }
  }

  return {
    score,
    percentage,
    label,
    diffChars,
    cleanedTarget,
    cleanedActual,
  };
}

export function removeVietnameseTones(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/** Chuẩn hóa câu nói tiếng Việt / Anh để tra cứu mờ (Fuzzy cache & Phrasebook) */
export function normalizeSearchText(text: string): string {
  if (!text) return '';
  // 1. Loại bỏ các từ đệm khi còn nguyên dấu để không xóa nhầm các từ có nghĩa như "đá", "đã", "da"
  const withoutTonedFillers = text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .replace(/\b(dạ|ạ|ơi|nhé|nha|vâng|ừ|ừm|hả|nè|làm ơn|giúp tôi|cho tôi xin|cho mình)\b/gi, ' ')
    .trim();

  // 2. Bỏ dấu tiếng Việt
  const deToned = removeVietnameseTones(withoutTonedFillers);

  // 3. Chỉ lọc các từ đệm không dấu tuyệt đối an toàn (không bao giờ xóa "da", "di", "khong")
  return deToned
    .replace(/\b(oi|nhe|nha|vang|uh|um|ha|ne)\b/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export interface RadarChar {
  char: string;
  pinyin?: string;
  actual_pinyin?: string;
  status: 'correct' | 'warning' | 'error'; // 🟢 xanh (đúng), 🟡 vàng (gần đúng/lệch âm), 🔴 đỏ (sai hoàn toàn)
}

export interface PronunciationRadarResult {
  score: number; // 0.0 -> 1.0
  percentage: number;
  label: 'Hoàn hảo' | 'Khá tốt' | 'Cần luyện thêm';
  chars: RadarChar[];
}

import {
  splitPinyinIntoSyllables,
  alignPinyinWithChinese,
  segmentPinyinWord,
  stripPinyinTone,
} from './pinyin';

export { splitPinyinIntoSyllables, alignPinyinWithChinese, segmentPinyinWord, stripPinyinTone };

export function evaluatePronunciationRadar(
  target: string,
  actual: string,
  targetPinyin?: string,
  actualPinyin?: string
): PronunciationRadarResult {
  const cleanedTarget = cleanChineseText(target);
  const cleanedActual = cleanChineseText(actual);
  const targetPinyinList = splitPinyinIntoSyllables(targetPinyin);
  const actualPinyinList = splitPinyinIntoSyllables(actualPinyin);

  if (!cleanedTarget) {
    return {
      score: 1.0,
      percentage: 100,
      label: 'Hoàn hảo',
      chars: [],
    };
  }

  // Khi người dùng không nói gì hoặc không thu được âm thanh -> 0 điểm tuyệt đối, toàn bộ báo lỗi đỏ
  if (!cleanedActual) {
    return {
      score: 0.0,
      percentage: 0,
      label: 'Cần luyện thêm',
      chars: cleanedTarget.split('').map((char, i) => ({
        char,
        pinyin: targetPinyinList[i] || '',
        status: 'error',
      })),
    };
  }

  const targetChars = cleanedTarget.split('');
  const actualChars = cleanedActual.split('');
  const radarChars: RadarChar[] = [];
  let correctCount = 0;
  let warningCount = 0;
  let actualIdx = 0;

  for (let i = 0; i < targetChars.length; i++) {
    const tChar = targetChars[i];
    const tPy = targetPinyinList[i] || '';
    const tBase = stripPinyinTone(tPy).toLowerCase();

    // 1. Tìm kiếm khớp chính xác chữ Hán trong phạm vi cửa sổ 3 ký tự
    let foundIdx = -1;
    for (let k = actualIdx; k < Math.min(actualIdx + 3, actualChars.length); k++) {
      if (actualChars[k] === tChar) {
        foundIdx = k;
        break;
      }
    }

    if (foundIdx !== -1) {
      // Khớp chính xác chữ Hán
      radarChars.push({
        char: tChar,
        pinyin: tPy,
        status: 'correct',
      });
      correctCount++;
      actualIdx = foundIdx + 1;
    } else {
      // 2. Không khớp chữ Hán: Kiểm tra xem có đúng âm cơ bản nhưng lệch thanh không
      if (actualIdx < actualChars.length) {
        const aPy = actualPinyinList[actualIdx] || '';
        const aBase = stripPinyinTone(aPy).toLowerCase();

        // Kiểm tra xem âm tiết cơ bản có giống nhau không (ví dụ: 'xiě' vs 'xiè' đều có base là 'xie', 'hào' vs 'hǎo' đều có base là 'hao')
        // Hoặc các cặp âm đồng vị trong khẩu âm Đài Loan: s/sh, z/zh, c/ch, in/ing, en/eng
        const isSameBase = Boolean(tBase && aBase && tBase === aBase);
        const isNearHomophone = Boolean(
          tBase &&
          aBase &&
          ((tBase.replace(/^sh/, 's') === aBase.replace(/^sh/, 's')) ||
           (tBase.replace(/^zh/, 'z') === aBase.replace(/^zh/, 'z')) ||
           (tBase.replace(/^ch/, 'c') === aBase.replace(/^ch/, 'c')) ||
           (tBase.replace(/ng$/, 'n') === aBase.replace(/ng$/, 'n')))
        );

        if (isSameBase || isNearHomophone) {
          // Đúng âm tiết cơ bản nhưng bị lệch thanh điệu -> warning (🟡 Lệch thanh)
          radarChars.push({
            char: tChar,
            pinyin: tPy,
            actual_pinyin: aPy,
            status: 'warning',
          });
          warningCount++;
          actualIdx++;
        } else {
          // Ký tự hoàn toàn khác, đọc sai âm tiết hoặc đọc bừa từ khác -> error (🔴 Sai âm)
          radarChars.push({
            char: tChar,
            pinyin: tPy,
            actual_pinyin: aPy,
            status: 'error',
          });
          actualIdx++;
        }
      } else {
        // Hoàn toàn không phát âm tới chữ này (bỏ sót) -> error (🔴 Sai âm)
        radarChars.push({
          char: tChar,
          pinyin: tPy,
          status: 'error',
        });
      }
    }
  }

  // Điểm số: Đúng hoàn toàn = 1.0, Lệch thanh = 0.5, Sai âm = 0.0
  const rawScore = (correctCount * 1.0 + warningCount * 0.5) / targetChars.length;
  const score = Math.max(0, Math.min(1, rawScore));
  const percentage = Math.round(score * 100);
  const label = percentage >= 85 ? 'Hoàn hảo' : percentage >= 60 ? 'Khá tốt' : 'Cần luyện thêm';

  return {
    score,
    percentage,
    label,
    chars: radarChars,
  };
}
