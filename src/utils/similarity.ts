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
  status: 'correct' | 'warning' | 'error'; // 🟢 xanh (đúng), 🟡 vàng (gần đúng/lệch âm), 🔴 đỏ (sai hoàn toàn)
}

export interface PronunciationRadarResult {
  score: number; // 0.0 -> 1.0
  percentage: number;
  label: 'Hoàn hảo' | 'Khá tốt' | 'Cần luyện thêm';
  chars: RadarChar[];
}

import { splitPinyinIntoSyllables, alignPinyinWithChinese, segmentPinyinWord } from './pinyin';

export { splitPinyinIntoSyllables, alignPinyinWithChinese, segmentPinyinWord };

export function evaluatePronunciationRadar(
  target: string,
  actual: string,
  targetPinyin?: string
): PronunciationRadarResult {
  const cleanedTarget = cleanChineseText(target);
  const cleanedActual = cleanChineseText(actual);
  const pinyinList = splitPinyinIntoSyllables(targetPinyin);

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
        pinyin: pinyinList[i] || '',
        status: 'error',
      })),
    };
  }

  const actualChars = cleanedActual.split('');
  let actualIdx = 0;
  const radarChars: RadarChar[] = [];
  let correctCount = 0;

  for (let i = 0; i < cleanedTarget.length; i++) {
    const targetChar = cleanedTarget[i];
    const pinyin = pinyinList[i] || '';

    // Tìm kiếm trong phạm vi gần (window size 3)
    let foundIdx = -1;
    for (let k = actualIdx; k < Math.min(actualIdx + 3, actualChars.length); k++) {
      if (actualChars[k] === targetChar) {
        foundIdx = k;
        break;
      }
    }

    if (foundIdx !== -1) {
      // Khớp chính xác
      radarChars.push({ char: targetChar, pinyin, status: 'correct' });
      correctCount++;
      actualIdx = foundIdx + 1;
    } else {
      // Kiểm tra xem ký tự thực tế tại vị trí đó có hay không (nếu có nhưng khác chữ -> có thể do phát âm lệch thanh điệu)
      if (actualIdx < actualChars.length) {
        radarChars.push({ char: targetChar, pinyin, status: 'warning' });
        actualIdx++;
      } else {
        // Hoàn toàn không phát âm tới chữ này
        radarChars.push({ char: targetChar, pinyin, status: 'error' });
      }
    }
  }

  const score = Math.max(0, Math.min(1, correctCount / cleanedTarget.length));
  const percentage = Math.round(score * 100);
  const label = score >= 0.85 ? 'Hoàn hảo' : score >= 0.6 ? 'Khá tốt' : 'Cần luyện thêm';

  return {
    score,
    percentage,
    label,
    chars: radarChars,
  };
}
