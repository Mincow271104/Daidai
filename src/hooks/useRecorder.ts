import { useRef, useState, useCallback, useEffect } from 'react';
import { Alert } from 'react-native';
import { AudioModule, useAudioRecorder, RecordingPresets } from 'expo-audio';
import * as Haptics from 'expo-haptics';

export interface UseRecorderOptions {
  autoStopOnSilence?: boolean; // Mặc định: true (tự dừng sau 1.5s im lặng)
  silenceTimeoutMs?: number; // Mặc định: 1500ms
  silenceThresholdDb?: number; // Ngưỡng âm thanh phát hiện tiếng nói (dB), mặc định: -38 dB
  onAutoStop?: (result: { uri: string | null; durationMs: number; hasSpoken: boolean }) => void;
}

export interface RecorderHook {
  isRecording: boolean;
  duration: number;
  hasSpoken: boolean;
  startRecording: () => Promise<boolean>;
  stopRecording: () => Promise<{ uri: string | null; durationMs: number; hasSpoken: boolean }>;
  cancelRecording: () => Promise<void>;
}

export function useRecorder(options?: UseRecorderOptions): RecorderHook {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [hasSpoken, setHasSpoken] = useState(false);

  // Cấu hình ghi âm chuẩn HIGH_QUALITY chính thức của Expo Audio (44.1kHz, 128kbps AAC M4A)
  // Tương thích 100% với codec phần cứng mọi dòng máy Android & iOS, âm thanh trung thực
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });

  const startTimeRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const silenceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasSpokenRef = useRef<boolean>(false);
  const lastVoiceTimeRef = useRef<number>(0);
  const isStoppingRef = useRef<boolean>(false);

  const autoStopOnSilence = options?.autoStopOnSilence ?? true;
  const silenceTimeoutMs = options?.silenceTimeoutMs ?? 1500;
  const silenceThresholdDb = options?.silenceThresholdDb ?? -38;

  const onAutoStopRef = useRef(options?.onAutoStop);
  useEffect(() => {
    onAutoStopRef.current = options?.onAutoStop;
  }, [options?.onAutoStop]);

  const clearTimers = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (silenceIntervalRef.current) {
      clearInterval(silenceIntervalRef.current);
      silenceIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  const stopRecordingInternal = useCallback(async (): Promise<{ uri: string | null; durationMs: number; hasSpoken: boolean }> => {
    clearTimers();
    try {
      await recorder.stop();
      const uri = recorder.uri;
      const durationMs = Date.now() - startTimeRef.current;
      const spoken = hasSpokenRef.current;
      setIsRecording(false);
      setDuration(0);
      setHasSpoken(false);
      hasSpokenRef.current = false;
      isStoppingRef.current = false;

      // Trả lại chế độ phát loa ngoài (loudspeaker) cho iOS, tránh bị kẹt ở loa thoại earpiece
      try {
        await AudioModule.setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        });
      } catch {
        // bỏ qua
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return { uri, durationMs, hasSpoken: spoken };
    } catch (err) {
      console.error('Recorder stop error:', err);
      setIsRecording(false);
      setDuration(0);
      setHasSpoken(false);
      hasSpokenRef.current = false;
      isStoppingRef.current = false;
      try {
        await AudioModule.setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        });
      } catch {
        // bỏ qua
      }
      return { uri: null, durationMs: 0, hasSpoken: false };
    }
  }, [clearTimers, recorder]);

  const startRecording = useCallback(async (): Promise<boolean> => {
    if (isRecording || isStoppingRef.current) return false;
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Quyền Microphone',
          'Vui lòng cấp quyền truy cập Microphone trong Cài đặt thiết bị để sử dụng tính năng ghi âm giọng nói.'
        );
        return false;
      }

      await AudioModule.setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      try {
        await recorder.prepareToRecordAsync();
      } catch (prepErr) {
        // Có thể recorder đã được chuẩn bị sẵn, tiếp tục gọi record()
        console.warn('prepareToRecordAsync info:', prepErr);
      }
      recorder.record();

      const now = Date.now();
      startTimeRef.current = now;
      hasSpokenRef.current = false;
      lastVoiceTimeRef.current = 0;
      isStoppingRef.current = false;

      setIsRecording(true);
      setDuration(0);
      setHasSpoken(false);

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

      clearTimers();

      // Đếm giây hiển thị trên giao diện
      timerRef.current = setInterval(() => {
        setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      // Cơ chế phát hiện khoảng lặng (VAD) để tự động dừng sau 1.5s
      if (autoStopOnSilence) {
        silenceIntervalRef.current = setInterval(async () => {
          if (isStoppingRef.current) return;
          try {
            const status = recorder.getStatus();
            if (!status.isRecording) return;

            const metering = status.metering;
            if (typeof metering === 'number') {
              if (metering > silenceThresholdDb) {
                // Đang có âm thanh giọng nói
                if (!hasSpokenRef.current) {
                  hasSpokenRef.current = true;
                  setHasSpoken(true);
                }
                lastVoiceTimeRef.current = Date.now();
              } else if (hasSpokenRef.current) {
                // Người dùng đã nói trước đó, và hiện đang im lặng
                const silenceElapsed = Date.now() - lastVoiceTimeRef.current;
                if (silenceElapsed >= silenceTimeoutMs) {
                  // Đủ 1.5s im lặng -> Tự động dừng và gửi âm thanh đi phân tích
                  isStoppingRef.current = true;
                  clearTimers();
                  const result = await stopRecordingInternal();
                  if (onAutoStopRef.current) {
                    onAutoStopRef.current(result);
                  }
                }
              }
            }
          } catch {
            // bỏ qua
          }
        }, 120);
      }

      return true;
    } catch (err) {
      console.error('Recorder start error:', err);
      setIsRecording(false);
      clearTimers();
      return false;
    }
  }, [
    isRecording,
    recorder,
    clearTimers,
    autoStopOnSilence,
    silenceThresholdDb,
    silenceTimeoutMs,
    stopRecordingInternal,
  ]);

  const stopRecording = useCallback(async (): Promise<{ uri: string | null; durationMs: number; hasSpoken: boolean }> => {
    if (!isRecording || isStoppingRef.current) return { uri: null, durationMs: 0, hasSpoken: false };
    isStoppingRef.current = true;
    return await stopRecordingInternal();
  }, [isRecording, stopRecordingInternal]);

  const cancelRecording = useCallback(async () => {
    clearTimers();
    isStoppingRef.current = false;
    hasSpokenRef.current = false;
    setHasSpoken(false);

    try {
      if (isRecording) {
        await recorder.stop();
      }
    } catch {
      // ignore
    }
    try {
      await AudioModule.setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
    } catch {
      // ignore
    }
    setIsRecording(false);
    setDuration(0);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [clearTimers, isRecording, recorder]);

  return {
    isRecording,
    duration,
    hasSpoken,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
