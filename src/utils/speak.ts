import * as Speech from 'expo-speech';
import { AudioModule } from 'expo-audio';

let cachedChineseVoice: string | null | undefined = undefined;

async function getBestChineseVoice(): Promise<string | undefined> {
  if (cachedChineseVoice !== undefined) {
    return cachedChineseVoice ?? undefined;
  }

  try {
    const voices = await Speech.getAvailableVoicesAsync();
    // Ưu tiên zh-TW -> zh-HK -> zh-CN -> zh
    const tw = voices.find(
      (v) =>
        v.language?.toLowerCase() === 'zh-tw' ||
        v.language?.toLowerCase() === 'zh_tw'
    );
    if (tw) {
      cachedChineseVoice = tw.identifier;
      return tw.identifier;
    }

    const hk = voices.find(
      (v) =>
        v.language?.toLowerCase() === 'zh-hk' ||
        v.language?.toLowerCase() === 'zh_hk'
    );
    if (hk) {
      cachedChineseVoice = hk.identifier;
      return hk.identifier;
    }

    const genericZh = voices.find((v) =>
      v.language?.toLowerCase().startsWith('zh')
    );
    if (genericZh) {
      cachedChineseVoice = genericZh.identifier;
      return genericZh.identifier;
    }

    cachedChineseVoice = null;
  } catch (e) {
    console.warn('getAvailableVoicesAsync error:', e);
    cachedChineseVoice = null;
  }

  return undefined;
}

/**
 * Phát âm chữ tiếng Trung Phồn thể chuẩn giọng Đài Loan (zh-TW).
 * - Cấu hình AudioSession cho phép phát loa ngoài lớn (loudspeaker) kể cả khi iPhone gạt nút Silent.
 * - Tự động chọn giọng đọc tốt nhất có trên máy.
 */
export async function speakChinese(text: string): Promise<void> {
  if (!text || !text.trim()) return;

  try {
    // Đảm bảo audio session chuyển sang chế độ phát loa ngoài to rõ
    try {
      await AudioModule.setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
    } catch {
      // bỏ qua nếu lỗi
    }

    await Speech.stop();

    const voiceIdentifier = await getBestChineseVoice();
    const options: Speech.SpeechOptions = {
      rate: 0.85,
      pitch: 1.0,
      onError: (err) => console.warn('Speech playback error:', err),
    };

    if (voiceIdentifier) {
      options.voice = voiceIdentifier;
    } else {
      options.language = 'zh-TW';
    }

    Speech.speak(text.trim(), options);
  } catch (err) {
    console.warn('speakChinese error:', err);
  }
}

/**
 * Phát âm tiếng Anh (en-US)
 */
export async function speakEnglish(text: string): Promise<void> {
  if (!text || !text.trim()) return;

  try {
    try {
      await AudioModule.setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
    } catch {
      // bỏ qua
    }

    await Speech.stop();
    Speech.speak(text.trim(), {
      language: 'en-US',
      rate: 0.9,
      onError: (err) => console.warn('Speech English error:', err),
    });
  } catch (err) {
    console.warn('speakEnglish error:', err);
  }
}

/**
 * Dừng phát âm lập tức
 */
export async function stopSpeaking(): Promise<void> {
  try {
    await Speech.stop();
  } catch {
    // bỏ qua
  }
}
