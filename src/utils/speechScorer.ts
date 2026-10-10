import { SpeechScoringResult } from '../types';

/**
 * Làm sạch chuỗi tiếng Trung (bỏ dấu câu, khoảng trắng, ký tự đặc biệt)
 */
function normalizeChinese(text: string): string {
  if (!text) return '';
  return text
    .replace(/[，。？！、…～~·—\-:：""''（）\(\)\s]/g, '')
    .trim();
}

/**
 * Chấm điểm phát âm tiếng Trung Client-side (0 Token Gemini, siêu tốc 0.001s)
 * So khớp số ký tự Hán tự trùng khớp và tìm các chữ đọc sót / đọc nhầm
 */
export function scoreSpeechAccuracy(
  transcribed: string,
  target: string
): SpeechScoringResult {
  const normTranscribed = normalizeChinese(transcribed);
  const normTarget = normalizeChinese(target);

  if (!normTarget) {
    return {
      score: 100,
      isPassed: true,
      transcribedText: transcribed,
      targetText: target,
      matchedChars: 0,
      totalChars: 0,
      feedback: 'Chính xác!',
    };
  }

  if (!normTranscribed) {
    return {
      score: 0,
      isPassed: false,
      transcribedText: transcribed,
      targetText: target,
      matchedChars: 0,
      totalChars: normTarget.length,
      feedback: 'Chưa nghe thấy giọng đọc, hãy thử nói to và rõ hơn nhé.',
    };
  }

  // Đếm tần suất ký tự của câu mục tiêu
  const targetCharCount: Record<string, number> = {};
  for (const ch of normTarget) {
    targetCharCount[ch] = (targetCharCount[ch] || 0) + 1;
  }

  // Đếm số ký tự khớp được từ bản thu âm
  const transcribedCharCount: Record<string, number> = {};
  for (const ch of normTranscribed) {
    transcribedCharCount[ch] = (transcribedCharCount[ch] || 0) + 1;
  }

  let matchedChars = 0;
  const missedChars: string[] = [];

  for (const [ch, count] of Object.entries(targetCharCount)) {
    const matchedForChar = Math.min(count, transcribedCharCount[ch] || 0);
    matchedChars += matchedForChar;
    if (matchedForChar < count) {
      missedChars.push(ch);
    }
  }

  // Tính tỷ lệ phần trăm (0 - 100)
  // Phạt nhẹ nếu đọc thừa quá nhiều từ không liên quan
  const rawRatio = matchedChars / normTarget.length;
  const lengthPenalty = normTranscribed.length > normTarget.length * 1.5 ? 0.9 : 1.0;
  const finalScore = Math.min(100, Math.round(rawRatio * 100 * lengthPenalty));

  const isPassed = finalScore >= 70;

  let feedback = '';
  if (finalScore >= 90) {
    feedback = 'Phát âm tuyệt vời chuẩn âm Đài Loan! 🎉';
  } else if (finalScore >= 75) {
    feedback = `Khá tốt (${finalScore}đ)! ${missedChars.length > 0 ? `Cần chú ý chữ: "${missedChars.slice(0, 3).join(', ')}"` : ''}`;
  } else if (finalScore >= 50) {
    feedback = `Đạt ${finalScore}đ. ${missedChars.length > 0 ? `Bạn đọc chưa rõ các chữ: "${missedChars.slice(0, 4).join(', ')}"` : 'Hãy nghe lại loa mẫu và thử lại nhé.'}`;
  } else {
    feedback = `Đạt ${finalScore}đ. Chưa khớp nhiều với câu mẫu, hãy nghe loa phát âm và đọc chậm lại nhé.`;
  }

  return {
    score: finalScore,
    isPassed,
    transcribedText: transcribed,
    targetText: target,
    matchedChars,
    totalChars: normTarget.length,
    feedback,
  };
}
