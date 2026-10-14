import { getDatabase, initDatabase } from './schema';
import {
  VocabularyItem,
  FSRSState,
  QuestHistory,
  ConversationMessage,
  ConversationSession,
  PhraseCorrection,
  CustomScenario,
  DialogueTurn,
  AiChatSession,
  AiChatMessage,
  AiChatFeedback,
} from '../types';
import { normalizeSearchText, levenshteinDistance, cleanChineseText } from '../utils/similarity';
import { Topic, registerTopics, DEFAULT_TOPICS } from '../constants/topics';
import { Field, setCustomFieldsCache } from '../constants/fields';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

async function getReadyDatabase() {
  await initDatabase();
  return getDatabase();
}

function mapVocabRow(row: any): VocabularyItem {
  let chunks: string[] | undefined = undefined;
  if (row.chunks) {
    try {
      chunks = JSON.parse(row.chunks);
    } catch {
      chunks = undefined;
    }
  }
  return {
    ...row,
    scope: row.scope ?? 'domain',
    kind: row.kind ?? 'term',
    topic: row.topic ?? 'other',
    chunks,
    natural_tw: row.natural_tw ?? undefined,
    natural_pinyin: row.natural_pinyin ?? undefined,
    natural_note: row.natural_note ?? undefined,
  };
}

// ─── Vocabulary ────────────────────────────────────────────────

export async function insertVocabulary(
  item: Omit<VocabularyItem, 'id' | 'captured_at'>
): Promise<VocabularyItem> {
  const db = await getReadyDatabase();
  const id = uuidv4();
  const captured_at = Date.now();
  const chunksJson = item.chunks && item.chunks.length > 0 ? JSON.stringify(item.chunks) : null;
  const scope = item.scope ?? 'domain';
  const kind = item.kind ?? 'term';
  const topic = (item.topic && item.topic.trim()) ? item.topic.trim() : 'other';

  await db.runAsync(
    `INSERT INTO vocabulary (
      id, original_term, tw_term, tw_traditional, cn_simplified, pinyin, vi, category,
      context_sentence, context_note, captured_at, source, scope, kind, topic, chunks,
      natural_tw, natural_pinyin, natural_note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      item.original_term,
      item.tw_term,
      item.tw_traditional,
      item.cn_simplified ?? null,
      item.pinyin,
      item.vi ?? null,
      item.category ?? 'general',
      item.context_sentence,
      item.context_note ?? null,
      captured_at,
      item.source ?? 'voice',
      scope,
      kind,
      topic,
      chunksJson,
      item.natural_tw ?? null,
      item.natural_pinyin ?? null,
      item.natural_note ?? null,
    ]
  );

  // Insert default FSRS state
  const nextReview = Date.now(); // Due immediately
  await db.runAsync(
    `INSERT INTO fsrs_state (vocab_id, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, next_review)
     VALUES (?, 0, 0, 0, 0, 0, 0, 0, ?, ?)`,
    [id, null, nextReview]
  );

  return {
    id,
    captured_at,
    ...item,
    scope,
    kind,
    topic,
  };
}

export async function getAllVocabulary(
  scope?: 'domain' | 'communication'
): Promise<VocabularyItem[]> {
  const db = await getReadyDatabase();
  let query = `
    SELECT v.*,
      CASE WHEN (SELECT q.is_correct FROM quest_history q
                 WHERE q.vocab_id = v.id ORDER BY q.completed_at DESC LIMIT 1) = 1
           THEN 'mastered' ELSE 'review' END AS status
    FROM vocabulary v
  `;
  const params: any[] = [];

  if (scope) {
    query += ` WHERE v.scope = ? `;
    params.push(scope);
  }

  query += ` ORDER BY v.captured_at DESC`;

  const rows = await db.getAllAsync<any>(query, params);
  return rows.map(mapVocabRow);
}

export async function getVocabularyById(id: string): Promise<VocabularyItem | null> {
  const db = await getReadyDatabase();
  const row = await db.getFirstAsync<any>(
    `SELECT * FROM vocabulary WHERE id = ?`,
    [id]
  );
  return row ? mapVocabRow(row) : null;
}

export async function lookupLocalVocabulary(term: string): Promise<VocabularyItem | null> {
  const db = await getReadyDatabase();
  const trimmed = term.trim();
  if (!trimmed) return null;
  const cleanTw = cleanChineseText(trimmed);

  // 1. Khớp chính xác hoàn toàn (Phồn thể, thuật ngữ gốc hoặc không phân biệt hoa thường)
  let row = await db.getFirstAsync<any>(
    `SELECT * FROM vocabulary 
     WHERE tw_traditional = ? OR tw_term = ? OR original_term = ? OR LOWER(original_term) = LOWER(?)
     ORDER BY captured_at DESC LIMIT 1`,
    [trimmed, trimmed, trimmed, trimmed]
  );

  // 2. Thử với chữ Hán đã làm sạch chuẩn Phồn thể
  if (!row && cleanTw !== trimmed && cleanTw.length > 0) {
    row = await db.getFirstAsync<any>(
      `SELECT * FROM vocabulary 
       WHERE tw_traditional = ? OR tw_term = ?
       ORDER BY captured_at DESC LIMIT 1`,
      [cleanTw, cleanTw]
    );
  }

  // 3. Khớp tiền tố hoặc chứa từ (nếu độ dài >= 2 ký tự)
  if (!row && cleanTw.length >= 2) {
    row = await db.getFirstAsync<any>(
      `SELECT * FROM vocabulary 
       WHERE tw_traditional LIKE ? OR original_term LIKE ?
       ORDER BY LENGTH(tw_traditional) ASC, captured_at DESC LIMIT 1`,
      [`%${cleanTw}%`, `%${trimmed}%`]
    );
  }

  return row ? mapVocabRow(row) : null;
}

export async function getDueVocabulary(
  limit: number = 5,
  scope?: 'domain' | 'communication'
): Promise<VocabularyItem[]> {
  const db = await getReadyDatabase();
  const now = Date.now();
  let query = `
    SELECT v.*,
      CASE WHEN (SELECT q.is_correct FROM quest_history q
                 WHERE q.vocab_id = v.id ORDER BY q.completed_at DESC LIMIT 1) = 1
           THEN 'mastered' ELSE 'review' END AS status
    FROM vocabulary v
    JOIN fsrs_state f ON v.id = f.vocab_id
    WHERE (
      f.next_review <= ?
      OR (
        SELECT q.is_correct FROM quest_history q
        WHERE q.vocab_id = v.id ORDER BY q.completed_at DESC LIMIT 1
      ) = 0
    )
  `;
  const params: any[] = [now];

  if (scope) {
    query += ` AND v.scope = ? `;
    params.push(scope);
  }

  query += `
    ORDER BY
      CASE WHEN (SELECT q.is_correct FROM quest_history q WHERE q.vocab_id = v.id ORDER BY q.completed_at DESC LIMIT 1) = 0 THEN 0 ELSE 1 END,
      f.next_review ASC
    LIMIT ?
  `;
  params.push(limit);

  const rows = await db.getAllAsync<any>(query, params);
  return rows.map(mapVocabRow);
}

/**
 * Lấy các từ/câu cũ để ôn tập lại khi không còn từ mới hoặc từ sai đến hạn.
 * Ưu tiên các từ đã lâu nhất chưa được ôn tập (last_review cũ nhất hoặc null).
 */
export async function getOldVocabulary(
  limit: number = 5,
  scope?: 'domain' | 'communication'
): Promise<VocabularyItem[]> {
  const db = await getReadyDatabase();
  let query = `
    SELECT v.*,
      CASE WHEN (SELECT q.is_correct FROM quest_history q
                 WHERE q.vocab_id = v.id ORDER BY q.completed_at DESC LIMIT 1) = 1
           THEN 'mastered' ELSE 'review' END AS status
    FROM vocabulary v
    LEFT JOIN fsrs_state f ON v.id = f.vocab_id
  `;
  const params: any[] = [];

  if (scope) {
    query += ` WHERE v.scope = ? `;
    params.push(scope);
  }

  query += ` ORDER BY COALESCE(f.last_review, 0) ASC, RANDOM() LIMIT ?`;
  params.push(limit);

  const rows = await db.getAllAsync<any>(query, params);
  return rows.map(mapVocabRow);
}

export async function toggleFavorite(id: string): Promise<void> {
  const db = await getReadyDatabase();
  await db.runAsync(
    `UPDATE vocabulary SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END WHERE id = ?`,
    [id]
  );
}

export async function deleteVocabulary(id: string): Promise<void> {
  const db = await getReadyDatabase();
  // Xóa cứng triệt để mọi dữ liệu liên quan ở cả 3 bảng để không lưu rác trong database
  await db.runAsync(`DELETE FROM fsrs_state WHERE vocab_id = ?`, [id]);
  await db.runAsync(`DELETE FROM quest_history WHERE vocab_id = ?`, [id]);
  await db.runAsync(`DELETE FROM vocabulary WHERE id = ?`, [id]);
}

// ─── FSRS State ────────────────────────────────────────────────

export async function getFSRSState(vocabId: string): Promise<FSRSState | null> {
  const db = await getReadyDatabase();
  return await db.getFirstAsync<FSRSState>(
    `SELECT * FROM fsrs_state WHERE vocab_id = ?`,
    [vocabId]
  );
}

export async function updateFSRSState(state: FSRSState): Promise<void> {
  const db = await getReadyDatabase();
  await db.runAsync(
    `UPDATE fsrs_state SET stability=?, difficulty=?, elapsed_days=?, scheduled_days=?,
     reps=?, lapses=?, state=?, last_review=?, next_review=?
     WHERE vocab_id=?`,
    [
      state.stability,
      state.difficulty,
      state.elapsed_days,
      state.scheduled_days,
      state.reps,
      state.lapses,
      state.state,
      state.last_review ?? null,
      state.next_review,
      state.vocab_id,
    ]
  );
}

// ─── Quest History ─────────────────────────────────────────────

export async function insertQuestHistory(
  quest: Omit<QuestHistory, 'id' | 'completed_at'>
): Promise<void> {
  const db = await getReadyDatabase();
  const id = uuidv4();
  await db.runAsync(
    `INSERT INTO quest_history (id, vocab_id, quest_type, answer_given, correct_index, is_correct, time_taken_ms, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      quest.vocab_id,
      quest.quest_type,
      quest.answer_given ?? null,
      quest.correct_index ?? null,
      quest.is_correct ? 1 : 0,
      quest.time_taken_ms ?? null,
      Date.now(),
    ]
  );
}

