import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, Pressable, ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { AISentenceItem } from '../types';
import { getTopic } from '../constants/topics';
import { speakChinese } from '../utils/speak';
import { ClickableSentence } from './ClickableSentence';
import { WordContextModal } from './WordContextModal';
import { TopicPickerModal } from './TopicPickerModal';
import { useVocabularyStore } from '../store/vocabularyStore';
import { useScrollLockStore } from '../store/scrollLockStore';

interface ConfirmCardProps {
  items: AISentenceItem[];
  onConfirm: (
    modifiedItems: AISentenceItem[],
    selectedTermKeys: Set<string>,
    saveSentenceIndices: Set<number>
  ) => void;
  onCancel: () => void;
  fieldKey?: string;
}

export function ConfirmCard({ items, onConfirm, onCancel, fieldKey }: ConfirmCardProps) {
  const isScrollLocked = useScrollLockStore((s) => s.isScrollLocked);
  const { loadVocabulary, loadStats } = useVocabularyStore();
  const [activeTopicPickerIndex, setActiveTopicPickerIndex] = useState<number | null>(null);
  const [lookupTarget, setLookupTarget] = useState<{
    word: string;
    sentence: string;
    topic?: string;
  } | null>(null);

  const handlePressWord = (word: string, fullSentence: string, topic?: string) => {
    setLookupTarget({ word, sentence: fullSentence, topic });
  };

  const [editedItems, setEditedItems] = useState<AISentenceItem[]>(() =>
    items.map((it) => ({ ...it, terms: [...it.terms] }))
  );

  // Set chứa index các câu được chọn lưu vào kho giao tiếp (mặc định chọn tất cả)
  const [saveSentenceIndices, setSaveSentenceIndices] = useState<Set<number>>(() => {
    const s = new Set<number>();
    items.forEach((_, idx) => s.add(idx));
    return s;
  });

  // Set chứa các original_term được chọn lưu vào Chuyên ngành (mặc định chọn tất cả)
  const [selectedTerms, setSelectedTerms] = useState<Set<string>>(() => {
    const s = new Set<string>();
    items.forEach((it) => {
      it.terms.forEach((t) => s.add(t.original_term.toLowerCase()));
    });
    return s;
  });

  const handleEditEn = (text: string, index: number) => {
    setEditedItems((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], sentence_en: text };
      return next;
    });
  };

  const handleToggleSaveSentence = (index: number) => {
    Haptics.selectionAsync();
    setSaveSentenceIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleToggleTerm = (origTerm: string) => {
    Haptics.selectionAsync();
    const key = origTerm.toLowerCase();
    setSelectedTerms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onConfirm(editedItems, selectedTerms, saveSentenceIndices);
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Feather name="check-circle" size={18} color="#6366F1" />
          <Text style={styles.headerTitle}>Xác nhận nội dung trước khi lưu</Text>
        </View>
        <Pressable onPress={onCancel} hitSlop={10}>
          <Feather name="x" size={18} color="#94A3B8" />
        </Pressable>
      </View>

      <Text style={styles.headerSubtitle}>
        Kiểm tra câu và chọn thuật ngữ chuyên ngành bạn muốn lưu vào kho:
      </Text>

      <ScrollView
        style={styles.itemsScroll}
        scrollEnabled={!isScrollLocked}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {editedItems.map((item, idx) => {
          const topic = getTopic(item.topic);
          return (
            <View key={idx} style={styles.itemBox}>
              {/* Header câu: Chủ đề + Loa */}
              <View style={styles.itemTopRow}>
                <Pressable
                  style={styles.topicBadgeInteractive}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setActiveTopicPickerIndex(idx);
                  }}
                  hitSlop={6}
                >
                  <Feather name="folder" size={11} color="#6366F1" />
                  <Text style={styles.topicBadgeText}>{topic.label}</Text>
                  <Feather name="chevron-down" size={11} color="#6366F1" />
                </Pressable>
                <Pressable
                  style={styles.speakerBtn}
                  onPress={() => speakChinese(item.sentence_tw)}
                  hitSlop={6}
                >
                  <Feather name="volume-2" size={13} color="#6366F1" />
                  <Text style={styles.speakerBtnText}>Phát âm</Text>
                </Pressable>
              </View>

              {/* Câu Phồn thể (Hỗ trợ chạm từ / kéo đoạn để tra cứu & nghe phát âm) */}
              <View style={styles.sentenceTwBox}>
                <ClickableSentence
                  sentence={item.sentence_tw}
                  chunks={item.chunks}
                  onPressWord={(w) => handlePressWord(w, item.sentence_tw, item.topic)}
                  textStyle={styles.twText}
                  highlightColor="#EEF2FF"
                />
              </View>
              <Text style={styles.pinyinText}>{item.pinyin}</Text>

              {/* Khẩu ngữ tự nhiên bản xứ Đài Loan (nếu có) */}
              {item.natural_tw ? (
                <View style={styles.naturalConfirmBox}>
                  <View style={styles.naturalConfirmTagRow}>
                    <View style={styles.naturalConfirmTagLeft}>
                      <Feather name="zap" size={13} color="#B45309" />
                      <Text style={styles.naturalConfirmTagText}>Khẩu ngữ tự nhiên bản xứ</Text>
                    </View>
                    <Pressable
                      style={styles.naturalSpeakerBtn}
                      onPress={() => speakChinese(item.natural_tw!)}
                      hitSlop={6}
                    >
                      <Feather name="volume-2" size={12} color="#B45309" />
                      <Text style={styles.naturalSpeakerBtnText}>Phát âm</Text>
                    </Pressable>
                  </View>
                  <ClickableSentence
                    sentence={item.natural_tw}
                    onPressWord={(w) => handlePressWord(w, item.natural_tw!, item.topic)}
                    textStyle={styles.naturalConfirmTw}
                    highlightColor="#FEF3C7"
                  />
                  {item.natural_pinyin ? (
                    <Text style={styles.naturalConfirmPinyin}>{item.natural_pinyin}</Text>
                  ) : null}
                  {item.natural_note ? (
                    <Text style={styles.naturalConfirmNote}>💡 {item.natural_note}</Text>
                  ) : null}
                </View>
              ) : null}

              {/* Ô chỉnh sửa câu tiếng Anh */}
              <View style={styles.enInputWrap}>
                <Text style={styles.inputLabel}>Tiếng Anh:</Text>
                <TextInput
                  style={styles.enInput}
                  value={item.sentence_en}
                  onChangeText={(val) => handleEditEn(val, idx)}
                  multiline
                />
              </View>

              {/* Nghĩa tiếng Việt */}
              <Text style={styles.viText}>Tiếng Việt: {item.vi}</Text>

              {/* Tùy chọn lưu cả câu (chỉ hiển thị khi câu có thuật ngữ cần bóc tách) */}
              {item.terms.length > 0 && (
                <Pressable
                  style={[
                    styles.saveSentenceRow,
                    saveSentenceIndices.has(idx) && styles.saveSentenceRowChecked,
                  ]}
                  onPress={() => handleToggleSaveSentence(idx)}
                >
                  <Feather
                    name={saveSentenceIndices.has(idx) ? 'check-square' : 'square'}
                    size={17}
                    color={saveSentenceIndices.has(idx) ? '#6366F1' : '#94A3B8'}
                  />
                  <View style={styles.saveSentenceTextWrap}>
                    <Text
                      style={[
                        styles.saveSentenceText,
                        saveSentenceIndices.has(idx) && styles.saveSentenceTextChecked,
                      ]}
                    >
                      Đồng thời lưu cả câu vào kho giao tiếp
                    </Text>
                    {!saveSentenceIndices.has(idx) && (
                      <Text style={styles.saveSentenceSubText}>
                        (Chỉ trích xuất các thuật ngữ bên dưới vào kho chuyên ngành)
                      </Text>
                    )}
                  </View>
                </Pressable>
              )}

              {/* Danh sách thuật ngữ chuyên ngành phát hiện được */}
              {item.terms.length > 0 && (
                <View style={styles.termsSection}>
                  <Text style={styles.termsLabel}>Thuật ngữ chuyên ngành phát hiện:</Text>
                  {item.terms.map((t, tIdx) => {
                    const isChecked = selectedTerms.has(t.original_term.toLowerCase());
                    return (
                      <Pressable
                        key={tIdx}
                        style={[styles.termRow, isChecked && styles.termRowChecked]}
                        onPress={() => handleToggleTerm(t.original_term)}
                      >
                        <Feather
                          name={isChecked ? 'check-square' : 'square'}
                          size={16}
                          color={isChecked ? '#6366F1' : '#94A3B8'}
                        />
                        <View style={styles.termInfo}>
                          <Text style={styles.termEn}>{t.original_term}</Text>
                          <View style={styles.termTwRow}>
                            <Text style={styles.termTw}>{t.tw_traditional} ({t.pinyin})</Text>
                            <Pressable
                              onPress={(e) => {
                                e.stopPropagation();
                                speakChinese(t.tw_traditional);
                              }}
                              hitSlop={8}
                              style={styles.termSpeakerBtn}
                            >
                              <Feather name="volume-2" size={13} color="#6366F1" />
                            </Pressable>
                          </View>
                          {t.vi ? <Text style={styles.termVi}>{t.vi}</Text> : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Nút bấm hành động */}
      <View style={styles.actionsRow}>
        <Pressable style={styles.cancelBtn} onPress={onCancel}>
          <Text style={styles.cancelBtnText}>Bỏ qua</Text>
        </Pressable>
        <Pressable style={styles.confirmBtn} onPress={handleSave}>
          <Feather name="check" size={16} color="#FFFFFF" />
          <Text style={styles.confirmBtnText}>Lưu vào kho</Text>
        </Pressable>
      </View>

      {/* Modal tra cứu từ ngữ cảnh khi chạm từ hoặc kéo đoạn */}
      <WordContextModal
        visible={!!lookupTarget}
        word={lookupTarget?.word || ''}
        fullSentence={lookupTarget?.sentence || ''}
        fieldKey={lookupTarget?.topic || fieldKey || 'it'}
        scope="communication"
        onClose={() => setLookupTarget(null)}
        onWordSaved={() => {
          loadVocabulary();
          loadStats();
        }}
      />

      {/* Modal chọn hoặc tạo chủ đề cho câu */}
      <TopicPickerModal
        visible={activeTopicPickerIndex !== null}
        selectedTopicKey={
          activeTopicPickerIndex !== null
            ? editedItems[activeTopicPickerIndex]?.topic || 'other'
            : 'other'
        }
        onSelectTopic={(newKey) => {
          if (activeTopicPickerIndex !== null) {
            setEditedItems((prev) => {
              const next = [...prev];
              next[activeTopicPickerIndex] = {
                ...next[activeTopicPickerIndex],
                topic: newKey,
              };
              return next;
            });
          }
        }}
        onClose={() => setActiveTopicPickerIndex(null)}
        aiSuggestedTopicKey={
          activeTopicPickerIndex !== null
            ? items[activeTopicPickerIndex]?.topic || 'other'
            : 'other'
        }
        title="Chọn chủ đề cho câu"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 12,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    maxHeight: 520,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
  },
  headerSubtitle: {
    color: '#64748B',
    fontSize: 12,
    marginBottom: 10,
    lineHeight: 18,
  },
  itemsScroll: {
    maxHeight: 380,
  },
  itemBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  itemTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  topicBadge: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  topicBadgeInteractive: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  topicBadgeText: {
    color: '#6366F1',
    fontSize: 11,
    fontWeight: '700',
  },
  speakerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#EEF2FF',
  },
  speakerBtnText: {
    color: '#6366F1',
    fontSize: 11,
    fontWeight: '700',
  },
  sentenceTwBox: {
    marginVertical: 4,
  },
  twText: {
    color: '#0F172A',
    fontSize: 19,
    fontWeight: '800',
    lineHeight: 26,
  },
  pinyinText: {
    color: '#6366F1',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  naturalConfirmBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  naturalConfirmTagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  naturalConfirmTagLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  naturalConfirmTagText: {
    color: '#B45309',
    fontSize: 11,
    fontWeight: '700',
  },
  naturalSpeakerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  naturalSpeakerBtnText: {
    color: '#B45309',
    fontSize: 11,
    fontWeight: '700',
  },
  naturalConfirmTw: {
    color: '#92400E',
    fontSize: 14,
    fontWeight: '700',
  },
  naturalConfirmPinyin: {
    color: '#B45309',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 1,
    letterSpacing: 0.5,
  },
  naturalConfirmNote: {
    color: '#78350F',
    fontSize: 11,
    marginTop: 2,
  },
  enInputWrap: {
    marginTop: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 8,
  },
  inputLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  enInput: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '600',
    padding: 0,
    lineHeight: 18,
  },
  viText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
  },
  termsSection: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  termsLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  termRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  termRowChecked: {
    borderColor: '#C7D2FE',
    backgroundColor: '#F5F3FF',
  },
  termInfo: {
    flex: 1,
  },
  termEn: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
  },
  termTwRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  termTw: {
    color: '#6366F1',
    fontSize: 12,
    fontWeight: '600',
  },
  termSpeakerBtn: {
    padding: 2,
  },
  termVi: {
    color: '#64748B',
    fontSize: 11,
  },
  saveSentenceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRadius: 6,
  },
  saveSentenceRowChecked: {
    backgroundColor: 'transparent',
  },
  saveSentenceTextWrap: {
    flex: 1,
  },
  saveSentenceText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  saveSentenceTextChecked: {
    color: '#334155',
    fontWeight: '600',
  },
  saveSentenceSubText: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 1,
    fontStyle: 'italic',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
  },
  cancelBtnText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '700',
  },
  confirmBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#6366F1',
    borderRadius: 12,
    paddingVertical: 12,
  },
  confirmBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});
