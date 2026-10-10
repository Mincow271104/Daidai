import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { SituationalPhraseResult } from '../types';
import { generateSituationalPhrases, transcribeSpeech } from '../services/api';
import { insertVocabulary } from '../database/repository';
import { getTopic } from '../constants/topics';
import { speakChinese } from '../utils/speak';
import { useRecorder } from '../hooks/useRecorder';
import { ClickableSentence } from './ClickableSentence';
import { WordContextModal } from './WordContextModal';
import { TopicPickerModal } from './TopicPickerModal';

interface SituationalAssistantModalProps {
  visible: boolean;
  onClose: () => void;
  onSentenceSaved?: () => void;
  initialContext?: string;
}

export function SituationalAssistantModal({
  visible,
  onClose,
  onSentenceSaved,
  initialContext = '',
}: SituationalAssistantModalProps) {
  const [contextInput, setContextInput] = useState(initialContext);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<SituationalPhraseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Trạng thái đã lưu vào kho từ
  const [isSaved, setIsSaved] = useState(false);

  // Tra cứu từ / cụm từ theo ngữ cảnh khi chạm hoặc kéo chọn
  const [lookupTarget, setLookupTarget] = useState<{
    word: string;
    sentence: string;
    topic?: string;
  } | null>(null);

  // Chọn chủ đề cho câu
  const [topicPickerVisible, setTopicPickerVisible] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<string>('other');

  // Ghi âm giọng nói tiếng Việt
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recorder = useRecorder({
    autoStopOnSilence: true,
    silenceTimeoutMs: 1600,
    onAutoStop: async ({ uri }) => {
      if (uri) {
        await handleVoiceTranscribe(uri);
      }
    },
  });

  const handleVoiceTranscribe = async (audioUri: string) => {
    setIsTranscribing(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const res = await transcribeSpeech(audioUri, 'vi');
      const text = res?.text?.trim() || '';
      if (text) {
        setContextInput((prev) => (prev ? `${prev} ${text}` : text));
      }
    } catch (e: any) {
      console.warn('Transcribe error:', e);
    } finally {
      setIsTranscribing(false);
    }
  };

  const toggleRecording = async () => {
    if (recorder.isRecording) {
      const res = await recorder.stopRecording();
      if (res.uri) {
        await handleVoiceTranscribe(res.uri);
      }
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await recorder.startRecording();
    }
  };

  const handleGenerate = async () => {
    const trimmed = contextInput.trim();
    if (!trimmed) {
      Alert.alert('Thông báo', 'Vui lòng nhập hoặc nói ngữ cảnh bạn muốn diễn đạt.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResult(null);
    setIsSaved(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const res = await generateSituationalPhrases(trimmed);
      setResult(res);
      setSelectedTopic(res.suggested_topic || 'other');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setError(err?.message || 'Không thể tạo câu. Vui lòng thử lại.');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async (text: string) => {
    await Clipboard.setStringAsync(text);
    Haptics.selectionAsync();
    Alert.alert('Đã sao chép', text);
  };

  const handleSaveSentence = async () => {
    if (!result || isSaved) return;
    try {
      Haptics.selectionAsync();
      const topicKey = selectedTopic || result.suggested_topic || 'other';

      await insertVocabulary({
        original_term: result.tw,
        tw_term: result.tw,
        tw_traditional: result.tw,
        pinyin: result.pinyin,
        vi: result.vi,
        context_sentence: result.tw,
        context_note: result.cultural_note || 'Diễn đạt chuẩn khẩu ngữ Đài Loan',
        category: 'daily',
        scope: 'communication',
        kind: 'sentence',
        chunks: result.chunks,
        topic: topicKey,
        source: 'situational_ai',
      });

      setIsSaved(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSentenceSaved?.();
    } catch (err: any) {
      Alert.alert('Lỗi lưu câu', err?.message || 'Không thể lưu câu vào kho từ');
    }
  };

  const handlePressWord = (word: string, fullSentence: string) => {
    Haptics.selectionAsync();
    setLookupTarget({
      word,
      sentence: fullSentence,
      topic: selectedTopic || result?.suggested_topic || 'other',
    });
  };

  const handleClose = () => {
    if (recorder.isRecording) {
      recorder.cancelRecording();
    }
    onClose();
  };

  const topicObj = getTopic(selectedTopic || result?.suggested_topic || 'other');

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={handleClose} />

        <View style={styles.sheetContainer}>
          {/* Thanh gạt trên cùng */}
          <View style={styles.handleBar} />

          {/* Header tối giản: Không icon màu, không chữ thừa */}
          <View style={styles.headerRow}>
            <View style={styles.headerLeft}>
              <Feather name="compass" size={18} color="#4F46E5" />
              <Text style={styles.headerTitle}>Diễn đạt theo ngữ cảnh</Text>
            </View>
            <Pressable onPress={handleClose} hitSlop={10} style={styles.closeBtn}>
              <Feather name="x" size={18} color="#64748B" />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scrollBody}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Ô nhập ngữ cảnh duy nhất (Tối giản, không chia 2 ô, không ví dụ dài dòng) */}
            <View style={styles.inputCard}>
              <View style={styles.inputHeaderRow}>
                <Text style={styles.inputLabel}>Ngữ cảnh bạn muốn nói:</Text>
                <Pressable
                  style={[
                    styles.micBtn,
                    recorder.isRecording && styles.micBtnActive,
                  ]}
                  onPress={toggleRecording}
                  hitSlop={6}
                >
                  <Feather
                    name={recorder.isRecording ? 'mic-off' : 'mic'}
                    size={13}
                    color={recorder.isRecording ? '#EF4444' : '#4F46E5'}
                  />
                  <Text
                    style={[
                      styles.micBtnText,
                      recorder.isRecording && styles.micBtnTextActive,
                    ]}
                  >
                    {recorder.isRecording
                      ? `Đang nghe (${recorder.duration}s)...`
                      : 'Nói tiếng Việt'}
                  </Text>
                </Pressable>
              </View>

              <TextInput
                style={styles.contextInput}
                value={contextInput}
                onChangeText={setContextInput}
                placeholder="Mô tả hoàn cảnh hoặc ý bạn muốn diễn đạt..."
                placeholderTextColor="#94A3B8"
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />

              {isTranscribing && (
                <View style={styles.transcribingRow}>
                  <ActivityIndicator size="small" color="#4F46E5" />
                  <Text style={styles.transcribingText}>
                    Đang nhận diện giọng nói...
                  </Text>
                </View>
              )}

              {/* Nút gửi tối giản */}
              <Pressable
                style={[
                  styles.submitBtn,
                  (!contextInput.trim() || isLoading) && styles.submitBtnDisabled,
                ]}
                onPress={handleGenerate}
                disabled={!contextInput.trim() || isLoading}
              >
                {isLoading ? (
                  <>
                    <ActivityIndicator size="small" color="#FFFFFF" />
                    <Text style={styles.submitBtnText}>Đang tạo câu...</Text>
                  </>
                ) : (
                  <>
                    <Feather name="send" size={14} color="#FFFFFF" />
                    <Text style={styles.submitBtnText}>Tạo câu chuẩn Đài Loan</Text>
                  </>
                )}
              </Pressable>
            </View>

            {/* Thông báo lỗi nếu có */}
            {error && (
              <View style={styles.errorBox}>
                <Feather name="alert-circle" size={15} color="#EF4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* KẾT QUẢ: ĐẶT CÂU LÊN TRƯỚC TIÊN - TRỰC QUAN & KHÔNG RỐI MẮT */}
            {result && (
              <View style={styles.resultContainer}>
                {/* 1. THẺ CÂU TIẾNG ĐÀI LOAN BẢN XỨ (ƯU TIÊN HÀNG ĐẦU) */}
                <View style={styles.phraseCard}>
                  <View style={styles.phraseCardHeader}>
                    <View style={styles.nativeBadge}>
                      <Text style={styles.nativeBadgeText}>Chuẩn bản xứ</Text>
                    </View>

                    {/* Chọn chủ đề lưu */}
                    <Pressable
                      style={styles.topicChip}
                      onPress={() => setTopicPickerVisible(true)}
                      hitSlop={6}
                    >
                      <Feather name="folder" size={12} color="#64748B" />
                      <Text style={styles.topicChipText}>{topicObj.label}</Text>
                      <Feather name="chevron-down" size={12} color="#64748B" />
                    </Pressable>
                  </View>

                  {/* Câu Phồn thể hỗ trợ chạm từ / kéo chọn đoạn */}
                  <View style={styles.sentenceBox}>
                    <ClickableSentence
                      sentence={result.tw}
                      chunks={result.chunks}
                      onPressWord={(w) => handlePressWord(w, result.tw)}
                      textStyle={styles.twSentenceText}
                      highlightColor="#EEF2FF"
                    />
                  </View>

                  {/* Pinyin cách chữ rõ ràng */}
                  <Text style={styles.pinyinText}>{result.pinyin}</Text>

                  {/* Nghĩa tiếng Việt */}
                  <Text style={styles.viText}>{result.vi}</Text>

                  {/* Thanh nút thao tác */}
                  <View style={styles.phraseActionsRow}>
                    <Pressable
                      style={styles.actionBtn}
                      onPress={() => speakChinese(result.tw)}
                      hitSlop={8}
                    >
                      <Feather name="volume-2" size={15} color="#4F46E5" />
                      <Text style={styles.actionBtnText}>Phát âm</Text>
                    </Pressable>

                    <Pressable
                      style={styles.actionBtn}
                      onPress={() => handleCopy(result.tw)}
                      hitSlop={8}
                    >
                      <Feather name="copy" size={15} color="#64748B" />
                      <Text style={styles.actionBtnText}>Sao chép</Text>
                    </Pressable>

                    <Pressable
                      style={[
                        styles.actionBtn,
                        styles.saveBtn,
                        isSaved && styles.saveBtnDone,
                      ]}
                      onPress={handleSaveSentence}
                      disabled={isSaved}
                      hitSlop={8}
                    >
                      <Feather
                        name={isSaved ? 'check' : 'bookmark'}
                        size={15}
                        color={isSaved ? '#059669' : '#4F46E5'}
                      />
                      <Text
                        style={[
                          styles.actionBtnText,
                          isSaved && styles.saveBtnDoneText,
                        ]}
                      >
                        {isSaved ? 'Đã lưu kho' : 'Lưu vào kho'}
                      </Text>
                    </Pressable>
                  </View>
                </View>

                {/* 2. GHI CHÚ TƯ DUY & LƯU Ý TRÁNH DỊCH THÔ (TỐI GIẢN, KHÔNG NHỨC ĐẦU) */}
                <View style={styles.notesCard}>
                  {result.cultural_note ? (
                    <View style={styles.noteRow}>
                      <Feather name="info" size={14} color="#475569" style={styles.noteIcon} />
                      <View style={styles.noteContent}>
                        <Text style={styles.noteLabel}>Tư duy người Đài:</Text>
                        <Text style={styles.noteText}>{result.cultural_note}</Text>
                      </View>
                    </View>
                  ) : null}

                  {result.avoid_note ? (
                    <View style={[styles.noteRow, { marginTop: 10 }]}>
                      <Feather name="alert-circle" size={14} color="#64748B" style={styles.noteIcon} />
                      <View style={styles.noteContent}>
                        <Text style={styles.noteLabel}>Tránh nói:</Text>
                        <Text style={styles.noteText}>{result.avoid_note}</Text>
                      </View>
                    </View>
                  ) : null}
                </View>
              </View>
            )}

            <View style={{ height: 28 }} />
          </ScrollView>
        </View>

        {/* Modal Chọn chủ đề kho từ */}
        <TopicPickerModal
          visible={topicPickerVisible}
          selectedTopicKey={selectedTopic}
          onSelectTopic={(topicKey) => {
            setSelectedTopic(topicKey);
            setTopicPickerVisible(false);
          }}
          onClose={() => setTopicPickerVisible(false)}
        />

        {/* Modal tra từ / đoạn ngữ cảnh */}
        {lookupTarget && (
          <WordContextModal
            visible={!!lookupTarget}
            word={lookupTarget.word}
            fullSentence={lookupTarget.sentence}
            fieldKey="daily"
            scope="communication"
            onClose={() => setLookupTarget(null)}
            onWordSaved={onSentenceSaved}
          />
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  sheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
  },
  handleBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E8F0',
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  closeBtn: {
    padding: 4,
  },
  scrollBody: {
    paddingHorizontal: 16,
  },
  scrollContent: {
    paddingTop: 12,
  },
  inputCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  inputHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  micBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  micBtnActive: {
    backgroundColor: '#FEE2E2',
  },
  micBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4F46E5',
  },
  micBtnTextActive: {
    color: '#DC2626',
  },
  contextInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 11,
    fontSize: 14,
    color: '#0F172A',
    lineHeight: 20,
    minHeight: 76,
  },
  transcribingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  transcribingText: {
    fontSize: 12,
    color: '#64748B',
    fontStyle: 'italic',
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#4F46E5',
    borderRadius: 10,
    paddingVertical: 10,
    marginTop: 12,
  },
  submitBtnDisabled: {
    opacity: 0.5,
  },
  submitBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 13,
    flex: 1,
  },
  resultContainer: {
    marginTop: 14,
  },
  phraseCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  phraseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  nativeBadge: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  nativeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4F46E5',
    textTransform: 'uppercase',
  },
  topicChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  topicChipText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '500',
  },
  sentenceBox: {
    marginBottom: 6,
  },
  twSentenceText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 30,
  },
  pinyinText: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 6,
    lineHeight: 18,
  },
  viText: {
    fontSize: 14,
    color: '#334155',
    lineHeight: 20,
    marginBottom: 12,
  },
  phraseActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  actionBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  saveBtn: {
    marginLeft: 'auto',
  },
  saveBtnDone: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  saveBtnDoneText: {
    color: '#059669',
  },
  notesCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    marginTop: 10,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
  },
  noteIcon: {
    marginTop: 2,
  },
  noteContent: {
    flex: 1,
  },
  noteLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 2,
  },
  noteText: {
    fontSize: 13,
    color: '#475569',
    lineHeight: 18,
  },
});