function getLocalDateString(timestamp: number | Date = Date.now()): string {
  const d = new Date(timestamp);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getYesterdayDateString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return getLocalDateString(d);
}

/**
 * Tính toán chuỗi ngày học thực tế liên tiếp dựa trên mốc thời gian hoàn thành bài tập trong quest_history.
 */
export async function calculateStreakFromHistory(): Promise<{ streak: number; lastDate: string | null }> {
  const db = await getReadyDatabase();
  const rows = await db.getAllAsync<{ completed_at: number }>(
    `SELECT completed_at FROM quest_history ORDER BY completed_at DESC`
  );
  if (rows.length === 0) {
    return { streak: 0, lastDate: null };
  }

  const distinctDates = new Set<string>();
  for (const row of rows) {
    distinctDates.add(getLocalDateString(row.completed_at));
  }

  const today = getLocalDateString();
  const yesterday = getYesterdayDateString();

  // Nếu người dùng không học hôm nay VÀ không học hôm qua -> chuỗi bị đứt (0 ngày)
  if (!distinctDates.has(today) && !distinctDates.has(yesterday)) {
    return { streak: 0, lastDate: Array.from(distinctDates).sort().pop() || null };
  }

  // Đếm lùi từng ngày liên tiếp từ hôm nay (nếu đã học hôm nay) hoặc hôm qua
  let checkDate = new Date();
  if (!distinctDates.has(today)) {
    checkDate.setDate(checkDate.getDate() - 1);
  }

  let streak = 0;
  while (true) {
    const dateStr = getLocalDateString(checkDate);
    if (distinctDates.has(dateStr)) {
      streak += 1;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  const lastDate = distinctDates.has(today) ? today : yesterday;
  return { streak, lastDate };
}

export async function getQuestStreak(): Promise<number> {
  const db = await getReadyDatabase();
  const streakRow = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'streak'`
  );
  const lastDateRow = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'last_streak_date'`
  );

  const today = getLocalDateString();
  const yesterday = getYesterdayDateString();
  const currentStreak = parseInt(streakRow?.value ?? '0', 10);
  const lastDate = lastDateRow?.value;

  // Tự động hiệu chỉnh nếu chưa có last_streak_date hoặc streak cũ bị ảo do bug đếm số lần làm bài (>= 10)
  if (!lastDate || currentStreak >= 10) {
    const { streak: calcStreak, lastDate: calcLastDate } = await calculateStreakFromHistory();
    await setQuestStreak(calcStreak, calcLastDate ?? today);
    return calcStreak;
  }

  // Nếu ngày làm bài gần nhất là hôm nay hoặc hôm qua, streak vẫn còn hiệu lực
  if (lastDate === today || lastDate === yesterday) {
    return currentStreak;
  }

  // Nếu đã quá 1 ngày không học -> đứt chuỗi streak
  if (currentStreak > 0) {
    await setQuestStreak(0, lastDate);
  }
  return 0;
}

export async function setQuestStreak(streak: number, lastDate?: string): Promise<void> {
  const db = await getReadyDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('streak', ?)`,
    [streak.toString()]
  );
  if (lastDate !== undefined) {
    await db.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_streak_date', ?)`,
      [lastDate]
    );
  }
}

