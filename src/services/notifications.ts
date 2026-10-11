import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import {
  getNotificationSettings,
  getDueVocabulary,
  getQuestStreak,
  hasCompletedQuestToday,
  getRandomLearnedWord,
} from '../database/repository';

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const { status } = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
    return status === 'granted';
  } catch (err) {
    console.warn('Notification permission error:', err);
    return false;
  }
}

// ─── 1. Nhắc nhở Ôn tập Buổi tối (20:30) ───────────────────────────

export async function scheduleEveningQuest(
  vocabContextPreview?: string
): Promise<string> {
  try {
    const settings = await getNotificationSettings();
    if (!settings.eveningEnabled) {
      await cancelEveningQuest();
      return '';
    }

    await cancelEveningQuest();

    const now = new Date();
    const questTime = new Date();
    questTime.setHours(20, 30, 0, 0);

    // Nếu đã qua 20:30 tối nay -> hẹn vào 20:30 tối mai
    if (now >= questTime) {
      questTime.setDate(questTime.getDate() + 1);
    }

    let contextMsg = '';
    if (vocabContextPreview && vocabContextPreview.trim()) {
      contextMsg = `Hồi chiều sư phụ nói: "${vocabContextPreview.trim()}".`;
    } else {
      // Lấy từ vựng đến hạn cần ôn tập theo thuật toán FSRS
      const dueVocabs = await getDueVocabulary(1);
      if (dueVocabs.length > 0) {
        const item = dueVocabs[0];
        contextMsg = `Thuật ngữ "${item.tw_traditional}" (${item.original_term}) sắp bay màu khỏi đầu DaiDai rồi!`;
      } else {
        contextMsg = 'Sư phụ đã học được nhiều từ hay hôm nay!';
      }
    }

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: '🦜 DaiDai cần cứu nguy!',
        body: `${contextMsg} Não DaiDai đang chập mạch rồi! Mau vào chỉ DaiDai trước khi nó rụng hết lông! 🆘`,
        sound: true,
        data: { type: 'evening_quest' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: questTime,
      },
    });

    return id;
  } catch (err) {
    console.warn('scheduleEveningQuest error:', err);
    return '';
  }
}

export async function cancelEveningQuest(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const questNotifs = scheduled.filter(
      (n) => (n.content.data as any)?.type === 'evening_quest'
    );
    await Promise.all(
      questNotifs.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
    );
  } catch (err) {
    console.warn('cancelEveningQuest error:', err);
  }
}

// ─── 2. Cảnh báo Cứu Streak Khẩn cấp (21:45) ───────────────────────

export async function scheduleStreakSaverAlert(): Promise<string> {
  try {
    const settings = await getNotificationSettings();
    if (!settings.streakEnabled) {
      await cancelStreakSaverAlert();
      return '';
    }

    await cancelStreakSaverAlert();

    // Nếu hôm nay người dùng đã hoàn thành bài tập / giữ streak rồi -> không cần nhắc tối nay!
    const completedToday = await hasCompletedQuestToday();
    const now = new Date();
    const streakTime = new Date();
    streakTime.setHours(21, 45, 0, 0);

    // Nếu đã học hôm nay hoặc đã quá 21:45 -> lên lịch cho 21:45 tối mai
    if (completedToday || now >= streakTime) {
      streakTime.setDate(streakTime.getDate() + 1);
    }

    const currentStreak = await getQuestStreak();
    const bodyMsg =
      currentStreak > 0
        ? `Chỉ còn ít phút nữa là sang ngày mới! Vào làm 1 câu quiz 30 giây để bảo vệ ngọn lửa chuỗi ${currentStreak} ngày của chúng ta nào sư phụ! 🏃‍♂️💨`
        : 'Sắp hết ngày rồi sư phụ ơi! Vào làm 1 câu quiz 30 giây để kích hoạt chuỗi ngày học mới cùng DaiDai nào! 🚀';

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: '🔥 Sư phụ ơi! Cứu Streak gấp!',
        body: bodyMsg,
        sound: true,
        data: { type: 'streak_saver' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: streakTime,
      },
    });

    return id;
  } catch (err) {
    console.warn('scheduleStreakSaverAlert error:', err);
    return '';
  }
}

