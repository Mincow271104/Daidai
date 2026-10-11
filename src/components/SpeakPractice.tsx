import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRecorder } from '../hooks/useRecorder';
import { transcribeSpeech } from '../services/api';
import {
  calculateSimilarity,
  SimilarityResult,
  evaluatePronunciationRadar,
  PronunciationRadarResult,
} from '../utils/similarity';
import { alignPinyinWithChinese } from '../utils/pinyin';
import { speakChinese } from '../utils/speak';

interface SpeakPracticeProps {
  targetSentence: string;
  targetPinyin?: string;
  title?: string;
  onClose?: () => void;
}

export function SpeakPractice({ targetSentence, targetPinyin, title, onClose }: SpeakPracticeProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<SimilarityResult | null>(null);
  const [radarResult, setRadarResult] = useState<PronunciationRadarResult | null>(null);
  const [spokenText, setSpokenText] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcribeSource, setTranscribeSource] = useState<'local' | 'gemini' | null>(null);

  // Chuẩn hóa và đồng bộ pinyin từng âm tiết với từng chữ Hán mẫu trước khi đọc
  const previewChars = useMemo(() => {
    return alignPinyinWithChinese(targetSentence, targetPinyin);
  }, [targetSentence, targetPinyin]);

  const handlePlayTarget = () => {
    speakChinese(targetSentence);
  };

  const evaluateAudio = useCallback(async (uri: string, hasSpokenHint?: boolean) => {
    // 1. Kiểm tra phát hiện giọng nói từ microphone VAD metering
    // Nếu mic không ghi nhận âm thanh nào đạt ngưỡng nói (im lặng) -> Báo lỗi 0% ngay lập tức
    if (hasSpokenHint === false) {
      setIsProcessing(false);
      setErrorMessage('Không nhận diện được giọng nói. Bạn chưa phát âm hoặc đọc quá nhỏ, hãy thử lại nhé!');
      setSpokenText('');
      setResult({
        score: 0,
        percentage: 0,
        label: 'Thử lại',
        diffChars: targetSentence.split('').map((char) => ({ char, match: false })),
        cleanedTarget: targetSentence,
        cleanedActual: '',
      });
      setRadarResult({
        score: 0,
        percentage: 0,
        label: 'Cần luyện thêm',
        chars: previewChars.map((item) => ({
          char: item.char,
          pinyin: item.pinyin,
          status: 'error',
        })),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      // 2. Nhận diện nguyên văn âm thanh người dùng nói (không mớm câu mẫu, chống hallucinate 100%)
      const res = await transcribeSpeech(uri, 'zh');

      if (!res || !res.text || !res.text.trim()) {
        setErrorMessage('Không nhận diện được giọng nói. Hãy đọc to, rõ hơn và thử lại nhé!');
        setSpokenText('');
        setResult({
          score: 0,
          percentage: 0,
          label: 'Thử lại',
          diffChars: targetSentence.split('').map((char) => ({ char, match: false })),
          cleanedTarget: targetSentence,
          cleanedActual: '',
        });
        setRadarResult({
          score: 0,
          percentage: 0,
          label: 'Cần luyện thêm',
          chars: previewChars.map((item) => ({
            char: item.char,
            pinyin: item.pinyin,
            status: 'error',
          })),
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } else {
        setTranscribeSource(res.source);
        setSpokenText(res.text);

        // 3. Khảo thí so sánh ngữ âm chính xác (âm tiết + thanh điệu) tại máy (0 token)
        const radar = evaluatePronunciationRadar(targetSentence, res.text, targetPinyin, res.pinyin);
        const sim = calculateSimilarity(targetSentence, res.text);
        // Đồng bộ điểm số và nhãn hiển thị khớp 100% với radar
        sim.score = radar.score;
        sim.percentage = radar.percentage;
        sim.label = radar.percentage >= 85 ? 'Chuẩn' : radar.percentage >= 60 ? 'Gần đúng' : 'Thử lại';

        setResult(sim);
        setRadarResult(radar);

        if (radar.percentage >= 85) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else if (radar.percentage >= 60) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        } else {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
      }
    } catch (e: any) {
      setErrorMessage(e?.message || 'Không thể xử lý âm thanh. Vui lòng thử lại.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsProcessing(false);
    }
  }, [targetSentence, targetPinyin, previewChars]);

  const { isRecording, duration, startRecording, stopRecording, cancelRecording } = useRecorder({
    autoStopOnSilence: true,
    silenceTimeoutMs: 1500,
    onAutoStop: ({ uri, durationMs, hasSpoken }) => {
      if (uri && durationMs >= 500) {
        evaluateAudio(uri, hasSpoken);
      }
    },
  });

  const handleToggleRecord = useCallback(async () => {
    if (isProcessing) return;

    if (!isRecording) {
      setErrorMessage(null);
      setResult(null);
      setRadarResult(null); // Luôn reset kết quả radar cũ khi bắt đầu đọc mới
      setSpokenText('');
      setTranscribeSource(null);
      await startRecording();
    } else {
      const { uri, durationMs, hasSpoken } = await stopRecording();
      if (uri && durationMs >= 500) {
        await evaluateAudio(uri, hasSpoken);
      }
    }
  }, [isProcessing, isRecording, startRecording, stopRecording, evaluateAudio]);

  const handleCancelRecord = useCallback(async () => {
    await cancelRecording();
    setErrorMessage(null);
    setRadarResult(null);
    setResult(null);
  }, [cancelRecording]);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Feather name="mic" size={15} color="#6366F1" />
          <Text style={styles.headerTitle}>{title || 'Luyện phát âm câu'}</Text>
        </View>
        {onClose ? (
          <Pressable onPress={onClose} hitSlop={10}>
            <Feather name="x" size={16} color="#94A3B8" />
          </Pressable>
        ) : null}
      </View>

      {/* Hộp mẫu phát âm & Kết quả radar */}
      <View style={styles.targetBox}>
        <View style={styles.targetHeaderRow}>
          <Text style={styles.targetLabel}>Mẫu phát âm:</Text>
          <Pressable style={styles.speakerBtn} onPress={handlePlayTarget} hitSlop={8}>
            <Feather name="volume-2" size={14} color="#6366F1" />
            <Text style={styles.speakerBtnText}>Nghe mẫu</Text>
          </Pressable>
        </View>

        {/* Trạng thái đang ghi âm */}
        {isRecording ? (
          <View style={styles.recordingLiveIndicator}>
            <View style={styles.recordingPulseDot} />
            <Text style={styles.recordingLiveText}>
              Đang nghe bạn đọc... ({duration}s)
            </Text>
          </View>
        ) : null}

        {/* Radar phát âm từng ký tự sau khi chấm điểm HOẶC Xem trước mẫu phát âm chuẩn */}
        {radarResult && radarResult.chars.length > 0 ? (
          <View style={styles.radarTilesWrap}>
            {radarResult.chars.map((rc, i) => (
              <Pressable
                key={i}
                style={[
                  styles.radarTile,
                  rc.status === 'correct' && styles.radarTileCorrect,
                  rc.status === 'warning' && styles.radarTileWarning,
                  rc.status === 'error' && styles.radarTileError,
                ]}
                onPress={() => {
                  Haptics.selectionAsync();
                  speakChinese(rc.char);
                }}
                hitSlop={4}
              >
                {rc.pinyin ? (
                  <Text
                    style={[
                      styles.radarPinyinText,
                      rc.status === 'correct' && styles.radarPinyinCorrect,
                      rc.status === 'warning' && styles.radarPinyinWarning,
                      rc.status === 'error' && styles.radarPinyinError,
                    ]}
                  >
                    {rc.pinyin}
                  </Text>
                ) : null}
                <Text
                  style={[
                    styles.radarCharText,
                    rc.status === 'correct' && styles.radarCharCorrect,
                    rc.status === 'warning' && styles.radarCharWarning,
                    rc.status === 'error' && styles.radarCharError,
                  ]}
                >
                  {rc.char}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : previewChars.length > 0 ? (
          <View style={styles.radarTilesWrap}>
            {previewChars.map((item, i) => (
              <Pressable
                key={i}
                style={[styles.radarTile, styles.radarTileNeutral]}
                onPress={() => {
                  Haptics.selectionAsync();
                  speakChinese(item.char);
                }}
                hitSlop={4}
              >
                {item.pinyin ? (
                  <Text style={[styles.radarPinyinText, styles.radarPinyinNeutral]}>
                    {item.pinyin}
                  </Text>
                ) : null}
                <Text style={[styles.radarCharText, styles.radarCharNeutral]}>
                  {item.char}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.targetSentenceText}>{targetSentence}</Text>
        )}

        {/* Chú giải Radar màu sắc hoặc Hướng dẫn nghe thử */}
        {radarResult && radarResult.chars.length > 0 ? (
          <View style={styles.radarLegendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#10B981' }]} />
              <Text style={styles.legendText}>Chuẩn</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#F59E0B' }]} />
              <Text style={styles.legendText}>Lệch thanh</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#EF4444' }]} />
              <Text style={styles.legendText}>Sai âm</Text>
            </View>
            <Text style={styles.legendHint}>(Bấm chữ để nghe)</Text>
          </View>
        ) : previewChars.length > 0 ? (
          <View style={styles.previewLegendRow}>
            <Feather name="headphones" size={12} color="#6366F1" />
            <Text style={styles.previewLegendText}>Bấm vào từng chữ để nghe phát âm mẫu</Text>
          </View>
        ) : null}
      </View>

      {/* Kết quả nhận diện & Chấm điểm */}
      {result ? (
        <View style={styles.resultBox}>
          <View style={styles.resultTopRow}>
            <View
              style={[
                styles.badge,
                result.percentage >= 85
                  ? styles.badgeGood
                  : result.percentage >= 60
                  ? styles.badgeMid
                  : styles.badgeLow,
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  result.percentage >= 85
                    ? styles.badgeTextGood
                    : result.percentage >= 60
                    ? styles.badgeTextMid
                    : styles.badgeTextLow,
                ]}
              >
                {result.label} ({result.percentage}%)
              </Text>
            </View>

            {transcribeSource ? (
              <View style={styles.sourceTagRow}>
                <Feather
                  name={transcribeSource === 'local' ? 'cpu' : 'cloud'}
                  size={11}
                  color={transcribeSource === 'local' ? '#10B981' : '#6366F1'}
                />
                <Text
                  style={[
                    styles.sourceTagText,
                    { color: transcribeSource === 'local' ? '#10B981' : '#6366F1' },
                  ]}
                >
                  {transcribeSource === 'local' ? 'GPU' : 'Cloud'}
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.spokenLabel}>
            Máy nghe được: <Text style={styles.spokenText}>"{spokenText || '(Không phát hiện)'}"</Text>
          </Text>
        </View>
      ) : null}

      {/* Thông báo lỗi server */}
      {errorMessage ? (
        <View style={styles.errorBox}>
          <Feather name="info" size={14} color="#D97706" />
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      {/* Nút bấm ghi âm (gọn gàng, vừa vặn không tràn viền) */}
      <View style={styles.actionRow}>
        {isRecording ? (
          <View style={styles.activeRecordingRow}>
            <Pressable
              style={styles.cancelBtn}
              onPress={handleCancelRecord}
              hitSlop={8}
            >
              <Feather name="x" size={14} color="#EF4444" />
              <Text style={styles.cancelBtnText}>Hủy</Text>
            </Pressable>

            <Pressable
              style={styles.recordBtnActive}
              onPress={handleToggleRecord}
              disabled={isProcessing}
            >
              <Feather name="square" size={13} color="#FFFFFF" />
              <Text style={styles.recordBtnText}>
                Xong ({duration}s)
              </Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={[
              styles.recordBtn,
              isProcessing && styles.recordBtnDisabled,
            ]}
            onPress={handleToggleRecord}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Feather name="mic" size={15} color="#FFFFFF" />
            )}
            <Text style={styles.recordBtnText}>
              {isProcessing ? 'Đang so khớp...' : 'Nhấn để đọc'}
            </Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 12,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '800',
  },
  targetBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  targetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  targetLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
  },
  speakerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  speakerBtnText: {
    color: '#6366F1',
    fontSize: 11,
    fontWeight: '700',
  },
  recordingLiveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  recordingPulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
  },
  recordingLiveText: {
    color: '#DC2626',
    fontSize: 12,
    fontWeight: '700',
  },
  targetSentenceText: {
    color: '#0F172A',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0.5,
    paddingVertical: 4,
  },
  radarTilesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginVertical: 4,
  },
  radarTile: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 36,
  },
  radarTileNeutral: {
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
  },
  radarTileCorrect: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
  },
  radarTileWarning: {
    backgroundColor: '#FFFBEB',
    borderColor: '#F59E0B',
  },
  radarTileError: {
    backgroundColor: '#FEF2F2',
    borderColor: '#EF4444',
  },
  radarPinyinText: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 1,
  },
  radarPinyinNeutral: {
    color: '#6366F1',
  },
  radarPinyinCorrect: {
    color: '#059669',
  },
  radarPinyinWarning: {
    color: '#D97706',
  },
  radarPinyinError: {
    color: '#DC2626',
  },
  radarCharText: {
    fontSize: 18,
    fontWeight: '800',
  },
  radarCharNeutral: {
    color: '#0F172A',
  },
  radarCharCorrect: {
    color: '#047857',
  },
  radarCharWarning: {
    color: '#B45309',
  },
  radarCharError: {
    color: '#B91C1C',
  },
  previewLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  previewLegendText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  radarLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  legendText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
  },
  legendHint: {
    fontSize: 10,
    color: '#94A3B8',
    fontStyle: 'italic',
    marginLeft: 'auto',
  },
  resultBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: 8,
  },
  resultTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  sourceTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sourceTagText: {
    fontSize: 11,
    fontWeight: '700',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeGood: {
    backgroundColor: '#ECFDF5',
  },
  badgeMid: {
    backgroundColor: '#FEF3C7',
  },
  badgeLow: {
    backgroundColor: '#FEE2E2',
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '800',
  },
  badgeTextGood: {
    color: '#059669',
  },
  badgeTextMid: {
    color: '#D97706',
  },
  badgeTextLow: {
    color: '#DC2626',
  },
  spokenLabel: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
  },
  spokenText: {
    color: '#1E293B',
    fontStyle: 'italic',
    fontWeight: '700',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFBEB',
    borderRadius: 8,
    padding: 8,
    marginTop: 8,
  },
  errorText: {
    color: '#B45309',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  actionRow: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  activeRecordingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    width: '100%',
  },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  cancelBtnText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '700',
  },
  recordBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#6366F1',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  recordBtnActive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EF4444',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  recordBtnDisabled: {
    opacity: 0.5,
  },
  recordBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