/**
 * Ghi nhận hoàn thành bài tập và cập nhật streak theo ngày dương lịch thực tế:
 * - Trong cùng một ngày, dù làm bao nhiêu lượt bài tập thì streak chỉ ghi nhận 1 lần, KHÔNG cộng dồn.
 * - Nếu hôm qua có học và hôm nay làm bài -> streak + 1.
 * - Nếu đứt chuỗi hoặc bắt đầu mới -> streak = 1.
 */
export async function recordQuestCompletion(hasCorrectAnswer: boolean = true): Promise<number> {
  const db = await getReadyDatabase();
  const today = getLocalDateString();
  const yesterday = getYesterdayDateString();

  const streakRow = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'streak'`
  );
  const lastDateRow = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'last_streak_date'`
  );

  let currentStreak = parseInt(streakRow?.value ?? '0', 10);
  const lastDate = lastDateRow?.value;

  // Nếu người dùng không trả lời đúng câu nào trong lượt này:
  if (!hasCorrectAnswer) {
    if (lastDate === today || lastDate === yesterday) {
      return currentStreak;
    }
    await setQuestStreak(0, lastDate ?? today);
    return 0;
  }

  // Đã có câu trả lời đúng hôm nay:
  if (lastDate === today) {
    // Đã ghi nhận streak cho ngày hôm nay rồi, không tăng thêm lần nữa!
    const finalStreak = Math.max(1, currentStreak);
    if (finalStreak !== currentStreak) {
      await setQuestStreak(finalStreak, today);
    }
    return finalStreak;
  }

  let newStreak = 1;
  if (lastDate === yesterday && currentStreak > 0) {
    // Hôm qua có học -> tiếp tục chuỗi liên tiếp + 1 ngày
    newStreak = currentStreak + 1;
  } else {
    // Bắt đầu chuỗi mới -> 1 ngày
    newStreak = 1;
  }

  await setQuestStreak(newStreak, today);
  return newStreak;
}

export async function getTotalStats(
  scope?: 'domain' | 'communication'
): Promise<{ total: number; mastered: number; due: number }> {
  const all = await getAllVocabulary(scope);
  const mastered = all.filter((v) => v.status === 'mastered').length;
  return { total: all.length, mastered, due: all.length - mastered };
}

export function normalizeTerm(str: string): string {
  if (!str) return '';
  return str
    .trim()
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g, '')
    .replace(/\s+/g, ' ');
}

export async function termExists(
  originalTerm: string,
  kind?: 'term' | 'sentence',
  twTraditional?: string
): Promise<boolean> {
  const db = await getReadyDatabase();
  const norm = normalizeTerm(originalTerm);
  const normTw = (twTraditional || '').trim();
  if (!norm && !normTw) return false;

  let query = `SELECT original_term, tw_traditional, tw_term FROM vocabulary`;
  const params: any[] = [];
  if (kind) {
    query += ` WHERE kind = ?`;
    params.push(kind);
  }

  const rows = await db.getAllAsync<{ original_term: string; tw_traditional?: string; tw_term?: string }>(query, params);
  return rows.some((r) => {
    if (norm && normalizeTerm(r.original_term) === norm) return true;
    if (normTw && (r.tw_traditional?.trim() === normTw || r.tw_term?.trim() === normTw)) return true;
    return false;
  });
}

// ─── Settings & Cache ──────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  const db = await getReadyDatabase();
  const r = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = ?`,
    [key]
  );
  return r?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getReadyDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)`,
    [key, value]
  );
}

export async function getCache(key: string): Promise<string | null> {
  const db = await getReadyDatabase();
  const r = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM ai_cache WHERE key = ?`,
    [key]
  );
  return r?.value ?? null;
}

export async function setCache(key: string, value: string): Promise<void> {
  const db = await getReadyDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO ai_cache (key, value, created_at) VALUES (?, ?, ?)`,
    [key, value, Date.now()]
  );
}

export async function getOtherVietnameseMeanings(
  excludeVi: string,
  limit = 6,
  scope?: 'domain' | 'communication'
): Promise<string[]> {
  const db = await getReadyDatabase();
  let query = `
    SELECT DISTINCT vi FROM vocabulary
    WHERE vi IS NOT NULL AND TRIM(vi) != '' AND LOWER(TRIM(vi)) != LOWER(TRIM(?))
  `;
  const params: any[] = [excludeVi];

  if (scope) {
    query += ` AND scope = ? `;
    params.push(scope);
  }

  query += ` LIMIT ?`;
  params.push(limit);

  const rows = await db.getAllAsync<{ vi: string }>(query, params);
  return rows.map((r) => r.vi).filter(Boolean);
}

