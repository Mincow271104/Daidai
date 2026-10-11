import { getDatabase, initDatabase } from '../database/schema';
import { sendQuotaWarningNotification } from './notifications';

// ─── Hạn mức Gemini Free Tier chính thức từ Google AI Studio ──────────────────
export const GEMINI_RPM_LIMIT = 15; // 15 requests per minute
export const GEMINI_RPD_LIMIT = 1500; // 1,500 requests per day

export interface KeyQuotaInfo {
  key: string;
  rpmUsed: number;
  rpmLimit: number;
  rpmRemaining: number;
  rpdUsed: number;
  rpdLimit: number;
  rpdRemaining: number;
  rpmResetSeconds: number; // Số giây cho đến khi có 1 slot hồi phục (rolling 60s)
  dailyResetTime: string; // Giờ reset theo giờ địa phương (VD: "14:00")
  dailyResetHoursRemaining: number;
  dailyResetMinutesRemaining: number;
  status: 'ready' | 'warning' | 'exhausted_rpm' | 'exhausted_daily';
  statusText: string;
  isCoolingDown: boolean;
}

interface KeyMemoryRecord {
  timestamps: number[]; // Các thời điểm gọi trong 60 giây qua
  dailyCount: number; // Số lượt đã gọi trong ngày Pacific hiện tại
  lastDailyResetDate: string; // Chuỗi YYYY-MM-DD theo giờ Pacific
  exhaustedType: 'rpm' | 'rpd' | null;
  exhaustedUntil: number; // Timestamp kết thúc tạm ngưng
}

// Bộ nhớ đệm theo dõi từng key trong quá trình app đang chạy
const keyRecordsMap = new Map<string, KeyMemoryRecord>();

// Throttle thời gian gửi cảnh báo notification (tránh gửi liên tục mỗi request)
let lastWarningNotificationTime = 0;
const WARNING_COOLDOWN_MS = 5 * 60 * 1000; // 5 phút giữa các lần cảnh báo

/**
 * Lấy ngày theo múi giờ Pacific (America/Los_Angeles) dạng YYYY-MM-DD
 * Google AI Studio đặt mốc reset RPD vào lúc nửa đêm múi giờ Pacific Time (PT).
 */
export function getPacificDateString(date: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Tính toán thời điểm nửa đêm múi giờ Pacific tiếp theo
 * Trả về ngày giờ cụ thể theo múi giờ thiết bị, số giờ và phút còn lại
 */
export function getNextPacificMidnight(): {
  date: Date;
  hoursRemaining: number;
  minutesRemaining: number;
  timeString: string;
} {
  const now = new Date();
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const getPart = (type: string) =>
      parseInt(parts.find((p) => p.type === type)?.value || '0', 10);

    const hour = getPart('hour') % 24;
    const minute = getPart('minute');
    const second = getPart('second');

    // Số giây còn lại cho đến nửa đêm PT (24:00:00)
    const secondsRemaining = 24 * 3600 - (hour * 3600 + minute * 60 + second);
    const nextMidnightMs = now.getTime() + Math.max(0, secondsRemaining) * 1000;
    const nextMidnightDate = new Date(nextMidnightMs);

    const hoursRemaining = Math.floor(secondsRemaining / 3600);
    const minutesRemaining = Math.floor((secondsRemaining % 3600) / 60);

    // Giờ reset hiển thị theo múi giờ thiết bị người dùng (VD ở VN là 14:00)
    const timeString = nextMidnightDate.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    return {
      date: nextMidnightDate,
      hoursRemaining,
      minutesRemaining,
      timeString,
    };
  } catch {
    const fallbackDate = new Date(now.getTime() + 6 * 3600 * 1000);
    return {
      date: fallbackDate,
      hoursRemaining: 6,
      minutesRemaining: 0,
      timeString: '14:00',
    };
  }
}

// ─── Tải & Lưu dữ liệu bền vững (SQLite app_settings) ─────────────────────────

let isLoadedFromDb = false;
let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

