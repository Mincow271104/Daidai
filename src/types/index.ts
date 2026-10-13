export interface VocabularyItem {
  id: string;
  original_term: string;
  tw_term: string;
  tw_traditional: string;
  cn_simplified?: string;
  pinyin: string;
  vi?: string;
  category?: string;
  context_sentence: string;
  context_note?: string;
  captured_at: number;
  source?: string;
  is_favorite?: number;
  /** 'mastered' = lần trả lời gần nhất đúng; 'review' = chưa làm hoặc trả lời sai */
  status?: 'mastered' | 'review';
  scope?: 'domain' | 'communication';
  kind?: 'term' | 'sentence';
  topic?: string;
  chunks?: string[];
  natural_tw?: string;
  natural_pinyin?: string;
  natural_note?: string;
}

export interface FSRSState {
  vocab_id: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number; // 0=New, 1=Learning, 2=Review, 3=Relearning
  last_review?: number;
  next_review: number;
}

export interface QuestHistory {
  id: string;
  vocab_id: string;
  quest_type: 'multiple_choice' | 'speed_match' | 'roleplay' | 'listening' | 'reorder';
  answer_given?: number;
  correct_index?: number;
  is_correct: boolean;
  time_taken_ms?: number;
  completed_at: number;
}

/** Thuật ngữ do AI trả về (chỉ giữ phần tối thiểu để tiết kiệm token) */
export interface AITerm {
  original_term: string;
  tw_traditional: string;
  pinyin: string;
  vi?: string;
  category?: string;
}

/** Câu giao tiếp hoàn chỉnh do AI phân tích và chuẩn hóa */
export interface AISentenceItem {
  sentence_en: string;
  sentence_tw: string;
  pinyin: string;
  vi: string;
  topic: string;
  chunks: string[];
  terms: AITerm[];
  natural_tw?: string;
  natural_pinyin?: string;
  natural_note?: string;
  register?: 'casual' | 'formal' | 'workplace';
}

export interface AIQuest {
  question: string;
  options: string[];
  correct_index: number;
  kind?: 'en_to_tw' | 'tw_to_vi' | 'listen_to_tw' | 'listen_to_vi' | 'reorder' | 'fill_blank';
  audio_text?: string;
  prompt_text?: string;
  target_sentence?: string;
  chunks_shuffled?: string[];
  answer_chunks?: string[];
  blank_index?: number;
  prompt_pinyin?: string;
  options_pinyin?: string[];
  options_vi?: string[];
}

export interface WordContextExplanation {
  word: string;
  pinyin: string;
  vi_in_context: string;
  en_in_context: string;
  general_meaning: string;
  example_tw?: string;
  example_pinyin?: string;
  example_vi?: string;
  is_local?: boolean;
}

export interface ConversationMessage {
  id: string;
  session_id: string;
  sender: 'me' | 'partner';
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
  field?: string;
  created_at: number;
  is_saved?: number;
}

export interface ConversationSession {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  turn_count: number;
}

export interface AIAnalysisResult {
  terms: AITerm[];
  items?: AISentenceItem[];
  transcribed_text?: string;
  source?: 'local' | 'gemini';
}

export interface ChunkAnalysisItem {
  tw: string;
  pinyin: string;
  vi: string;
}

export interface DialogueOption {
  tw: string;
  pinyin: string;
  vi: string;
  en: string;
}

export interface DialogueTurnResponse {
  character_tw: string;
  character_pinyin: string;
  character_vi: string;
  character_en: string;
  character_name?: string;
  user_role_name?: string;
  options: DialogueOption[];
  is_final?: boolean;
}

export interface DialogueTurn {
  character_tw: string;
  character_pinyin: string;
  character_vi: string;
  character_en: string;
  character_name?: string;
  user_role_name?: string;
  options: DialogueOption[];
  correct_index: number;
  selected_index?: number;
  is_final?: boolean;
}

export interface PhraseCorrection {
  id: string;
  original_phrase: string;
  native_sample: string;
  audio_uri?: string;
  reason?: string;
  field_key?: string;
  created_at: number;
}

export interface CustomScenario {
  id: string;
  title: string;
  prompt: string;
  topic?: string;
  turns: DialogueTurn[];
  created_at: number;
}

export interface SpeechScoringResult {
  score: number;
  isPassed: boolean;
  transcribedText: string;
  targetText: string;
  matchedChars: number;
  totalChars: number;
  feedback: string;
}

export type MascotState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'eureka'
  | 'confused'
  | 'sleeping'
  | 'teaching';

export interface TopicItem {
  id?: string;
  key: string;
  label: string;
  icon?: string;
  is_default?: boolean;
}

export interface SituationalPhraseResult {
  tw: string;
  pinyin: string;
  vi: string;
  chunks: string[];
  cultural_note: string; // 1-2 câu súc tích giải thích tư duy người Đài
  avoid_note?: string;    // 1 câu ngắn lưu ý cách dịch thô nên tránh
  suggested_topic: string;
}

export type ModelTier = 'low' | 'medium' | 'high';

export interface AiChatSession {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface AiChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  tw?: string;
  pinyin?: string;
  vi?: string;
  explanation?: string;
  created_at: number;
  feedback?: number; // 0 = none, 1 = thumbs up, -1 = thumbs down
  feedback_note?: string;
}

export interface AiChatFeedback {
  id: string;
  message_id: string;
  original_query: string;
  bot_response: string;
  user_correction: string;
  reason?: string;
  created_at: number;
}