export async function getOtherSentences(
  excludeId: string,
  limit = 6
): Promise<VocabularyItem[]> {
  const db = await getReadyDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM vocabulary
     WHERE scope = 'communication' AND kind = 'sentence' AND id != ? AND vi IS NOT NULL AND TRIM(vi) != ''
     ORDER BY captured_at DESC LIMIT ?`,
    [excludeId, limit]
  );
  return rows.map(mapVocabRow);
}

export async function getSentenceChunksPool(
  excludeId: string,
  limit = 12
): Promise<string[]> {
  const db = await getReadyDatabase();
  const rows = await db.getAllAsync<{ chunks: string }>(
    `SELECT chunks FROM vocabulary
     WHERE scope = 'communication' AND kind = 'sentence' AND id != ? AND chunks IS NOT NULL
     ORDER BY captured_at DESC LIMIT ?`,
    [excludeId, limit]
  );

  const pool: string[] = [];
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.chunks);
      if (Array.isArray(parsed)) {
        for (const c of parsed) {
          if (typeof c === 'string' && c.trim()) pool.push(c.trim());
        }
      }
    } catch {
      // ignore
    }
  }

  return Array.from(new Set(pool));
}

// ─── Dialogue Daily Limit Helper ────────────────────────────────

export async function getDialogueDailyCount(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const key = `dialogue_count_${today}`;
  const val = await getSetting(key);
  return val ? parseInt(val, 10) : 0;
}

export async function incrementDialogueDailyCount(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const key = `dialogue_count_${today}`;
  const current = await getDialogueDailyCount();
  const next = current + 1;
  await setSetting(key, next.toString());
  return next;
}

// ─── 2-Way Conversation Messages ───────────────────────────────

function mapConvRow(row: any): ConversationMessage {
  let chunks: string[] | undefined = undefined;
  if (row.chunks) {
    try {
      chunks = JSON.parse(row.chunks);
    } catch {
      chunks = undefined;
    }
  }
  let terms: any = undefined;
  if (row.terms) {
    try {
      terms = JSON.parse(row.terms);
    } catch {
      terms = undefined;
    }
  }
  return {
    ...row,
    chunks,
    terms,
    field: row.field ?? undefined,
    is_saved: row.is_saved ?? 0,
  };
}

export async function insertConversationMessage(
  msg: Omit<ConversationMessage, 'id' | 'created_at'>
): Promise<ConversationMessage> {
  const db = await getReadyDatabase();
  const id = uuidv4();
  const created_at = Date.now();
  const chunksJson = msg.chunks && msg.chunks.length > 0 ? JSON.stringify(msg.chunks) : null;
  const termsJson = msg.terms && msg.terms.length > 0 ? JSON.stringify(msg.terms) : null;

  await db.runAsync(
    `INSERT INTO conversation_messages (
      id, session_id, sender, spoken_text, translation_tw, translation_vi, translation_en,
      pinyin, natural_tw, natural_pinyin, natural_note, chunks, terms, field, created_at, is_saved
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      msg.session_id,
      msg.sender,
      msg.spoken_text,
      msg.translation_tw,
      msg.translation_vi,
      msg.translation_en,
      msg.pinyin,
      msg.natural_tw ?? null,
      msg.natural_pinyin ?? null,
      msg.natural_note ?? null,
      chunksJson,
      termsJson,
      msg.field ?? null,
      created_at,
      msg.is_saved ?? 0,
    ]
  );

  // Tự động cập nhật phiên đối thoại
  await createOrUpdateConversationSession(msg.session_id, msg.spoken_text);

  return {
    id,
    created_at,
    ...msg,
  };
}

export async function getConversationMessages(sessionId: string): Promise<ConversationMessage[]> {
  const db = await getReadyDatabase();
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM conversation_messages WHERE session_id = ? ORDER BY created_at ASC`,
    [sessionId]
  );
  return rows.map(mapConvRow);
}

export async function toggleSaveConversationMessage(id: string): Promise<boolean> {
  const db = await getReadyDatabase();
  const row = await db.getFirstAsync<{ is_saved: number }>(
    `SELECT is_saved FROM conversation_messages WHERE id = ?`,
    [id]
  );
  const nextVal = row && row.is_saved === 1 ? 0 : 1;
  await db.runAsync(`UPDATE conversation_messages SET is_saved = ? WHERE id = ?`, [nextVal, id]);
  return nextVal === 1;
}

export async function deleteConversationMessage(id: string): Promise<void> {
  const db = await getReadyDatabase();
  await db.runAsync(`DELETE FROM conversation_messages WHERE id = ?`, [id]);
}

export async function clearConversationSession(sessionId: string): Promise<void> {
  const db = await getReadyDatabase();
  await db.runAsync(`DELETE FROM conversation_messages WHERE session_id = ?`, [sessionId]);
  await db.runAsync(`DELETE FROM conversation_sessions WHERE id = ?`, [sessionId]);
}

// ─── Quản lý Phiên đối thoại (Lưu tối đa 5 phiên gần nhất) ─────────

export async function getConversationSessions(): Promise<ConversationSession[]> {
  const db = await getReadyDatabase();
  const rows = await db.getAllAsync<ConversationSession>(
    `SELECT * FROM conversation_sessions ORDER BY updated_at DESC LIMIT 5`
  );
  return rows;
}

export async function createOrUpdateConversationSession(
  sessionId: string,
  previewText?: string
): Promise<void> {
  const db = await getReadyDatabase();
  const now = Date.now();
  const existing = await db.getFirstAsync<{ id: string; turn_count: number }>(
    `SELECT id, turn_count FROM conversation_sessions WHERE id = ?`,
    [sessionId]
  );

  if (existing) {
    await db.runAsync(
      `UPDATE conversation_sessions SET updated_at = ?, turn_count = turn_count + 1 WHERE id = ?`,
      [now, sessionId]
    );
  } else {
    const title = previewText ? previewText.slice(0, 36) : 'Cuộc đối thoại';
    await db.runAsync(
      `INSERT INTO conversation_sessions (id, title, created_at, updated_at, turn_count) VALUES (?, ?, ?, ?, 1)`,
      [sessionId, title, now, now]
    );

    // Tự động giữ tối đa 5 phiên (xóa các phiên cũ hơn thứ 5)
    await pruneConversationSessions();
  }
}

export async function pruneConversationSessions(): Promise<void> {
  const db = await getReadyDatabase();
  const allSessions = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM conversation_sessions ORDER BY updated_at DESC`
  );
  if (allSessions.length > 5) {
    const toDelete = allSessions.slice(5).map((s) => s.id);
    for (const sid of toDelete) {
      await db.runAsync(`DELETE FROM conversation_messages WHERE session_id = ?`, [sid]);
      await db.runAsync(`DELETE FROM conversation_sessions WHERE id = ?`, [sid]);
    }
  }
}

export async function deleteConversationSession(sessionId: string): Promise<void> {
  const db = await getReadyDatabase();
  await db.runAsync(`DELETE FROM conversation_messages WHERE session_id = ?`, [sessionId]);
  await db.runAsync(`DELETE FROM conversation_sessions WHERE id = ?`, [sessionId]);
}

// ─── Phrase Corrections (Người Đài không nói thế này) ───────────