async function loadPersistedLedger(): Promise<void> {
  if (isLoadedFromDb) return;
  try {
    await initDatabase();
    const db = getDatabase();
    const row = await db.getFirstAsync<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = 'gemini_quota_ledger';`
    );
    if (row && row.value) {
      const parsed = JSON.parse(row.value);
      const currentPtDate = getPacificDateString();
      if (parsed.pacificDate === currentPtDate && parsed.keys) {
        for (const [key, data] of Object.entries<any>(parsed.keys)) {
          keyRecordsMap.set(key, {
            timestamps: [],
            dailyCount: typeof data.dailyCount === 'number' ? data.dailyCount : 0,
            lastDailyResetDate: currentPtDate,
            exhaustedType: data.exhaustedType ?? null,
            exhaustedUntil: typeof data.exhaustedUntil === 'number' ? data.exhaustedUntil : 0,
          });
        }
      }
    }
    isLoadedFromDb = true;
  } catch (err) {
    console.warn('[QuotaTracker] Lỗi khi nạp dữ liệu quota từ SQLite:', err);
    isLoadedFromDb = true;
  }
}

// Tự động nạp khi khởi động
loadPersistedLedger().catch(() => {});

function scheduleSaveLedger(): void {
  if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(async () => {
    try {
      await initDatabase();
      const db = getDatabase();
      const currentPtDate = getPacificDateString();
      const keysObj: Record<string, any> = {};

      for (const [k, rec] of keyRecordsMap.entries()) {
        keysObj[k] = {
          dailyCount: rec.dailyCount,
          exhaustedType: rec.exhaustedType,
          exhaustedUntil: rec.exhaustedUntil,
        };
      }

      const payload = JSON.stringify({
        pacificDate: currentPtDate,
        keys: keysObj,
      });

      await db.runAsync(
        `INSERT OR REPLACE INTO app_settings (key, value) VALUES ('gemini_quota_ledger', ?);`,
        [payload]
      );
    } catch (err) {
      console.warn('[QuotaTracker] Lỗi khi lưu dữ liệu quota vào SQLite:', err);
    }
  }, 1000);
}

function getOrInitRecord(key: string): KeyMemoryRecord {
  const currentPtDate = getPacificDateString();
  let rec = keyRecordsMap.get(key);
  if (!rec) {
    rec = {
      timestamps: [],
      dailyCount: 0,
      lastDailyResetDate: currentPtDate,
      exhaustedType: null,
      exhaustedUntil: 0,
    };
    keyRecordsMap.set(key, rec);
  } else if (rec.lastDailyResetDate !== currentPtDate) {
    // Đã qua ngày mới theo giờ Pacific -> Reset số lượng gọi trong ngày
    rec.dailyCount = 0;
    rec.lastDailyResetDate = currentPtDate;
    if (rec.exhaustedType === 'rpd') {
      rec.exhaustedType = null;
      rec.exhaustedUntil = 0;
    }
  }
  return rec;
}

// ─── Ghi nhận lượt gọi & Lỗi 429 ──────────────────────────────────────────────

/**
 * Ghi nhận một yêu cầu vừa gửi tới Gemini qua API Key tương ứng
 */
export function recordGeminiRequest(key: string): void {
  if (!key) return;
  const now = Date.now();
  const rec = getOrInitRecord(key);

  // Thêm thời điểm gọi vào mảng rolling 60s
  rec.timestamps.push(now);
  // Lọc chỉ giữ lại trong 60s gần nhất
  rec.timestamps = rec.timestamps.filter((t) => now - t < 60000);

  // Tăng lượt gọi trong ngày
  rec.dailyCount += 1;

  scheduleSaveLedger();
}

/**
 * Ghi nhận khi Google trả mã 429 (RESOURCE_EXHAUSTED) trên một Key
 */
export function recordGemini429(key: string, errorBody?: string): void {
  if (!key) return;
  const now = Date.now();
  const rec = getOrInitRecord(key);

  const errorLower = String(errorBody || '').toLowerCase();
  const isDaily =
    errorLower.includes('requests per day') ||
    errorLower.includes('rpd') ||
    errorLower.includes('day');

  if (isDaily) {
    rec.exhaustedType = 'rpd';
    rec.exhaustedUntil = getNextPacificMidnight().date.getTime();
  } else {
    // Mặc định cho 429 là chạm hạn mức 15 RPM (cần chờ 60s)
    rec.exhaustedType = 'rpm';
    rec.exhaustedUntil = now + 60000;
  }

  scheduleSaveLedger();
}

// ─── Tính toán thông tin Quota & Thời gian hồi ────────────────────────────────

export function getKeyQuotaInfo(key: string): KeyQuotaInfo {
  const now = Date.now();
  const rec = getOrInitRecord(key);

  // 1. Dọn dẹp mảng timestamps trong 60 giây qua
  rec.timestamps = rec.timestamps.filter((t) => now - t < 60000);

  // 2. Kiểm tra nếu đã hết thời gian tạm ngưng 429
  if (rec.exhaustedUntil > 0 && now >= rec.exhaustedUntil) {
    rec.exhaustedType = null;
    rec.exhaustedUntil = 0;
  }

  const rpmUsed = rec.timestamps.length;
  const rpmRemaining = Math.max(0, GEMINI_RPM_LIMIT - rpmUsed);

  const rpdUsed = rec.dailyCount;
  const rpdRemaining = Math.max(0, GEMINI_RPD_LIMIT - rpdUsed);

  const pacificMidnight = getNextPacificMidnight();

  let rpmResetSeconds = 0;
  if (rec.timestamps.length > 0) {
    // Thời gian cho đến khi request cũ nhất trôi ra khỏi cửa sổ 60s
    const oldestTimestamp = rec.timestamps[0];
    const msUntilOldestExpires = oldestTimestamp + 60000 - now;
    rpmResetSeconds = Math.max(0, Math.ceil(msUntilOldestExpires / 1000));
  }

  // Phân loại trạng thái
  let status: KeyQuotaInfo['status'] = 'ready';
  let statusText = 'Khả dụng';
  let isCoolingDown = false;

  if (rec.exhaustedType === 'rpd' || rpdRemaining <= 0) {
    status = 'exhausted_daily';
    statusText = `Hết hạn ngày (hồi ${pacificMidnight.timeString})`;
    isCoolingDown = true;
  } else if (rec.exhaustedType === 'rpm') {
    status = 'exhausted_rpm';
    const cooldownLeft = Math.max(1, Math.ceil((rec.exhaustedUntil - now) / 1000));
    statusText = `Tạm dừng • Hồi sau ${cooldownLeft}s`;
    isCoolingDown = true;
    rpmResetSeconds = cooldownLeft;
  } else if (rpmRemaining === 0) {
    status = 'exhausted_rpm';
    statusText = `Hết lượt phút • Hồi sau ${rpmResetSeconds}s`;
    isCoolingDown = true;
  } else if (rpmRemaining <= 2 || rpdRemaining <= 50) {
    status = 'warning';
    statusText = rpmResetSeconds > 0
      ? `Sắp hết lượt • Hồi 1 lượt sau ${rpmResetSeconds}s`
      : 'Sắp hết hạn mức';
  } else {
    status = 'ready';
    statusText = rpmResetSeconds > 0
      ? `Hồi 1 lượt sau ${rpmResetSeconds}s`
      : 'Sẵn sàng 100%';
  }

  return {
    key,
    rpmUsed,
    rpmLimit: GEMINI_RPM_LIMIT,
    rpmRemaining,
    rpdUsed,
    rpdLimit: GEMINI_RPD_LIMIT,
    rpdRemaining,
    rpmResetSeconds,
    dailyResetTime: pacificMidnight.timeString,
    dailyResetHoursRemaining: pacificMidnight.hoursRemaining,
    dailyResetMinutesRemaining: pacificMidnight.minutesRemaining,
    status,
    statusText,
    isCoolingDown,
  };
}

/**
 * Kiểm tra xem một Key có phải là key hoạt động cuối cùng hay không
 */
export function isLastAvailableKey(key: string, allKeys: string[]): boolean {
  if (allKeys.length <= 1) return true;

  // Lọc các key khác
  const otherKeys = allKeys.filter((k) => k !== key);
  // Nếu tất cả các key khác đều đang trong trạng thái cooling down hoặc exhausted
  const otherAreAllExhausted = otherKeys.every((otherKey) => {
    const info = getKeyQuotaInfo(otherKey);
    return info.isCoolingDown || info.status === 'exhausted_daily';
  });

  if (otherAreAllExhausted) return true;

  // Hoặc nếu đang ở key cuối cùng trong danh sách xoay tua
  const keyIndex = allKeys.indexOf(key);
  return keyIndex === allKeys.length - 1;
}

/**
 * Cảnh báo khi API Key cuối cùng sắp cạn kiệt Quota
 */
export function checkAndNotifyLastKeyQuota(allKeys: string[], activeKey: string): void {
  if (!activeKey || allKeys.length === 0) return;

  const now = Date.now();
  if (now - lastWarningNotificationTime < WARNING_COOLDOWN_MS) {
    return; // Chưa hết thời gian giãn cách cảnh báo (5 phút)
  }

  if (!isLastAvailableKey(activeKey, allKeys)) {
    return; // Vẫn còn các key khác dự phòng đang sẵn sàng
  }

  const quota = getKeyQuotaInfo(activeKey);

  // Trường hợp 1: Chạm 429 hoặc hết hẳn lượt RPM
  if (quota.status === 'exhausted_rpm') {
    lastWarningNotificationTime = now;
    sendQuotaWarningNotification(
      'Hạn mức API Key tạm ngưng',
      `Khóa API cuối cùng của bạn đã chạm giới hạn phút (sẽ hồi phục sau ${quota.rpmResetSeconds}s). Vui lòng thêm API Key dự phòng trong Cài đặt để không bị gián đoạn.`
    ).catch(() => {});
    return;
  }

  // Trường hợp 2: Hết hạn mức ngày (RPD)
  if (quota.status === 'exhausted_daily') {
    lastWarningNotificationTime = now;
    sendQuotaWarningNotification(
      'Hạn mức API Key đã hết',
      `Khóa API cuối cùng đã dùng hết 1.500 lượt hôm nay (hồi phục lúc ${quota.dailyResetTime}). Vui lòng thêm API Key mới trong Cài đặt.`
    ).catch(() => {});
    return;
  }

  // Trường hợp 3: Sắp cạn kiệt (RPM còn <= 2 lượt hoặc RPD còn <= 50 lượt)
  if (quota.rpmRemaining <= 2 || quota.rpdRemaining <= 50) {
    lastWarningNotificationTime = now;
    sendQuotaWarningNotification(
      'Hạn mức API Key sắp hết',
      `Khóa API cuối cùng chỉ còn ${quota.rpmRemaining}/15 lượt trong phút này (${quota.rpdRemaining}/1.500 lượt ngày). Bạn hãy thêm API Key mới để đảm bảo dịch thuật liên tục.`
    ).catch(() => {});
  }
}