export async function cancelStreakSaverAlert(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const streakNotifs = scheduled.filter(
      (n) => (n.content.data as any)?.type === 'streak_saver'
    );
    await Promise.all(
      streakNotifs.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
    );
  } catch (err) {
    console.warn('cancelStreakSaverAlert error:', err);
  }
}

// ─── 3. Khẩu ngữ Đi làm Buổi sáng (08:15) ──────────────────────────

export async function scheduleMorningPhrase(): Promise<string> {
  try {
    const settings = await getNotificationSettings();
    if (!settings.morningEnabled) {
      await cancelMorningPhrase();
      return '';
    }

    await cancelMorningPhrase();

    const now = new Date();
    const morningTime = new Date();
    morningTime.setHours(8, 15, 0, 0);

    // Nếu đã qua 08:15 sáng nay -> lên lịch cho 08:15 sáng mai
    if (now >= morningTime) {
      morningTime.setDate(morningTime.getDate() + 1);
    }

    const randomWord = await getRandomLearnedWord();
    let title = '☕ 10 giây khẩu ngữ Đài Loan buổi sáng!';
    let body = '';

    if (randomWord) {
      const meaning = randomWord.vi || randomWord.original_term;
      body = `Hôm nay đi làm nhớ câu: "${randomWord.tw_traditional}" (${randomWord.pinyin}) - nghĩa là: ${meaning}. Bấm để nghe DaiDai đọc nhé! 🦜`;
    } else {
      title = '☕ Chào buổi sáng Sư phụ!';
      body = 'Hôm nay đi làm nhớ câu chào: "大家早，今天辛苦了！" (Chào cả nhà!). Mở app nạp thêm thuật ngữ mới cùng DaiDai nhé! ☀️';
    }

    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        data: { type: 'morning_phrase' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: morningTime,
      },
    });

    return id;
  } catch (err) {
    console.warn('scheduleMorningPhrase error:', err);
    return '';
  }
}

export async function cancelMorningPhrase(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const morningNotifs = scheduled.filter(
      (n) => (n.content.data as any)?.type === 'morning_phrase'
    );
    await Promise.all(
      morningNotifs.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier))
    );
  } catch (err) {
    console.warn('cancelMorningPhrase error:', err);
  }
}

// ─── 4. Kiểm tra Thông báo Ngay (Test Notification) ────────────────

export async function scheduleTestNotification(): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '🦜 DaiDai test thông báo!',
      body: 'Thông báo hoạt động cực kỳ mượt mà rồi Sư phụ ơi! 🎉 Chuẩn bị sẵn sàng cứu não DaiDai nhé! 🆘',
      sound: true,
      data: { type: 'test' },
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 2,
    },
  });
}

// ─── 5. Đồng bộ Tất cả Thông báo Thông minh (Master Sync) ──────────

export async function syncAllSmartNotifications(): Promise<void> {
  try {
    const settings = await getNotificationSettings();
    if (settings.eveningEnabled) {
      await scheduleEveningQuest();
    } else {
      await cancelEveningQuest();
    }

    if (settings.streakEnabled) {
      await scheduleStreakSaverAlert();
    } else {
      await cancelStreakSaverAlert();
    }

    if (settings.morningEnabled) {
      await scheduleMorningPhrase();
    } else {
      await cancelMorningPhrase();
    }
  } catch (err) {
    console.warn('syncAllSmartNotifications error:', err);
  }
}

// ─── 6. Cảnh báo Hạn mức Quota API Key Sắp Hết ─────────────────────

export async function sendQuotaWarningNotification(
  title: string,
  body: string
): Promise<void> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('quota-warnings', {
        name: 'Hạn mức API Key',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
      }).catch(() => {});
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        data: { type: 'quota_warning' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
      },
    });
  } catch (err) {
    console.warn('sendQuotaWarningNotification error:', err);
  }
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