export async function insertPhraseCorrection(
  item: Omit<PhraseCorrection, 'id' | 'created_at'>
): Promise<PhraseCorrection> {
  const db = await getReadyDatabase();
  const id = uuidv4();
  const created_at = Date.now();

  await db.runAsync(
    `INSERT INTO phrase_corrections (id, original_phrase, native_sample, audio_uri, reason, field_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      item.original_phrase.trim(),
      item.native_sample.trim(),
      item.audio_uri ?? null,
      item.reason ?? null,
      item.field_key ?? null,
      created_at,
    ]
  );

  return { id, created_at, ...item };
}

export async function getPhraseCorrections(
  limit: number = 10,
  fieldKey?: string
): Promise<PhraseCorrection[]> {
  const db = await getReadyDatabase();
  if (fieldKey) {
    return await db.getAllAsync<PhraseCorrection>(
      `SELECT * FROM phrase_corrections WHERE field_key = ? OR field_key IS NULL ORDER BY created_at DESC LIMIT ?`,
      [fieldKey, limit]
    );
  }
  return await db.getAllAsync<PhraseCorrection>(
    `SELECT * FROM phrase_corrections ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}

export async function deletePhraseCorrection(id: string): Promise<void> {
  const db = await getReadyDatabase();
  await db.runAsync(`DELETE FROM phrase_corrections WHERE id = ?`, [id]);
}

// ─── Custom Scenarios ───────────────────────────────────────────

export async function insertCustomScenario(
  scenario: Omit<CustomScenario, 'id' | 'created_at'>
): Promise<CustomScenario> {
  const db = await getReadyDatabase();
  const id = uuidv4();
  const created_at = Date.now();
  const turnsJson = JSON.stringify(scenario.turns);

  await db.runAsync(
    `INSERT INTO custom_scenarios (id, title, prompt, topic, turns_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, scenario.title, scenario.prompt, scenario.topic ?? 'custom', turnsJson, created_at]
  );

  return { id, created_at, ...scenario };
}

export async function getCustomScenarios(): Promise<CustomScenario[]> {
  const db = await getReadyDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    title: string;
    prompt: string;
    topic: string;
    turns_json: string;
    created_at: number;
  }>(`SELECT * FROM custom_scenarios ORDER BY created_at DESC`);

  return rows.map((r) => {
    let turns: DialogueTurn[] = [];
    try {
      turns = JSON.parse(r.turns_json);
    } catch {
      turns = [];
    }
    return {
      id: r.id,
      title: r.title,
      prompt: r.prompt,
      topic: r.topic,
      turns,
      created_at: r.created_at,
    };
  });
}

export async function deleteCustomScenario(id: string): Promise<void> {
  const db = await getReadyDatabase();
  await db.runAsync(`DELETE FROM custom_scenarios WHERE id = ?`, [id]);
}

// ─── Offline Phrasebook Tra cứu mờ (0 token, 0ms) ───────────────

export interface OfflineMatchResult {
  tw: string;
  pinyin: string;
  vi: string;
  en: string;
  category: string;
}

export async function findOfflinePhraseFuzzy(
  spokenText: string
): Promise<OfflineMatchResult | null> {
  if (!spokenText || !spokenText.trim()) return null;
  const db = await getReadyDatabase();
  const normalizedSpoken = normalizeSearchText(spokenText);
  if (!normalizedSpoken) return null;

  const spokenWords = normalizedSpoken.split(' ').filter(Boolean);
  // Chỉ khớp offline các mẫu câu chào hỏi ngắn (<= 5 từ), câu hội thoại cụ thể để AI dịch
  if (spokenWords.length > 5) {
    return null;
  }

  // 1. So khớp chính xác hoàn toàn (Exact Match) với normalized_vi
  const exactMatch = await db.getFirstAsync<OfflineMatchResult>(
    `SELECT tw, pinyin, vi, en, category FROM offline_phrases 
     WHERE normalized_vi = ? LIMIT 1;`,
    [normalizedSpoken]
  );
  if (exactMatch) return exactMatch;

  // 2. So khớp mờ có kiểm soát độ dài và khoảng cách Levenshtein
  const allRows = await db.getAllAsync<{
    tw: string;
    pinyin: string;
    vi: string;
    en: string;
    category: string;
    keywords: string;
    normalized_vi: string;
  }>(`SELECT tw, pinyin, vi, en, category, keywords, normalized_vi FROM offline_phrases;`);

  let bestMatch: OfflineMatchResult | null = null;
  let highestScore = 0;

  for (const row of allRows) {
    const targetNorm = row.normalized_vi;
    const targetWords = targetNorm.split(' ').filter(Boolean);

    // Chênh lệch số từ không được vượt quá 1 từ
    const wordDiff = Math.abs(spokenWords.length - targetWords.length);
    if (wordDiff <= 1) {
      const maxLen = Math.max(normalizedSpoken.length, targetNorm.length);
      if (maxLen > 0) {
        const dist = levenshteinDistance(normalizedSpoken, targetNorm);
        const sim = 1 - dist / maxLen;
        // Điểm tương đồng phải rất cao (>= 0.90) để tránh bắt nhầm
        if (sim > highestScore && sim >= 0.90) {
          highestScore = sim;
          bestMatch = {
            tw: row.tw,
            pinyin: row.pinyin,
            vi: row.vi,
            en: row.en,
            category: row.category,
          };
        }
      }
    }

    // Kiểm tra danh sách từ khóa (keywords)
    if (row.keywords) {
      try {
        const kws: string[] = JSON.parse(row.keywords);
        for (const kw of kws) {
          const normKw = normalizeSearchText(kw);
          if (!normKw) continue;
          const kwWords = normKw.split(' ').filter(Boolean);
          // Chỉ so khớp nếu độ dài câu nói xấp xỉ độ dài từ khóa (chênh lệch <= 1 từ)
          if (Math.abs(spokenWords.length - kwWords.length) <= 1) {
            const kwMaxLen = Math.max(normalizedSpoken.length, normKw.length);
            if (kwMaxLen > 0) {
              const kwDist = levenshteinDistance(normalizedSpoken, normKw);
              const kwSim = 1 - kwDist / kwMaxLen;
              if (kwSim > highestScore && kwSim >= 0.90) {
                highestScore = kwSim;
                bestMatch = {
                  tw: row.tw,
                  pinyin: row.pinyin,
                  vi: row.vi,
                  en: row.en,
                  category: row.category,
                };
              }
            }
          }
        }
      } catch {
        // ignore JSON parse error
      }
    }
  }

  return bestMatch;
}

/**
 * So khớp nhanh các câu cửa miệng tiếng Trung Phồn thể của đối tác (0ms, 0 Token)
 * Ví dụ: 好的, 好喔, 沒關係, 不用, 謝謝, 辛苦了, 多少錢, 不好意思, 慢慢來...
 */
export async function findOfflinePhraseChinese(
  spokenChinese: string
): Promise<OfflineMatchResult | null> {
  if (!spokenChinese || !spokenChinese.trim()) return null;
  const db = await getReadyDatabase();
  const cleanedSpoken = cleanChineseText(spokenChinese);
  if (!cleanedSpoken) return null;

  // Nếu câu nói dài hơn 5 ký tự, đây là câu hội thoại cụ thể -> để Gemini dịch chuẩn ngữ cảnh
  if (cleanedSpoken.length > 5) {
    return null;
  }

  const allRows = await db.getAllAsync<{
    tw: string;
    pinyin: string;
    vi: string;
    en: string;
    category: string;
  }>(`SELECT tw, pinyin, vi, en, category FROM offline_phrases;`);

  let bestMatch: OfflineMatchResult | null = null;
  let highestScore = 0;

  for (const row of allRows) {
    const cleanedTarget = cleanChineseText(row.tw);
    if (!cleanedTarget) continue;

    // 1. So khớp chính xác 100%
    if (cleanedSpoken === cleanedTarget) {
      return {
        tw: row.tw,
        pinyin: row.pinyin,
        vi: row.vi,
        en: row.en,
        category: row.category,
      };
    }

    // 2. So khớp mờ: chênh lệch độ dài không quá 1 ký tự (ví dụ: "好的" vs "好喔" hoặc "謝謝" vs "謝謝你")
    const lenDiff = Math.abs(cleanedSpoken.length - cleanedTarget.length);
    if (lenDiff <= 1) {
      const maxLen = Math.max(cleanedSpoken.length, cleanedTarget.length);
      const dist = levenshteinDistance(cleanedSpoken, cleanedTarget);
      const sim = 1 - dist / maxLen;
      if (sim > highestScore && sim >= 0.90) {
        highestScore = sim;
        bestMatch = {
          tw: row.tw,
          pinyin: row.pinyin,
          vi: row.vi,
          en: row.en,
          category: row.category,
        };
      }
    }
  }

  return bestMatch;
}

// ─── Cài đặt Quản lý API Key & Tùy chọn Auto-TTS ────────────────

export async function getSavedApiKeys(): Promise<string[]> {
  const db = await getReadyDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'gemini_keys';`
  );
  if (!row || !row.value) return [];
  return row.value
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

export async function setSavedApiKeys(keys: string[]): Promise<void> {
  const db = await getReadyDatabase();
  const val = keys.map((k) => k.trim()).filter(Boolean).join(',');
  await db.runAsync(
    `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('gemini_keys', ?);`,
    [val]
  );
}

export async function getAutoSpeakSetting(): Promise<boolean> {
  const db = await getReadyDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'auto_speak_enabled';`
  );
  return row ? row.value === '1' : true;
}

export async function setAutoSpeakSetting(enabled: boolean): Promise<void> {
  const db = await getReadyDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('auto_speak_enabled', ?);`,
    [enabled ? '1' : '0']
  );
}

// ─── Notification Settings ─────────────────────────────────────────

export interface NotificationSettings {
  eveningEnabled: boolean; // Nhắc ôn tập buổi tối (20:30)
  streakEnabled: boolean;  // Cảnh báo cứu Streak (21:45)
  morningEnabled: boolean; // Cụm từ buổi sáng (08:15)
}

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const db = await getReadyDatabase();
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    `SELECT key, value FROM app_settings WHERE key IN ('notif_evening_enabled', 'notif_streak_enabled', 'notif_morning_enabled');`
  );
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return {
    eveningEnabled: map.get('notif_evening_enabled') !== '0', // Mặc định: bật
    streakEnabled: map.get('notif_streak_enabled') !== '0',   // Mặc định: bật
    morningEnabled: map.get('notif_morning_enabled') !== '0', // Mặc định: bật
  };
}

