import { AiChatMessage, AiChatMetadata, PhraseRole } from '../types';

export interface PhraseBadgeInfo {
  role: PhraseRole;
  label: string;
  badgeStyleKey: 'phraseBadgeRecommended' | 'phraseBadgeQuote' | 'phraseBadgeAnalysis' | 'phraseBadgeVocab';
  textStyleKey: 'phraseBadgeTextRecommended' | 'phraseBadgeTextQuote' | 'phraseBadgeTextAnalysis' | 'phraseBadgeTextVocab';
}

/**
 * Xác định chính xác vai trò của nội dung tiếng Hoa trong phản hồi AI Chatbot:
 * - 'recommended': Câu khuyên người học nói / sử dụng trong giao tiếp chuẩn Đài Loan.
 * - 'quote': Câu trích dẫn từ đối tác, đồng nghiệp hoặc người bản địa nói với người dùng.
 * - 'analysis': Câu đang được mổ xẻ, phân tích lỗi ngữ pháp hoặc kiểm tra độ tự nhiên.
 * - 'vocab': Từ vựng đơn lẻ, thuật ngữ hoặc cụm từ ngắn không phải câu hoàn chỉnh.
 * 
 * Tuyệt đối không dùng độ dài chuỗi làm tiêu chí duy nhất.
 */
export function resolvePhraseRole(
  item: { tw?: string; content?: string; phrase_role?: PhraseRole },
  metadataObj?: AiChatMetadata | null
): PhraseRole {
  // 1. Ưu tiên vai trò được AI gán trực tiếp (từ schema hoặc metadata)
  if (item.phrase_role) {
    return item.phrase_role;
  }
  if (metadataObj?.phrase_role) {
    return metadataObj.phrase_role;
  }

  const tw = (item.tw || '').trim();
  if (!tw) return 'vocab';

  const content = (item.content || '').toLowerCase();

  // 2. Nhận diện câu đang phân tích (Analysis):
  // Dấu hiệu: content nói về lỗi ngữ pháp, dư từ, chồng chéo, phân tích tính tự nhiên của câu
  const isAnalysisContext =
    content.includes('không hẳn là sai ngữ pháp') ||
    content.includes('ít tự nhiên và rườm rà') ||
    content.includes('chồng chéo') ||
    content.includes('trùng lặp') ||
    content.includes('dư từ') ||
    content.includes('phân tích vai trò') ||
    content.includes('câu được người dùng phân tích') ||
    content.includes('câu này có tự nhiên không');

  if (isAnalysisContext) {
    return 'analysis';
  }

  // 3. Nhận diện câu trích dẫn từ người khác (Quote):
  // Dấu hiệu: câu do đồng nghiệp, đối tác hoặc người khác nói trong ngữ cảnh công việc/xã giao
  const isQuoteContext =
    content.includes('đồng nghiệp') ||
    content.includes('đối tác') ||
    content.includes('người khác nói') ||
    content.includes('họ nói') ||
    content.includes('tín hiệu hoãn binh') ||
    content.includes('lời chào xã giao') ||
    content.includes('đáp lại khi bạn đề xuất');

  // Nếu tw chính là câu trích dẫn của đối tác/người khác trong ngữ cảnh giao tiếp xã giao/công việc
  if (isQuoteContext && tw.length >= 3) {
    return 'quote';
  }

  // 4. Nhận diện câu giao tiếp hoàn chỉnh / câu khuyên dùng (Recommended):
  // Dấu hiệu: có cấu trúc câu (chủ ngữ - vị ngữ, mệnh đề, trợ từ ngữ khí, đại từ xưng hô, động từ yêu cầu)
  const hasSentenceStructure =
    /[，。？！,?!~…]/.test(tw) ||
    tw.startsWith('請') ||
    tw.startsWith('麻煩') ||
    tw.startsWith('不好意思') ||
    tw.includes('幫我') ||
    tw.includes('我要') ||
    tw.includes('我想') ||
    tw.includes('可以') ||
    tw.includes('沒辦法') ||
    tw.includes('手頭') ||
    tw.includes('借') ||
    tw.endsWith('嗎') ||
    tw.endsWith('呢') ||
    tw.endsWith('吧') ||
    tw.endsWith('喔') ||
    tw.endsWith('哦') ||
    tw.endsWith('了');

  if (hasSentenceStructure && tw.length >= 4) {
    return 'recommended';
  }

  // 5. Nếu là từ ngữ đơn lẻ, thuật ngữ ngắn (<= 4 chữ không có vị ngữ) -> Từ vựng
  return 'vocab';
}

/**
 * Trả về thông tin đầy đủ của Badge hiển thị trên giao diện người dùng
 */
export function getPhraseBadgeInfo(
  item: { tw?: string; content?: string; phrase_role?: PhraseRole },
  metadataObj?: AiChatMetadata | null
): PhraseBadgeInfo {
  const role = resolvePhraseRole(item, metadataObj);

  switch (role) {
    case 'analysis':
      return {
        role,
        label: 'Câu đang phân tích',
        badgeStyleKey: 'phraseBadgeAnalysis',
        textStyleKey: 'phraseBadgeTextAnalysis',
      };
    case 'quote':
      return {
        role,
        label: 'Câu trích dẫn (Đối tác nói)',
        badgeStyleKey: 'phraseBadgeQuote',
        textStyleKey: 'phraseBadgeTextQuote',
      };
    case 'recommended':
      return {
        role,
        label: metadataObj ? 'Câu khuyên dùng (Chuẩn Đài)' : 'Câu mẫu chuẩn Đài',
        badgeStyleKey: 'phraseBadgeRecommended',
        textStyleKey: 'phraseBadgeTextRecommended',
      };
    case 'vocab':
    default:
      return {
        role: 'vocab',
        label: 'Từ vựng chuẩn Đài',
        badgeStyleKey: 'phraseBadgeVocab',
        textStyleKey: 'phraseBadgeTextVocab',
      };
  }
}

/**
 * Đánh giá tính hiển thị của các khu vực trên Card giao diện
 */
export function getCollapsibleVisibility(
  item: { tw?: string; metadata?: string; explanation?: string; content?: string; vi?: string },
  metadataObj?: AiChatMetadata | null
) {
  const hasTw = !!item.tw && item.tw.trim().length > 0;
  const hasThought = !!metadataObj?.thought_summary && metadataObj.thought_summary.trim().length > 0;
  const hasVariations = !!metadataObj?.variations && metadataObj.variations.length > 0;
  const hasVocab = !!metadataObj?.key_words && metadataObj.key_words.length > 0;
  const hasCulture = !!metadataObj?.cultural_insight && metadataObj.cultural_insight.trim().length > 0;
  const hasAnyCollapsible = hasVariations || hasVocab || hasCulture;

  const isExplanationDuplicate =
    !item.explanation ||
    item.explanation.trim() === item.content?.trim() ||
    item.explanation.trim() === item.vi?.trim();

  const showExplanationBox = !!item.explanation && item.explanation.trim().length > 0 && !isExplanationDuplicate;

  return {
    hasTw,
    hasThought,
    hasVariations,
    variationsCount: metadataObj?.variations?.length || 0,
    hasVocab,
    vocabCount: metadataObj?.key_words?.length || 0,
    hasCulture,
    hasAnyCollapsible,
    showExplanationBox,
  };
}
