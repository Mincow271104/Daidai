import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch (err) {
    console.warn('Notification permission error in Expo Go:', err);
    return false;
  }
}


export async function scheduleEveningQuest(
  vocabContextPreview?: string
): Promise<string> {
  try {
    // Cancel existing quest notifications
    await cancelEveningQuest();

    const now = new Date();
    const questTime = new Date();
    questTime.setHours(20, 30, 0, 0);

    // If it's past 20:30 today, schedule for tomorrow
    if (now >= questTime) {
      questTime.setDate(questTime.getDate() + 1);
    }

    const contextMsg = vocabContextPreview
      ? `Hồi chiều sư phụ nói: "${vocabContextPreview}".`
      : 'Sư phụ đã học được từ mới hôm nay!';

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
    console.warn('scheduleEveningQuest error in Expo Go:', err);
    return '';
  }
}

export async function cancelEveningQuest(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const questNotifs = scheduled.filter(
      (n) => (n.content.data as any)?.type === 'evening_quest'
    );
    await Promise.all(questNotifs.map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  } catch (err) {
    console.warn('cancelEveningQuest error:', err);
  }
}


export async function scheduleTestNotification(): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '🦜 DaiDai test thông báo!',
      body: 'Thông báo hoạt động rồi Sư phụ ơi! 🎉',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 3,
    },
  });
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
