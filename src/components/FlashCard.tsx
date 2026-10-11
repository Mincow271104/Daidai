import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { VocabularyItem } from '../types';
import { speakChinese } from '../utils/speak';
import { getTopic } from '../constants/topics';
import { FIELDS } from '../constants/fields';
import { SpeakPractice } from './SpeakPractice';
import { ClickableSentence } from './ClickableSentence';
import { WordContextModal } from './WordContextModal';

interface FlashCardProps {
  item: VocabularyItem;
  compact?: boolean;
  footer?: React.ReactNode;
  onItemUpdated?: () => void;
}

function getCategoryLabel(category?: string): string {
  if (!category || category === 'general') return '';
  if (category === 'context_lookup' || category === 'tra_cuu') return 'Từ tra cứu';
  if (category === 'conversation') return 'Hội thoại';
  const field = FIELDS.find((f) => f.key === category);
  if (field) return field.label;
  return category;
}

export function FlashCard({ item, compact = false, footer, onItemUpdated }: FlashCardProps) {
  const [showSpeakPractice, setShowSpeakPractice] = useState(false);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);

  const handleSpeak = () => {
    speakChinese(item.tw_traditional);
  };

  const handleToggleSpeakPractice = () => {
    Haptics.selectionAsync();
    setShowSpeakPractice((prev) => !prev);
  };

  const isSentence = item.kind === 'sentence';
  const topicInfo = item.topic ? getTopic(item.topic) : null;
  const categoryLabel = getCategoryLabel(item.category);

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      {/* Header dòng phụ (Topic tag hoặc Category tag) */}
      {(topicInfo || categoryLabel) ? (
        <View style={styles.headerRow}>
          {topicInfo ? (
            <View style={styles.topicBadge}>
              <Text style={styles.topicBadgeText}>{topicInfo.label}</Text>
            </View>
          ) : (
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryBadgeText}>{categoryLabel}</Text>
            </View>
          )}
        </View>
      ) : null}

      {/* Chữ Trung Phồn thể kèm nút Loa phát âm (Hỗ trợ chạm/kéo tra từ trong kho) */}
      <View style={styles.twRow}>
        {!compact && item.tw_traditional ? (
          <View style={styles.twClickableBox}>
            <ClickableSentence
              sentence={item.tw_traditional}
              chunks={item.chunks}
              onPressWord={(w) => setSelectedWord(w)}
              textStyle={isSentence ? styles.twSentence : styles.tw}
              highlightColor="#EEF2FF"
            />
          </View>
        ) : (
          <Text style={[styles.tw, isSentence && styles.twSentence, compact && styles.twCompact]}>
            {item.tw_traditional}
          </Text>
        )}
        <Pressable style={styles.speakerBtn} onPress={handleSpeak} hitSlop={12}>
          <Feather name="volume-2" size={17} color="#6366F1" />
          {isSentence && !compact ? (
            <Text style={styles.speakerBtnLabel}>Phát âm</Text>
          ) : null}
        </Pressable>
      </View>

      {/* Pinyin */}
      <Text style={styles.pinyin}>{item.pinyin}</Text>

      {/* Câu tiếng Anh / Thuật ngữ gốc */}
      <Text style={styles.english}>{item.original_term}</Text>

      {/* Nghĩa tiếng Việt */}
      {item.vi ? (
        <Text style={styles.viMeaning}>{item.vi}</Text>
      ) : null}

      {/* Ngữ cảnh cho từ chuyên ngành */}
      {!compact && !isSentence && item.context_sentence ? (
        <View style={styles.context}>
          <Text style={styles.contextText}>"{item.context_sentence}"</Text>
        </View>
      ) : null}

      {/* Công cụ luyện nói (áp dụng cho cả câu và từ tra cứu / thuật ngữ) */}
      {!compact && (
        <View style={styles.sentenceToolsRow}>
          <Pressable
            style={[styles.toolBtn, showSpeakPractice && styles.toolBtnActive]}
            onPress={handleToggleSpeakPractice}
          >
            <Feather
              name="mic"
              size={14}
              color={showSpeakPractice ? '#6366F1' : '#64748B'}
            />
            <Text style={[styles.toolBtnText, showSpeakPractice && styles.toolBtnTextActive]}>
              {showSpeakPractice ? 'Đóng mic' : 'Luyện nói'}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Giao diện Luyện nói tích hợp */}
      {showSpeakPractice && (
        <View style={styles.speakPracticeWrapper}>
          <SpeakPractice
            targetSentence={item.tw_traditional}
            targetPinyin={item.pinyin}
            title={isSentence ? 'Luyện phát âm câu' : 'Luyện phát âm từ'}
            onClose={() => setShowSpeakPractice(false)}
          />
        </View>
      )}

      {footer}

      <WordContextModal
        visible={!!selectedWord}
        word={selectedWord || ''}
        fullSentence={item.tw_traditional}
        scope={item.scope || 'communication'}
        onClose={() => setSelectedWord(null)}
        onWordSaved={() => onItemUpdated?.()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginVertical: 6,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardCompact: { padding: 12, marginHorizontal: 0 },
  headerRow: {
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
  topicBadgeText: {
    color: '#6366F1',
    fontSize: 11,
    fontWeight: '700',
  },
  categoryBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  categoryBadgeText: {
    color: '#475569',
    fontSize: 10,
    fontWeight: '800',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  speakerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: '#EEF2FF',
  },
  speakerBtnLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6366F1',
  },
  twRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  twClickableBox: {
    flex: 1,
    marginRight: 8,
  },
  tw: { flex: 1, color: '#0F172A', fontSize: 28, fontWeight: '800' },
  twSentence: { fontSize: 20, lineHeight: 28 },
  twCompact: { fontSize: 20 },
  pinyin: { color: '#6366F1', fontSize: 13, fontWeight: '600', marginTop: 2 },
  english: { color: '#64748B', fontSize: 13, fontWeight: '600', marginTop: 4 },
  viMeaning: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 4,
  },
  context: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  contextText: { color: '#64748B', fontSize: 12, fontStyle: 'italic', lineHeight: 18 },
  sentenceToolsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  toolBtnActive: {
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
  },
  toolBtnText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
  },
  toolBtnTextActive: {
    color: '#6366F1',
  },
  speakPracticeWrapper: {
    marginTop: 6,
    marginBottom: 4,
  },
});
