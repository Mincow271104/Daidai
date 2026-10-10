import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { createAudioPlayer } from 'expo-audio';
import { useRecorder } from '../hooks/useRecorder';
import { transcribeSpeech } from '../services/api';
import { insertPhraseCorrection } from '../database/repository';
import { speakChinese } from '../utils/speak';

interface NativeFeedbackModalProps {
  visible: boolean;
  onClose: () => void;
  originalPhrase: string;
  fieldKey?: string;
  onSaved?: () => void;
}

const REASONS = [
  'Người Đài không nói như vậy',
  'Giống sách vở / quá máy móc',
  'Dùng từ Đại Lục, không chuẩn Phồn thể',
  'Khẩu ngữ thực tế người bản xứ chuộng hơn',
];

export function NativeFeedbackModal({
  visible,
  onClose,
  originalPhrase,
  fieldKey,
  onSaved,
}: NativeFeedbackModalProps) {
  const [nativeSample, setNativeSample] = useState('');
  const [selectedReason, setSelectedReason] = useState(REASONS[0]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordedAudioUri, setRecordedAudioUri] = useState<string | null>(null);

  const recorder = useRecorder();

  useEffect(() => {
    if (visible) {
      setNativeSample('');
      setSelectedReason(REASONS[0]);
      setIsTranscribing(false);
      setRecordedAudioUri(null);
    }
  }, [visible]);

  // ─── Ghi âm giọng mẫu của người Đài ──────────────────────────────

  const handleToggleRecord = async () => {
    if (recorder.isRecording) {
      // Dừng ghi âm và nhận diện
      setIsTranscribing(true);
      try {
        const { uri } = await recorder.stopRecording();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        if (uri) {
          setRecordedAudioUri(uri);
          // Tự động chuyển giọng nói thành chữ bằng Whisper (0 token Gemini)
          const res = await transcribeSpeech(uri, 'zh', fieldKey);
          if (res && res.text) {
            setNativeSample(res.text.trim());
          }
        }
      } catch (err: any) {
        console.warn('stopRecording error:', err);
      } finally {
        setIsTranscribing(false);
      }
    } else {
      // Bắt đầu ghi âm
      setRecordedAudioUri(null);
      await recorder.startRecording();
    }
  };

  const playRecordedAudio = () => {
    if (!recordedAudioUri) return;
    try {
      const player = createAudioPlayer(recordedAudioUri);
      player.play();
    } catch {
      // fallback phát âm bằng giọng đọc
      if (nativeSample) speakChinese(nativeSample);
    }
  };

  // ─── Lưu vào kho luật & phản hồi của người bản xứ ────────────────

  const handleSaveCorrection = async () => {
    const trimmedSample = nativeSample.trim();
    if (!trimmedSample) {
      Alert.alert('Thông báo', 'Vui lòng nhập hoặc ghi âm câu mẫu của người Đài Loan.');
      return;
    }

    try {
      await insertPhraseCorrection({
        original_phrase: originalPhrase.trim(),
        native_sample: trimmedSample,
        audio_uri: recordedAudioUri || undefined,
        reason: selectedReason,
        field_key: fieldKey,
      });

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Đã lưu thành công! 🎉',
        'AI đã ghi nhớ luật này! Các lần dịch và hội thoại tiếp theo sẽ tuyệt đối tránh câu cũ và ưu tiên dùng câu mẫu của người Đài.'
      );
      onSaved?.();
      onClose();
    } catch (err: any) {
      Alert.alert('Lỗi', err.message || 'Không thể lưu phản hồi');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Feather name="flag" size={18} color="#EF4444" />
              <Text style={styles.headerTitle}>Góp ý từ người Đài Loan</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Feather name="x" size={20} color="#64748B" />
            </Pressable>
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
            {/* Câu bị chê */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>CÂU HIỆN TẠI (BỊ NHẬN XÉT CHƯA TỰ NHIÊN):</Text>
              <View style={styles.originalBox}>
                <Text style={styles.originalText}>{originalPhrase}</Text>
                <Pressable
                  style={styles.speakerBtn}
                  onPress={() => speakChinese(originalPhrase)}
                  hitSlop={6}
                >
                  <Feather name="volume-2" size={15} color="#64748B" />
                </Pressable>
              </View>
            </View>

            {/* Lý do nhận xét */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>LÝ DO NGƯỜI ĐÀI GÓP Ý:</Text>
              <View style={styles.reasonsList}>
                {REASONS.map((r, i) => {
                  const isSel = selectedReason === r;
                  return (
                    <Pressable
                      key={i}
                      style={[styles.reasonChip, isSel && styles.reasonChipActive]}
                      onPress={() => setSelectedReason(r)}
                    >
                      <Text style={[styles.reasonChipText, isSel && styles.reasonChipTextActive]}>
                        {r}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Đoạn mẫu của người Đài */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>CÁCH NGƯỜI ĐÀI THỰC TẾ SẼ NÓI (CÂU MẪU):</Text>
              <TextInput
                style={styles.sampleInput}
                value={nativeSample}
                onChangeText={setNativeSample}
                placeholder="Ví dụ: 不好意思，可以幫我結帳嗎？"
                placeholderTextColor="#94A3B8"
                multiline
                numberOfLines={3}
              />
            </View>

            {/* Ghi âm giọng mẫu */}
            <View style={styles.voiceSection}>
              <Text style={styles.voiceSectionLabel}>HOẶC THU ÂM TRỰC TIẾP GIỌNG NGƯỜI ĐÀI:</Text>
              <View style={styles.voiceActionRow}>
                <Pressable
                  style={[styles.recordBtn, recorder.isRecording && styles.recordBtnActive]}
                  onPress={handleToggleRecord}
                >
                  <Feather
                    name={recorder.isRecording ? 'square' : 'mic'}
                    size={16}
                    color="#FFFFFF"
                  />
                  <Text style={styles.recordBtnText}>
                    {recorder.isRecording ? `Dừng (${recorder.duration}s)` : 'Bấm để ghi âm'}
                  </Text>
                </Pressable>

                {recordedAudioUri && !recorder.isRecording && (
                  <Pressable
                    style={styles.playBtn}
                    onPress={playRecordedAudio}
                  >
                    <Feather
                      name="volume-2"
                      size={15}
                      color="#6366F1"
                    />
                    <Text style={styles.playBtnText}>Nghe lại</Text>
                  </Pressable>
                )}
              </View>

              {isTranscribing && (
                <View style={styles.transcribingRow}>
                  <ActivityIndicator size="small" color="#6366F1" />
                  <Text style={styles.transcribingText}>Đang nhận diện giọng nói...</Text>
                </View>
              )}
            </View>

            {/* Nút lưu */}
            <Pressable style={styles.saveSubmitBtn} onPress={handleSaveCorrection}>
              <Feather name="check" size={16} color="#FFFFFF" />
              <Text style={styles.saveSubmitBtnText}>Lưu để AI học & không lặp lại câu cũ</Text>
            </Pressable>

            <View style={{ height: 30 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 16,
    paddingHorizontal: 16,
    maxHeight: '90%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '800',
  },
  body: {
    marginTop: 12,
  },
  section: {
    marginBottom: 16,
  },
  sectionLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  originalBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  originalText: {
    color: '#991B1B',
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    paddingRight: 8,
  },
  speakerBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
  },
  reasonsList: {
    gap: 8,
  },
  reasonChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  reasonChipActive: {
    backgroundColor: '#EEF2FF',
    borderColor: '#6366F1',
  },
  reasonChipText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '600',
  },
  reasonChipTextActive: {
    color: '#6366F1',
    fontWeight: '700',
  },
  sampleInput: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    padding: 12,
    fontSize: 15,
    color: '#0F172A',
    lineHeight: 22,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  voiceSection: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 20,
  },
  voiceSectionLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 10,
  },
  voiceActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  recordBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#6366F1',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  recordBtnActive: {
    backgroundColor: '#DC2626',
  },
  recordBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  playBtnText: {
    color: '#6366F1',
    fontSize: 13,
    fontWeight: '700',
  },
  transcribingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  transcribingText: {
    color: '#6366F1',
    fontSize: 12,
    fontStyle: 'italic',
  },
  saveSubmitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#10B981',
    borderRadius: 14,
    paddingVertical: 14,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  saveSubmitBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});