export async function setNotificationSettings(
  settings: Partial<NotificationSettings>
): Promise<void> {
  const db = await getReadyDatabase();
  if (settings.eveningEnabled !== undefined) {
    await db.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('notif_evening_enabled', ?);`,
      [settings.eveningEnabled ? '1' : '0']
    );
  }
  if (settings.streakEnabled !== undefined) {
    await db.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('notif_streak_enabled', ?);`,
      [settings.streakEnabled ? '1' : '0']
    );
  }
  if (settings.morningEnabled !== undefined) {
    await db.runAsync(
      `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('notif_morning_enabled', ?);`,
      [settings.morningEnabled ? '1' : '0']
    );
  }
}

export async function hasCompletedQuestToday(): Promise<boolean> {
  const db = await getReadyDatabase();
  const today = getLocalDateString();
  const row = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM app_settings WHERE key = 'last_streak_date';`
  );
  return row?.value === today;
}

export async function getRandomLearnedWord(): Promise<VocabularyItem | null> {
  const db = await getReadyDatabase();
  const row = await db.getFirstAsync<any>(
    `SELECT * FROM vocabulary ORDER BY RANDOM() LIMIT 1;`
  );
  return row ? mapVocabRow(row) : null;
}

// ─── Fuzzy Normalized Cache ─────────────────────────────────────

export async function getFuzzyCache(prefix: string, text: string): Promise<string | null> {
  const norm = normalizeSearchText(text);
  if (!norm) return null;
  const key = `${prefix}_norm_${norm}`;
  return getCache(key);
}

export async function setFuzzyCache(prefix: string, text: string, value: string): Promise<void> {
  const norm = normalizeSearchText(text);
  if (!norm) return;
  const key = `${prefix}_norm_${norm}`;
  return setCache(key, value);
}

/** Dọn sạch các cache đối thoại cũ (đặc biệt là các cache không dấu bị ô nhiễm) để đảm bảo AI dịch chuẩn xác nhất */
export async function purgePollutedConversationCache(): Promise<void> {
  try {
    const db = await getReadyDatabase();
    await db.runAsync(`DELETE FROM ai_cache WHERE key LIKE 'instant_%' OR key LIKE 'conv_%';`);
    console.log('[Cache] 🧹 Đã dọn dẹp các cache hội thoại cũ để đảm bảo AI dịch chuẩn xác');
  } catch (e) {
    console.warn('purgePollutedConversationCache error:', e);
  }
}

// ─── Quản lý Chủ đề người dùng (User Topics) ──────────────────────

export async function getUserTopics(scope?: 'communication' | 'domain'): Promise<Topic[]> {
  const db = await getReadyDatabase();
  let query = `SELECT * FROM user_topics `;

  if (scope === 'domain') {
    // Chỉ trả về các chủ đề thuộc Chuyên ngành (scope = 'domain')
    // Tuyệt đối không trả về các chủ đề mặc định của Giao tiếp
    query += `WHERE scope = 'domain' ORDER BY created_at ASC`;
  } else if (scope === 'communication') {
    // Trả về các chủ đề Giao tiếp (mặc định + do người dùng tạo cho communication)
    query += `WHERE (scope = 'communication' OR is_default = 1) ORDER BY is_default DESC, created_at ASC`;
  } else {
    query += `ORDER BY is_default DESC, created_at ASC`;
  }

  const rows = await db.getAllAsync<any>(query);
  if (!rows || rows.length === 0) {
    if (scope === 'communication' || !scope) {
      registerTopics(DEFAULT_TOPICS);
      return DEFAULT_TOPICS;
    }
    return [];
  }
  const topics: Topic[] = rows.map((r) => ({
    id: r.id,
    key: r.key,
    label: r.label,
    icon: r.icon ?? undefined,
    is_default: r.is_default === 1,
    scope: (r.scope as 'communication' | 'domain') || (r.is_default === 1 ? 'communication' : 'domain'),
  }));
  registerTopics(topics);
  return topics;
}

export async function createUserTopic(
  label: string,
  icon?: string,
  scope: 'communication' | 'domain' = 'communication'
): Promise<Topic> {
  const db = await getReadyDatabase();
  const cleanLabel = label.trim();
  if (!cleanLabel) throw new Error('Tên chủ đề không được để trống');

  // Kiểm tra trùng tên trong cùng scope
  const existing = await db.getFirstAsync<any>(
    `SELECT * FROM user_topics WHERE LOWER(label) = LOWER(?) AND (scope = ? OR (scope IS NULL AND ? = 'communication'));`,
    [cleanLabel, scope, scope]
  );
  if (existing) {
    const existingTopic: Topic = {
      id: existing.id,
      key: existing.key,
      label: existing.label,
      icon: existing.icon ?? undefined,
      is_default: existing.is_default === 1,
      scope: (existing.scope as 'communication' | 'domain') || scope,
    };
    registerTopics([existingTopic]);
    return existingTopic;
  }

  const prefix = scope === 'domain' ? 'ud_' : 'u_';
  const normKey = normalizeSearchText(cleanLabel).replace(/[^a-z0-9]/g, '_').slice(0, 20);
  const key = normKey.length > 0 ? `${prefix}${normKey}_${Date.now().toString(36)}` : `${prefix}topic_${Date.now().toString(36)}`;
  const id = uuidv4();
  const now = Date.now();

  await db.runAsync(
    `INSERT INTO user_topics (id, key, label, icon, is_default, created_at, scope)
     VALUES (?, ?, ?, ?, 0, ?, ?);`,
    [id, key, cleanLabel, icon || null, now, scope]
  );

  const newTopic: Topic = {
    id,
    key,
    label: cleanLabel,
    icon: icon || undefined,
    is_default: false,
    scope,
  };

  registerTopics([newTopic]);
  return newTopic;
}

/** Tự động bảo đảm có chủ đề chuyên ngành tương ứng với tên ngành nghề */
export async function ensureFieldTopic(fieldKey: string, fieldLabel: string): Promise<Topic> {
  const db = await getReadyDatabase();
  const cleanKey = fieldKey.trim().toLowerCase();
  const cleanLabel = fieldLabel.trim();
  const domainTopicKey = cleanKey.startsWith('d_') ? cleanKey : `d_${cleanKey}`;

  // Kiểm tra đã có chủ đề theo key (mới hoặc cũ) hoặc theo tên trong domain chưa
  const existing = await db.getFirstAsync<any>(
    `SELECT * FROM user_topics WHERE (LOWER(key) = LOWER(?) OR LOWER(key) = LOWER(?) OR LOWER(label) = LOWER(?)) AND scope = 'domain';`,
    [domainTopicKey, cleanKey, cleanLabel]
  );

  if (existing) {
    const topic: Topic = {
      id: existing.id,
      key: existing.key,
      label: existing.label,
      icon: existing.icon ?? undefined,
      is_default: false,
      scope: 'domain',
    };
    registerTopics([topic]);
    return topic;
  }

  const id = uuidv4();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO user_topics (id, key, label, icon, is_default, created_at, scope)
     VALUES (?, ?, ?, null, 0, ?, 'domain');`,
    [id, domainTopicKey, cleanLabel, now]
  );

  const newTopic: Topic = {
    id,
    key: domainTopicKey,
    label: cleanLabel,
    is_default: false,
    scope: 'domain',
  };
  registerTopics([newTopic]);
  return newTopic;
}

