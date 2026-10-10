import * as SQLite from 'expo-sqlite';
import { OFFLINE_PHRASES } from '../constants/offlinePhrases';
import { DEFAULT_TOPICS } from '../constants/topics';
import { normalizeSearchText } from '../utils/similarity';

let db: SQLite.SQLiteDatabase | null = null;
let initPromise: Promise<void> | null = null;

export function getDatabase(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync('daidai.db');
  }
  return db;
}

export async function initDatabase(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = doInitDatabase();
  return initPromise;
}

async function doInitDatabase(): Promise<void> {
  const database = getDatabase();

  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS vocabulary (
      id TEXT PRIMARY KEY NOT NULL,
      original_term TEXT NOT NULL,
      tw_term TEXT NOT NULL,
      tw_traditional TEXT NOT NULL,
      cn_simplified TEXT,
      pinyin TEXT NOT NULL,
      vi TEXT,
      category TEXT DEFAULT 'general',
      context_sentence TEXT NOT NULL,
      context_note TEXT,
      captured_at INTEGER NOT NULL,
      source TEXT DEFAULT 'voice',
      is_favorite INTEGER DEFAULT 0,
      scope TEXT DEFAULT 'domain',
      kind TEXT DEFAULT 'term',
      topic TEXT,
      chunks TEXT,
      natural_tw TEXT,
      natural_pinyin TEXT,
      natural_note TEXT
    );

    CREATE TABLE IF NOT EXISTS fsrs_state (
      vocab_id TEXT PRIMARY KEY NOT NULL,
      stability REAL DEFAULT 0,
      difficulty REAL DEFAULT 0,
      elapsed_days REAL DEFAULT 0,
      scheduled_days REAL DEFAULT 0,
      reps INTEGER DEFAULT 0,
      lapses INTEGER DEFAULT 0,
      state INTEGER DEFAULT 0,
      last_review INTEGER,
      next_review INTEGER NOT NULL,
      FOREIGN KEY (vocab_id) REFERENCES vocabulary(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS quest_history (
      id TEXT PRIMARY KEY NOT NULL,
      vocab_id TEXT NOT NULL,
      quest_type TEXT NOT NULL,
      answer_given INTEGER,
      correct_index INTEGER,
      is_correct INTEGER NOT NULL,
      time_taken_ms INTEGER,
      completed_at INTEGER NOT NULL,
      FOREIGN KEY (vocab_id) REFERENCES vocabulary(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversation_messages (
      id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      spoken_text TEXT NOT NULL,
      translation_tw TEXT NOT NULL,
      translation_vi TEXT NOT NULL,
      translation_en TEXT NOT NULL,
      pinyin TEXT NOT NULL,
      natural_tw TEXT,
      natural_pinyin TEXT,
      natural_note TEXT,
      chunks TEXT,
      terms TEXT,
      field TEXT,
      created_at INTEGER NOT NULL,
      is_saved INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS conversation_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      turn_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_cache (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS phrase_corrections (
      id TEXT PRIMARY KEY NOT NULL,
      original_phrase TEXT NOT NULL,
      native_sample TEXT NOT NULL,
      audio_uri TEXT,
      reason TEXT,
      field_key TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS custom_scenarios (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      topic TEXT,
      turns_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS offline_phrases (
      id TEXT PRIMARY KEY NOT NULL,
      vi TEXT NOT NULL,
      tw TEXT NOT NULL,
      pinyin TEXT NOT NULL,
      en TEXT,
      category TEXT NOT NULL,
      keywords TEXT,
      normalized_vi TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_topics (
      id TEXT PRIMARY KEY NOT NULL,
      key TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      icon TEXT,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_vocab_captured ON vocabulary(captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_fsrs_next_review ON fsrs_state(next_review ASC);
    CREATE INDEX IF NOT EXISTS idx_ai_cache_created ON ai_cache(created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_conv_session ON conversation_messages(session_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_conv_sessions_updated ON conversation_sessions(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_phrase_corrections_created ON phrase_corrections(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_custom_scenarios_created ON custom_scenarios(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_offline_phrases_norm ON offline_phrases(normalized_vi);
    CREATE INDEX IF NOT EXISTS idx_offline_phrases_cat ON offline_phrases(category);
    CREATE INDEX IF NOT EXISTS idx_user_topics_created ON user_topics(created_at ASC);
  `);

  // Migration an toàn cho DB cũ: kiểm tra và thêm các cột nếu chưa có TRƯỚC KHI tạo index trên cột đó
  try {
    const tableInfo = await database.getAllAsync<{ name: string }>(
      `PRAGMA table_info(vocabulary);`
    );
    const existingCols = new Set(tableInfo.map((col) => col.name));

    if (!existingCols.has('vi')) {
      await database.runAsync(`ALTER TABLE vocabulary ADD COLUMN vi TEXT;`);
    }
    if (!existingCols.has('scope')) {
      await database.runAsync(`ALTER TABLE vocabulary ADD COLUMN scope TEXT DEFAULT 'domain';`);
    }
    if (!existingCols.has('kind')) {
      await database.runAsync(`ALTER TABLE vocabulary ADD COLUMN kind TEXT DEFAULT 'term';`);
    }
    if (!existingCols.has('topic')) {
      await database.runAsync(`ALTER TABLE vocabulary ADD COLUMN topic TEXT;`);
    }
    if (!existingCols.has('chunks')) {
      await database.runAsync(`ALTER TABLE vocabulary ADD COLUMN chunks TEXT;`);
    }
    if (!existingCols.has('natural_tw')) {
      await database.runAsync(`ALTER TABLE vocabulary ADD COLUMN natural_tw TEXT;`);
    }
    if (!existingCols.has('natural_pinyin')) {
      await database.runAsync(`ALTER TABLE vocabulary ADD COLUMN natural_pinyin TEXT;`);
    }
    if (!existingCols.has('natural_note')) {
      await database.runAsync(`ALTER TABLE vocabulary ADD COLUMN natural_note TEXT;`);
    }

    // Đảm bảo dữ liệu cũ không bị NULL ở scope và kind
    await database.runAsync(`UPDATE vocabulary SET scope = 'domain' WHERE scope IS NULL;`);
    await database.runAsync(`UPDATE vocabulary SET kind = 'term' WHERE kind IS NULL;`);

    // TẠO INDEX TRÊN CỘT SCOPE SAU KHI CỘT ĐÃ ĐƯỢC TẠO/MIGRATE
    await database.runAsync(`CREATE INDEX IF NOT EXISTS idx_vocab_scope ON vocabulary(scope);`);
  } catch (err) {
    console.warn('Migration vocabulary columns check error:', err);
  }

  // Migration conversation_messages
  try {
    const convInfo = await database.getAllAsync<{ name: string }>(
      `PRAGMA table_info(conversation_messages);`
    );
    const convCols = new Set(convInfo.map((col) => col.name));
    if (!convCols.has('terms')) {
      await database.runAsync(`ALTER TABLE conversation_messages ADD COLUMN terms TEXT;`);
    }
    if (!convCols.has('field')) {
      await database.runAsync(`ALTER TABLE conversation_messages ADD COLUMN field TEXT;`);
      // Gán các tin nhắn cũ về 'it' để không bị nhảy tên ngành khi đổi ngành
      await database.runAsync(`UPDATE conversation_messages SET field = 'it' WHERE field IS NULL;`);
    }
  } catch (err) {
    console.warn('Migration conversation_messages error:', err);
  }

  // Dọn dẹp cache AI quá hạn 90 ngày và xóa cache đối thoại cũ để đảm bảo AI dịch mới chuẩn xác
  try {
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    await database.runAsync(`DELETE FROM ai_cache WHERE created_at < ?;`, [ninetyDaysAgo]);
    await database.runAsync(`DELETE FROM ai_cache WHERE key LIKE 'instant_%' OR key LIKE 'conv_%';`);
  } catch (err) {
    console.warn('Clean ai_cache error:', err);
  }

  // Insert defaults
  await database.runAsync(
    `INSERT OR IGNORE INTO app_settings (key, value) VALUES ('quest_time', '20:30')`,
  );
  await database.runAsync(
    `INSERT OR IGNORE INTO app_settings (key, value) VALUES ('streak', '0')`,
  );
  await database.runAsync(
    `INSERT OR IGNORE INTO app_settings (key, value) VALUES ('last_streak_date', '')`,
  );
  await database.runAsync(
    `INSERT OR IGNORE INTO app_settings (key, value) VALUES ('onboarding_done', '0')`,
  );
  await database.runAsync(
    `INSERT OR IGNORE INTO app_settings (key, value) VALUES ('auto_speak_enabled', '1')`,
  );
  await database.runAsync(
    `INSERT OR IGNORE INTO app_settings (key, value) VALUES ('gemini_keys', '')`,
  );

  // Khởi tạo các chủ đề mặc định trong bảng user_topics (chủ đề "Khác" là mặc định)
  try {
    for (const t of DEFAULT_TOPICS) {
      await database.runAsync(
        `INSERT OR IGNORE INTO user_topics (id, key, label, icon, is_default, created_at)
         VALUES (?, ?, ?, ?, 1, ?);`,
        [`default_${t.key}`, t.key, t.label, t.icon || null, 1700000000000]
      );
    }
  } catch (err) {
    console.warn('Seed default user_topics error:', err);
  }

  // Khởi tạo & đồng bộ từ điển offline phrases chuẩn Đài Loan
  try {
    for (const phrase of OFFLINE_PHRASES) {
      const norm = normalizeSearchText(phrase.vi);
      await database.runAsync(
        `INSERT OR REPLACE INTO offline_phrases (id, vi, tw, pinyin, en, category, keywords, normalized_vi)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          phrase.id,
          phrase.vi,
          phrase.tw,
          phrase.pinyin,
          phrase.en || null,
          phrase.category,
          JSON.stringify(phrase.keywords || []),
          norm,
        ]
      );
    }
  } catch (err) {
    console.warn('Seed offline_phrases error:', err);
  }

  // Khắc phục dữ liệu FSRS cũ (tránh lỗi FSRSValidationError difficulty: 5, stability: 0)
  await database.runAsync(
    `UPDATE fsrs_state SET difficulty = 0 WHERE state = 0 AND stability = 0;`
  );
}
