import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { WordContextExplanation } from '../types';
import { explainWordInContext, classifyTopicForContent } from '../services/api';
import { insertVocabulary } from '../database/repository';
import { speakChinese } from '../utils/speak';
import { getTopic } from '../constants/topics';
import { TopicPickerModal } from './TopicPickerModal';

interface WordContextModalProps {
  visible: boolean;
  word: string;
  fullSentence: string;
  fieldKey?: string;
  scope?: 'domain' | 'communication';
  onClose: () => void;
  onWordSaved?: () => void;
}

export function WordContextModal({
  visible,
  word,
  fullSentence,
  fieldKey = 'it',
  scope = 'communication',
  onClose,
  onWordSaved,
}: WordContextModalProps) {
  const [data, setData] = useState<WordContextExplanation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<string>('other');
  const [aiSuggestedTopic, setAiSuggestedTopic] = useState<string>('other');
  const [showTopicPicker, setShowTopicPicker] = useState<boolean>(false);

  useEffect(() => {
    if (visible && word) {
      setIsSaved(false);
      setError(null);
      setData(null);
      setIsLoading(true);
      setSelectedTopic('other');
      setAiSuggestedTopic('other');

      explainWordInContext(word, fullSentence, fieldKey)
        .then((res) => {
          setData(res);
          if (res.is_local) {
            setIsSaved(true);
          }
          // AI tự động phân tích và chọn chủ đề phù hợp nhất từ danh sách chủ đề người dùng
          classifyTopicForContent(word + ' ' + (res?.vi_in_context || ''), fullSentence)
            .then((top) => {
              if (top) {
                setSelectedTopic(top);
                setAiSuggestedTopic(top);
              }
            })
            .catch(() => {});
        })
        .catch((err) => {
          setError(err?.message || 'Không thể tra nghĩa từ này.');
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, [visible, word, fullSentence, fieldKey]);

  const handleDeepAnalyzeAI = async () => {
    if (!word) return;
    setIsLoading(true);
    setError(null);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const res = await explainWordInContext(word, fullSentence, fieldKey, true);
      setData(res);
      setIsSaved(false);

      // Cập nhật lại phân loại chủ đề sau khi AI phân tích sâu
      classifyTopicForContent(word + ' ' + (res?.vi_in_context || ''), fullSentence)
        .then((top) => {
          if (top) {
            setSelectedTopic(top);
            setAiSuggestedTopic(top);
          }
        })
        .catch(() => {});
    } catch (err: any) {
      setError(err?.message || 'Không thể kết nối AI để phân tích sâu.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveToVocab = async () => {
    if (!data || isSaved) return;
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await insertVocabulary({
        original_term: data.en_in_context || word,
        tw_term: data.word,
        tw_traditional: data.word,
        pinyin: data.pinyin,
        vi: data.vi_in_context,
        category: fieldKey || 'tra_cuu',
        context_sentence: fullSentence,
        context_note: `Nghĩa trong câu: ${data.vi_in_context}. Nghĩa chung: ${data.general_meaning}`,
        source: 'selection_lookup',
        scope,
        kind: 'term',
        topic: selectedTopic || 'other',
      });
      setIsSaved(true);
      onWordSaved?.();
    } catch (e: any) {
      console.warn('Save word error:', e);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        {/* Backdrop (chạm vào nền ngoài để đóng) */}
        <Pressable style={styles.backdrop} onPress={onClose} />

        {/* Khung nội dung Bottom Sheet */}
        <View style={styles.sheetContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <Feather name="book-open" size={16} color="#6366F1" />
              <Text style={styles.headerTitle}>Giải nghĩa trong ngữ cảnh</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Feather name="x" size={20} color="#94A3B8" />
            </Pressable>
          </View>

          {isLoading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color="#6366F1" size="small" />
              <Text style={styles.loadingText}>Đang tra cứu theo ngữ cảnh câu...</Text>
            </View>
          ) : error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable style={styles.retryBtn} onPress={handleDeepAnalyzeAI}>
                <Text style={styles.retryBtnText}>Thử lại</Text>
              </Pressable>
            </View>
          ) : data ? (
            <>
              {/* Thân cuộn */}
              <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={true}
                bounces={true}
                keyboardShouldPersistTaps="handled"
              >
                {/* Source Badge (Local-First vs AI) */}
                <View style={styles.sourceBadgeRow}>
                  {data.is_local ? (
                    <View style={styles.localBadge}>
                      <Feather name="database" size={11} color="#059669" />
                      <Text style={styles.localBadgeText}>Đã có trong kho từ (0ms)</Text>
                    </View>
                  ) : (
                    <View style={styles.aiBadge}>
                      <Feather name="cpu" size={11} color="#4F46E5" />
                      <Text style={styles.aiBadgeText}>Phân tích ngữ cảnh AI</Text>
                    </View>
                  )}

                  {data.is_local ? (
                    <Pressable
                      style={styles.deepAiBtn}
                      onPress={handleDeepAnalyzeAI}
                      hitSlop={6}
                    >
                      <Feather name="zap" size={11} color="#6366F1" />
                      <Text style={styles.deepAiBtnText}>Phân tích sâu với AI</Text>
                    </Pressable>
                  ) : null}
                </View>

                {/* Word & Pinyin Banner */}
                <View style={styles.wordBanner}>
                  <View style={styles.wordMainCol}>
                    <Text style={styles.wordTw}>{data.word}</Text>
                    <Text style={styles.wordPinyin}>{data.pinyin}</Text>
                  </View>
                  <Pressable
                    style={styles.speakerBtn}
                    onPress={() => speakChinese(data.word)}
                    hitSlop={8}
                  >
                    <Feather name="volume-2" size={22} color="#6366F1" />
                  </Pressable>
                </View>

                {/* In-Context Meaning Card */}
                <View style={styles.inContextCard}>
                  <View style={styles.badgeRow}>
                    <View style={styles.contextBadge}>
                      <Text style={styles.contextBadgeText}>Nghĩa trong câu này</Text>
                    </View>
                  </View>
                  <Text style={styles.viContextText}>{data.vi_in_context}</Text>
                  {data.en_in_context ? (
                    <Text style={styles.enContextText}>{data.en_in_context}</Text>
                  ) : null}
                </View>

                {/* General Meaning */}
                {data.general_meaning ? (
                  <View style={styles.generalCard}>
                    <Text style={styles.sectionLabel}>Nghĩa thông thường:</Text>
                    <Text style={styles.generalText}>{data.general_meaning}</Text>
                  </View>
                ) : null}

                {/* Example */}
                {data.example_tw ? (
                  <View style={styles.exampleCard}>
                    <View style={styles.exampleHeader}>
                      <Text style={styles.sectionLabel}>Ví dụ thực tế:</Text>
                      <Pressable
                        onPress={() => speakChinese(data.example_tw!)}
                        hitSlop={8}
                      >
                        <Feather name="volume-2" size={16} color="#6366F1" />
                      </Pressable>
                    </View>
                    <Text style={styles.exampleTw}>{data.example_tw}</Text>
                    {data.example_pinyin ? (
                      <Text style={styles.examplePinyin}>{data.example_pinyin}</Text>
                    ) : null}
                    {data.example_vi ? (
                      <Text style={styles.exampleVi}>{data.example_vi}</Text>
                    ) : null}
                  </View>
                ) : null}
              </ScrollView>

              {/* Nút lưu cố định dưới đáy sheet kèm chọn chủ đề */}
              <View style={styles.footer}>
                {!isSaved && (
                  <View style={styles.topicSelectorRow}>
                    <Text style={styles.topicSelectorLabel}>Chủ đề:</Text>
                    <Pressable
                      style={styles.topicSelectorBtn}
                      onPress={() => setShowTopicPicker(true)}
                    >
                      <Feather name="folder" size={13} color="#6366F1" />
                      <Text style={styles.topicSelectorBtnText}>
                        {getTopic(selectedTopic).label}
                      </Text>
                      {selectedTopic === aiSuggestedTopic && selectedTopic !== 'other' && (
                        <View style={styles.aiTagBadgeMini}>
                          <Feather name="zap" size={9} color="#6366F1" />
                          <Text style={styles.aiTagBadgeMiniText}>AI gợi ý</Text>
                        </View>
                      )}
                      <Feather name="chevron-down" size={13} color="#64748B" />
                    </Pressable>
                  </View>
                )}

                <Pressable
                  style={[styles.saveBtn, isSaved && styles.saveBtnSaved]}
                  onPress={handleSaveToVocab}
                  disabled={isSaved}
                >
                  <Feather
                    name={isSaved ? 'check' : 'bookmark'}
                    size={18}
                    color={isSaved ? '#047857' : '#FFFFFF'}
                  />
                  <Text style={[styles.saveBtnText, isSaved && styles.saveBtnTextSaved]}>
                    {isSaved ? 'Đã lưu trong kho từ' : 'Lưu từ / đoạn này vào kho từ'}
                  </Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>

        {/* Modal chọn hoặc tạo chủ đề mới */}
        <TopicPickerModal
          visible={showTopicPicker}
          selectedTopicKey={selectedTopic}
          onSelectTopic={(t) => setSelectedTopic(t)}
          onClose={() => setShowTopicPicker(false)}
          aiSuggestedTopicKey={aiSuggestedTopic}
          title="Chọn chủ đề cho từ này"
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  sheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
  closeBtn: {
    padding: 4,
  },
  sourceBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  localBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  localBadgeText: {
    color: '#059669',
    fontSize: 11,
    fontWeight: '700',
  },
  aiBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  aiBadgeText: {
    color: '#4F46E5',
    fontSize: 11,
    fontWeight: '700',
  },
  deepAiBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  deepAiBtnText: {
    color: '#6366F1',
    fontSize: 11,
    fontWeight: '700',
  },
  loadingBox: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#64748B',
    fontSize: 13,
  },
  errorBox: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 10,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 14,
  },
  retryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#EEF2FF',
    borderRadius: 8,
  },
  retryBtnText: {
    color: '#6366F1',
    fontWeight: '600',
    fontSize: 13,
  },
  scroll: {
    maxHeight: 460,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
  },
  wordBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  wordMainCol: {
    flex: 1,
  },
  wordTw: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1E1B4B',
    letterSpacing: 1,
  },
  wordPinyin: {
    fontSize: 15,
    fontWeight: '600',
    color: '#6366F1',
    marginTop: 4,
  },
  speakerBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  inContextCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  badgeRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  contextBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  contextBadgeText: {
    color: '#065F46',
    fontSize: 11,
    fontWeight: '700',
  },
  viContextText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 4,
  },
  enContextText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#475569',
  },
  generalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  generalText: {
    fontSize: 14,
    color: '#334155',
    lineHeight: 20,
  },
  exampleCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  exampleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  exampleTw: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 2,
  },
  examplePinyin: {
    fontSize: 13,
    color: '#6366F1',
    marginBottom: 4,
  },
  exampleVi: {
    fontSize: 13,
    color: '#475569',
    fontStyle: 'italic',
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 28,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  topicSelectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  topicSelectorLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  topicSelectorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  topicSelectorBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E1B4B',
  },
  aiTagBadgeMini: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  aiTagBadgeMiniText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#6366F1',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366F1',
    borderRadius: 14,
    paddingVertical: 14,
    gap: 8,
  },
  saveBtnSaved: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1.5,
    borderColor: '#10B981',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  saveBtnTextSaved: {
    color: '#047857',
  },
});