export async function deleteUserTopic(key: string): Promise<void> {
  const db = await getReadyDatabase();
  // Chuyển toàn bộ từ vựng thuộc chủ đề này về chủ đề mặc định "Khác" ('other')
  await db.runAsync(
    `UPDATE vocabulary SET topic = 'other' WHERE topic = ?;`,
    [key]
  );
  // Chỉ xóa nếu is_default = 0 (bảo vệ các chủ đề mặc định của hệ thống)
  await db.runAsync(
    `DELETE FROM user_topics WHERE key = ? AND is_default = 0;`,
    [key]
  );
  await getUserTopics();
}

export async function updateVocabularyTopic(vocabId: string, topicKey: string): Promise<void> {
  const db = await getReadyDatabase();
  await db.runAsync(
    `UPDATE vocabulary SET topic = ? WHERE id = ?;`,
    [topicKey || 'other', vocabId]
  );
}

export async function updateVocabularyTopicAndScope(
  vocabId: string,
  topicKey: string,
  newScope: 'communication' | 'domain'
): Promise<void> {
  const db = await getReadyDatabase();
  await db.runAsync(
    `UPDATE vocabulary SET topic = ?, scope = ? WHERE id = ?;`,
    [topicKey || (newScope === 'communication' ? 'other' : topicKey), newScope, vocabId]
  );
}

// ─── Quản lý Ngành nghề tự tạo & Ghim yêu thích (Custom & Pinned Fields) ─────

