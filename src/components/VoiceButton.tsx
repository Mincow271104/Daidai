import React, { useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Animated, Pressable, Easing,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRecorder } from '../hooks/useRecorder';

interface VoiceButtonProps {
  onRecordingComplete: (uri: string, durationMs: number) => void;
  onRecordingStart?: () => void;
  onRecordingCancel?: () => void;
  disabled?: boolean;
}

export function VoiceButton({
  onRecordingComplete,
  onRecordingStart,
  onRecordingCancel,
  disabled,
}: VoiceButtonProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  const startPulse = useCallback(() => {
    pulseAnim.setValue(0);
    pulseLoopRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 900,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoopRef.current.start();
  }, [pulseAnim]);

  const stopPulse = useCallback(() => {
    pulseLoopRef.current?.stop();
    pulseAnim.setValue(0);
  }, [pulseAnim]);

  const {
    isRecording,
    duration,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useRecorder({
    autoStopOnSilence: true,
    silenceTimeoutMs: 1500,
    onAutoStop: ({ uri, durationMs }) => {
      stopPulse();
      if (uri && durationMs >= 500) {
        onRecordingComplete(uri, durationMs);
      }
    },
  });

  // Chạm 1 lần để Bắt đầu / Dừng nói
  const handlePress = useCallback(async () => {
    if (disabled) return;

    if (!isRecording) {
      const ok = await startRecording();
      if (ok) {
        onRecordingStart?.();
        startPulse();
        Animated.sequence([
          Animated.timing(scaleAnim, { toValue: 0.92, duration: 90, useNativeDriver: true }),
          Animated.timing(scaleAnim, { toValue: 1, duration: 110, useNativeDriver: true }),
        ]).start();
      }
    } else {
      stopPulse();
      Animated.sequence([
        Animated.timing(scaleAnim, { toValue: 0.92, duration: 90, useNativeDriver: true }),
        Animated.timing(scaleAnim, { toValue: 1, duration: 110, useNativeDriver: true }),
      ]).start();
      const { uri, durationMs } = await stopRecording();
      if (uri && durationMs >= 500) {
        onRecordingComplete(uri, durationMs);
      }
    }
  }, [disabled, isRecording, startRecording, onRecordingStart, startPulse, scaleAnim, stopPulse, stopRecording, onRecordingComplete]);

  const handleCancel = useCallback(async () => {
    stopPulse();
    await cancelRecording();
    onRecordingCancel?.();
  }, [cancelRecording, onRecordingCancel, stopPulse]);

  const pulseStyle = {
    opacity: pulseAnim.interpolate({
      inputRange: [0, 0.7, 1],
      outputRange: [0.55, 0.25, 0],
    }),
    transform: [
      {
        scale: pulseAnim.interpolate({
          inputRange: [0, 1],
          outputRange: [1, 1.55],
        }),
      },
    ],
  };

  return (
    <View style={styles.container}>
      <View style={styles.wrapper}>
        {/* Hiệu ứng sóng lan tỏa (CHỈ hiển thị khi đang ghi âm) */}
        {isRecording && <Animated.View style={[styles.pulse, pulseStyle]} />}

        <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
          <Pressable
            style={[
              styles.button,
              isRecording ? styles.buttonRecording : styles.buttonIdle,
              disabled && styles.buttonDisabled,
            ]}
            onPress={handlePress}
            disabled={disabled}
            hitSlop={8}
          >
            {/* Chỉ để icon tinh giản, không chèn chữ vào trong nút */}
            <Feather
              name={isRecording ? 'square' : 'mic'}
              size={isRecording ? 36 : 46}
              color="#FFFFFF"
            />
          </Pressable>
        </Animated.View>
      </View>

      {/* Nhãn trạng thái bên dưới nút */}
      {isRecording ? (
        <View style={styles.recordingInfo}>
          <Text style={styles.durationText}>{duration}s</Text>
          <Pressable style={styles.cancelBtn} onPress={handleCancel} hitSlop={10}>
            <Feather name="x-circle" size={15} color="#EF4444" />
            <Text style={styles.cancelBtnText}>✕ Hủy / Nói lại</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.idleHint}>Chạm để nói</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 160,
    height: 160,
  },
  pulse: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: 'rgba(239, 68, 68, 0.35)',
  },
  button: {
    width: 124,
    height: 124,
    borderRadius: 62,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 8,
  },
  buttonIdle: {
    backgroundColor: '#10B981',
    borderWidth: 4,
    borderColor: '#059669',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
  },
  buttonRecording: {
    backgroundColor: '#EF4444',
    borderWidth: 4,
    borderColor: '#B91C1C',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  idleHint: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 12,
    textAlign: 'center',
  },
  recordingInfo: {
    alignItems: 'center',
    marginTop: 10,
    gap: 8,
  },
  durationText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#EF4444',
  },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF2F2',
    borderWidth: 1.5,
    borderColor: '#FECACA',
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 18,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  cancelBtnText: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '700',
  },
});