export async function getUserCustomFields(): Promise<Field[]> {
  const raw = await getSetting('user_custom_fields');
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (Array.isArray(list)) {
      setCustomFieldsCache(list);
      return list;
    }
  } catch {
    // ignore
  }
  return [];
}

export async function addUserCustomField(label: string): Promise<Field> {
  const cleanLabel = label.trim();
  if (!cleanLabel) throw new Error('Tên ngành không được để trống');
  const current = await getUserCustomFields();

  // Kiểm tra trùng
  const found = current.find((f) => f.label.toLowerCase() === cleanLabel.toLowerCase());
  if (found) return found;

  const normKey = normalizeSearchText(cleanLabel).replace(/[^a-z0-9]/g, '_').slice(0, 15);
  const key = `cf_${normKey || 'field'}_${Date.now().toString(36)}`;
  const newField: Field = {
    key,
    label: cleanLabel,
    prompt: `${cleanLabel} industry, professional and daily terms in ${cleanLabel}`,
  };

  const updated = [...current, newField];
  await setSetting('user_custom_fields', JSON.stringify(updated));
  setCustomFieldsCache(updated);

  // Tự động tạo chủ đề Chuyên ngành tương ứng
  await ensureFieldTopic(key, cleanLabel);

  return newField;
}

export async function getPinnedFields(): Promise<string[]> {
  const raw = await getSetting('pinned_fields');
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (Array.isArray(list)) return list;
  } catch {
    // ignore
  }
  return [];
}

export async function togglePinField(fieldKey: string): Promise<boolean> {
  const pinned = await getPinnedFields();
  let updated: string[];
  let isPinnedNow = false;

  if (pinned.includes(fieldKey)) {
    updated = pinned.filter((k) => k !== fieldKey);
    isPinnedNow = false;
  } else {
    updated = [fieldKey, ...pinned];
    isPinnedNow = true;
  }

  await setSetting('pinned_fields', JSON.stringify(updated));
  return isPinnedNow;
}


// ─── AI Chat Sessions & Messages ────────────────────────────────

export async function getAiChatSessions(limit = 5): Promise<AiChatSession[]> {
  const db = await getReadyDatabase();
  return await db.getAllAsync<AiChatSession>(
    `SELECT * FROM ai_chat_sessions ORDER BY updated_at DESC LIMIT ?`,
    [limit]
  );
}

export async function createAiChatSession(title: string): Promise<AiChatSession> {
  const db = await getReadyDatabase();
  const id = uuidv4();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO ai_chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    [id, title.trim() || 'Hội thoại mới', now, now]
  );
  // Đảm bảo chỉ giữ tối đa 5 phiên gần nhất
  await pruneAiChatSessions(5);
  return { id, title: title.trim() || 'Hội thoại mới', created_at: now, updated_at: now };
}

export async function updateAiChatSessionTitle(sessionId: string, title: string): Promise<void> {
  const db = await getReadyDatabase();
  await db.runAsync(
    `UPDATE ai_chat_sessions SET title = ?, updated_at = ? WHERE id = ?`,
    [title.trim(), Date.now(), sessionId]
  );
}

export async function touchAiChatSession(sessionId: string): Promise<void> {
  const db = await getReadyDatabase();
  await db.runAsync(
    `UPDATE ai_chat_sessions SET updated_at = ? WHERE id = ?`,
    [Date.now(), sessionId]
  );
}

export async function deleteAiChatSession(sessionId: string): Promise<void> {
  const db = await getReadyDatabase();
  await db.runAsync(`DELETE FROM ai_chat_messages WHERE session_id = ?`, [sessionId]);
  await db.runAsync(`DELETE FROM ai_chat_sessions WHERE id = ?`, [sessionId]);
}

export async function pruneAiChatSessions(keepCount = 5): Promise<void> {
  const db = await getReadyDatabase();
  const sessions = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM ai_chat_sessions ORDER BY updated_at DESC`
  );
  if (sessions.length > keepCount) {
    const toDelete = sessions.slice(keepCount).map((s) => s.id);
    for (const id of toDelete) {
      await db.runAsync(`DELETE FROM ai_chat_messages WHERE session_id = ?`, [id]);
      await db.runAsync(`DELETE FROM ai_chat_sessions WHERE id = ?`, [id]);
    }
  }
}

export async function getAiChatMessages(sessionId: string): Promise<AiChatMessage[]> {
  const db = await getReadyDatabase();
  return await db.getAllAsync<AiChatMessage>(
    `SELECT * FROM ai_chat_messages WHERE session_id = ? ORDER BY created_at ASC`,
    [sessionId]
  );
}

export async function insertAiChatMessage(
  msg: Omit<AiChatMessage, 'id' | 'created_at'>
): Promise<AiChatMessage> {
  const db = await getReadyDatabase();
  const id = uuidv4();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO ai_chat_messages (id, session_id, role, content, tw, pinyin, vi, explanation, metadata, created_at, feedback, feedback_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      msg.session_id,
      msg.role,
      msg.content,
      msg.tw ?? null,
      msg.pinyin ?? null,
      msg.vi ?? null,
      msg.explanation ?? null,
      msg.metadata ?? null,
      now,
      msg.feedback ?? 0,
      msg.feedback_note ?? null,
    ]
  );
  await touchAiChatSession(msg.session_id);
  return {
    id,
    created_at: now,
    ...msg,
  };
}

export async function updateAiChatMessageFeedback(
  messageId: string,
  feedback: number,
  feedbackNote?: string
): Promise<void> {
  const db = await getReadyDatabase();
  await db.runAsync(
    `UPDATE ai_chat_messages SET feedback = ?, feedback_note = ? WHERE id = ?`,
    [feedback, feedbackNote ?? null, messageId]
  );
}

export async function insertAiChatFeedback(
  fb: Omit<AiChatFeedback, 'id' | 'created_at'>
): Promise<void> {
  const db = await getReadyDatabase();
  const id = uuidv4();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO ai_chat_feedback (id, message_id, original_query, bot_response, user_correction, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      fb.message_id,
      fb.original_query,
      fb.bot_response,
      fb.user_correction,
      fb.reason ?? null,
      now,
    ]
  );
}

export async function getRecentAiChatFeedbacks(limit = 5): Promise<AiChatFeedback[]> {
  const db = await getReadyDatabase();
  return await db.getAllAsync<AiChatFeedback>(
    `SELECT * FROM ai_chat_feedback ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}