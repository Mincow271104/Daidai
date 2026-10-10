import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput,
  Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { Mascot } from '../components/Mascot';
import { VoiceButton } from '../components/VoiceButton';
import { FlashCard } from '../components/FlashCard';
import { ConfirmCard } from '../components/ConfirmCard';
import { ClickableSentence } from '../components/ClickableSentence';
import { WordContextModal } from '../components/WordContextModal';
import { FieldPickerModal } from '../components/FieldPickerModal';
import { ApiKeySettingsModal } from '../components/ApiKeySettingsModal';
import { SituationalAssistantModal } from '../components/SituationalAssistantModal';
import { useMascotStore } from '../store/mascotStore';
import { useVocabularyStore } from '../store/vocabularyStore';
import { useFieldStore } from '../store/fieldStore';
import { useScrollLockStore } from '../store/scrollLockStore';
import { processAudio, analyzeText } from '../services/api';
import { insertVocabulary, termExists } from '../database/repository';
import { scheduleEveningQuest } from '../services/notifications';
import { getRandomPhrase } from '../constants/phrases';
import { getField } from '../constants/fields';
import { speakChinese } from '../utils/speak';
import { AISentenceItem, VocabularyItem } from '../types';

export function HomeScreen() {
  const isScrollLocked = useScrollLockStore((s) => s.isScrollLocked);
  const { state: mascotState, message, setState: setMascotState } = useMascotStore();
  const { vocabulary, loadVocabulary, loadStats } = useVocabularyStore();
  const field = useFieldStore((s) => s.field);
  const [fieldModalVisible, setFieldModalVisible] = useState(false);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [situationalModalVisible, setSituationalModalVisible] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcribedText, setTranscribedText] = useState('');
  const [selectedTranscribedWord, setSelectedTranscribedWord] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState('');
  const [showPasteInput, setShowPasteInput] = useState(false);
  const [pendingItems, setPendingItems] = useState<AISentenceItem[] | null>(null);
  const [newlyAdded, setNewlyAdded] = useState<VocabularyItem[]>([]);
  const [audioSource, setAudioSource] = useState<'local' | 'gemini' | null>(null);

  useEffect(() => {
    loadVocabulary();
    loadStats();
    setMascotState('idle', getRandomPhrase('idle'));
  }, []);

  /** Xử lý lưu các câu và thuật ngữ sau khi người dùng bấm Xác nhận */
  const handleConfirmSave = useCallback(
    async (
      itemsToSave: AISentenceItem[],
      selectedTermKeys: Set<string>,
      saveSentenceIndices?: Set<number>
    ) => {
      const savedItems: VocabularyItem[] = [];
      let savedSentencesCount = 0;
      let savedTermsCount = 0;

      for (let idx = 0; idx < itemsToSave.length; idx++) {
        const item = itemsToSave[idx];
        // 1. Lưu các thuật ngữ chuyên ngành đã được chọn vào tab Chuyên ngành
        for (const term of item.terms) {
          if (!term.original_term || !term.tw_traditional) continue;
          if (!selectedTermKeys.has(term.original_term.toLowerCase())) continue;

          const exists = await termExists(term.original_term, 'term');
          if (!exists) {
            const savedTerm = await insertVocabulary({
              original_term: term.original_term,
              tw_term: term.tw_traditional,
              tw_traditional: term.tw_traditional,
              pinyin: term.pinyin,
              vi: term.vi,
              category: field,
              context_sentence: item.sentence_en,
              scope: 'domain',
              kind: 'term',
              topic: item.topic || 'other',
              source: transcribedText ? 'voice' : 'paste',
            });
            savedItems.push(savedTerm);
            savedTermsCount++;
          }
        }

        // 2. Lưu câu vào tab Communication nếu người dùng chọn lưu cả câu
        const isSentenceSelected = saveSentenceIndices ? saveSentenceIndices.has(idx) : true;

        if (isSentenceSelected) {
          const sentenceExists = await termExists(item.sentence_en, 'sentence');
          if (!sentenceExists) {
            const savedSentence = await insertVocabulary({
              original_term: item.sentence_en,
              tw_term: item.sentence_tw,
              tw_traditional: item.sentence_tw,
              pinyin: item.pinyin,
              vi: item.vi,
              category: field,
              context_sentence: transcribedText || item.sentence_en,
              scope: 'communication',
              kind: 'sentence',
              topic: item.topic,
              chunks: item.chunks,
              source: transcribedText ? 'voice' : 'paste',
            });
            savedItems.push(savedSentence);
            savedSentencesCount++;
          }
        }
      }

      setPendingItems(null);
      setNewlyAdded(savedItems);
      await loadVocabulary();
      await loadStats();

      if (savedItems.length > 0) {
        const previewText = itemsToSave[0]?.sentence_en || '';
        await scheduleEveningQuest(previewText.slice(0, 60));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setMascotState(
          'eureka',
          `Đã lưu ${savedSentencesCount} câu và ${savedTermsCount} thuật ngữ.`
        );
      } else {
        setMascotState('confused', 'Các nội dung này đã có sẵn trong kho.');
      }

      setTranscribedText('');
      setPasteText('');
      setShowPasteInput(false);
      setTimeout(() => setMascotState('idle', getRandomPhrase('idle')), 5000);
    },
    [field, loadVocabulary, loadStats, setMascotState, transcribedText]
  );

  const handleRecordingComplete = useCallback(
    async (uri: string, durationMs: number) => {
      if (durationMs < 500) {
        setMascotState('confused', 'Ngắn quá, sư phụ nói dài hơn chút nhé.');
        return;
      }
      setIsProcessing(true);
      setPendingItems(null);
      setMascotState('processing', getRandomPhrase('processing'));
      try {
        const result = await processAudio(uri, field);
        const spoken = result.transcribed_text?.trim() ?? '';
        setTranscribedText(spoken);
        setAudioSource(result.source ?? null);

        if (result.items && result.items.length > 0) {
          setPendingItems(result.items);
          setMascotState('eureka', 'Đã phân tích xong! Hãy kiểm tra lại câu nhé.');
        } else {
          setMascotState('confused', 'Không nhận diện được câu nào.');
        }
      } catch (err: any) {
        setMascotState('confused', 'Có lỗi xảy ra, thử lại nhé.');
        Alert.alert('Lỗi', err.message);
      } finally {
        setIsProcessing(false);
      }
    },
    [field, setMascotState]
  );

  const handleRecordingStart = useCallback(() => {
    setMascotState('listening', getRandomPhrase('listening'));
    setNewlyAdded([]);
    setPendingItems(null);
    setTranscribedText('');
    setAudioSource(null);
  }, [setMascotState]);

  const handleRecordingCancel = useCallback(() => {
    setMascotState('idle', 'Không sao đâu, nói lại nhé sư phụ! 🦜');
    setTranscribedText('');
    setNewlyAdded([]);
    setPendingItems(null);
    setAudioSource(null);
  }, [setMascotState]);

  const togglePaste = useCallback(async () => {
    const next = !showPasteInput;
    setShowPasteInput(next);
    if (next) {
      try {
        const text = await Clipboard.getStringAsync();
        if (text) setPasteText(text);
      } catch {
        // bỏ qua
      }
    }
  }, [showPasteInput]);

  const handlePasteSubmit = useCallback(async () => {
    const text = pasteText.trim();
    if (!text) return;
    setIsProcessing(true);
    setNewlyAdded([]);
    setPendingItems(null);
    setMascotState('processing', getRandomPhrase('processing'));
    try {
      const result = await analyzeText(text, field);
      if (result.items && result.items.length > 0) {
        setPendingItems(result.items);
        setMascotState('eureka', 'Đã phân tích xong! Hãy kiểm tra lại câu nhé.');
      } else {
        setMascotState('confused', 'Không tách được câu nào từ đoạn văn.');
      }
    } catch (err: any) {
      setMascotState('confused', 'Có lỗi xảy ra, thử lại nhé.');
      Alert.alert('Lỗi', err.message);
    } finally {
      setIsProcessing(false);
    }
  }, [pasteText, field, setMascotState]);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          scrollEnabled={!isScrollLocked}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.screenHeader}>
            <View style={styles.screenHeaderLeft}>
              <Text style={styles.screenTitle}>Học tập</Text>
            </View>
            <View style={styles.headerRightActions}>
              <Pressable
                style={styles.fieldSelectorBtn}
                onPress={() => setFieldModalVisible(true)}
                hitSlop={8}
              >
                <Feather name="briefcase" size={12} color="#6366F1" />
                <Text style={styles.fieldSelectorText} numberOfLines={1}>
                  {getField(field).label}
                </Text>
                <Feather name="chevron-down" size={12} color="#6366F1" />
              </Pressable>
              <Pressable
                style={styles.settingsBtn}
                onPress={() => {
                  Haptics.selectionAsync();
                  setSettingsModalVisible(true);
                }}
                hitSlop={8}
              >
                <Feather name="settings" size={15} color="#475569" />
              </Pressable>
            </View>
          </View>

          <View style={styles.mascotSection}>
            <Mascot state={mascotState} message={message} size={105} />
          </View>

          {transcribedText && !isProcessing ? (
            <View style={styles.transcribedBox}>
              <View style={styles.transcribedHeaderRow}>
                <Text style={styles.transcribedLabel}>Đã nhận diện:</Text>
                {/[\u4e00-\u9fa5]/.test(transcribedText) && (
                  <Pressable
                    onPress={() => speakChinese(transcribedText)}
                    hitSlop={6}
                    style={styles.transcribedSpeakBtn}
                  >
                    <Feather name="volume-2" size={13} color="#6366F1" />
                    <Text style={styles.transcribedSpeakText}>Phát âm</Text>
                  </Pressable>
                )}
              </View>
              {/[\u4e00-\u9fa5]/.test(transcribedText) ? (
                <ClickableSentence
                  sentence={transcribedText}
                  onPressWord={(w) => setSelectedTranscribedWord(w)}
                  textStyle={styles.transcribedText}
                  highlightColor="#EEF2FF"
                />
              ) : (
                <Text style={styles.transcribedText}>"{transcribedText}"</Text>
              )}
            </View>
          ) : null}

          {isProcessing && (
            <View style={styles.processingRow}>
              <ActivityIndicator color="#6366F1" />
              <Text style={styles.processingText}>Đang phân tích...</Text>
            </View>
          )}

          {/* Thẻ xác nhận nội dung trước khi lưu */}
          {pendingItems && pendingItems.length > 0 && (
            <ConfirmCard
              items={pendingItems}
              onConfirm={handleConfirmSave}
              onCancel={() => setPendingItems(null)}
              fieldKey={field}
            />
          )}

          <View style={styles.voiceSection}>
            <VoiceButton
              onRecordingComplete={handleRecordingComplete}
              onRecordingStart={handleRecordingStart}
              onRecordingCancel={handleRecordingCancel}
              disabled={isProcessing}
            />
            {audioSource && !isProcessing && (
              <View style={styles.audioSourceBadge}>
                <Feather
                  name={audioSource === 'local' ? 'cpu' : 'cloud'}
                  size={12}
                  color={audioSource === 'local' ? '#10B981' : '#6366F1'}
                />
                <Text
                  style={[
                    styles.audioSourceText,
                    { color: audioSource === 'local' ? '#10B981' : '#6366F1' },
                  ]}
                >
                  {audioSource === 'local' ? 'Xử lý qua Laptop GPU' : 'Xử lý qua Gemini Cloud'}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.actionsRow}>
            <Pressable
              style={styles.situationalBtn}
              onPress={() => {
                Haptics.selectionAsync();
                setSituationalModalVisible(true);
              }}
            >
              <Feather name="compass" size={15} color="#4F46E5" />
              <Text style={styles.situationalBtnText}>Diễn đạt theo ngữ cảnh</Text>
            </Pressable>

            <Pressable style={styles.pasteToggleBtn} onPress={togglePaste}>
              <Feather name="clipboard" size={14} color="#64748B" />
              <Text style={styles.pasteToggleBtnText}>Dán văn bản</Text>
            </Pressable>
          </View>

          {showPasteInput && (
            <View style={styles.pasteContainer}>
              <TextInput
                style={styles.pasteInput}
                value={pasteText}
                onChangeText={setPasteText}
                placeholder="Dán câu tiếng Việt, tiếng Anh hoặc tiếng Trung..."
                placeholderTextColor="#94A3B8"
                multiline
              />
              <Pressable
                style={[styles.pasteSubmitBtn, (!pasteText.trim() || isProcessing) && styles.pasteSubmitBtnDisabled]}
                onPress={handlePasteSubmit}
                disabled={!pasteText.trim() || isProcessing}
              >
                <Text style={styles.pasteSubmitText}>Phân tích</Text>
              </Pressable>
            </View>
          )}

          {/* Thẻ vừa học được */}
          {newlyAdded.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Vừa học được</Text>
              {newlyAdded.map((item) => (
                <FlashCard key={item.id} item={item} />
              ))}
            </View>
          )}

          {/* Danh sách từ gần đây */}
          {newlyAdded.length === 0 && !pendingItems && vocabulary.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Gần đây</Text>
              <View style={styles.recentList}>
                {vocabulary.slice(0, 3).map((item) => (
                  <FlashCard key={item.id} item={item} compact />
                ))}
              </View>
            </View>
          )}

          {vocabulary.length === 0 && !isProcessing && !pendingItems && newlyAdded.length === 0 && (
            <Text style={styles.emptyText}>
              Chưa có nội dung nào. Hãy nói hoặc dán câu để bắt đầu học nhé!
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <FieldPickerModal
        visible={fieldModalVisible}
        onClose={() => setFieldModalVisible(false)}
      />

      <ApiKeySettingsModal
        visible={settingsModalVisible}
        onClose={() => setSettingsModalVisible(false)}
      />

      {/* Modal tra từ trong ngữ cảnh khi chạm/kéo trên đoạn nhận diện */}
      <WordContextModal
        visible={!!selectedTranscribedWord}
        word={selectedTranscribedWord || ''}
        fullSentence={transcribedText}
        fieldKey={field}
        scope="communication"
        onClose={() => setSelectedTranscribedWord(null)}
        onWordSaved={() => {
          loadVocabulary();
          loadStats();
        }}
      />

      {/* Modal Diễn đạt theo Ngữ cảnh bản xứ */}
      <SituationalAssistantModal
        visible={situationalModalVisible}
        onClose={() => setSituationalModalVisible(false)}
        onSentenceSaved={() => {
          loadVocabulary();
          loadStats();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFDF9' },
  content: { paddingTop: 6, paddingBottom: 32 },
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  screenHeaderLeft: {
    flex: 1,
    marginRight: 8,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.3,
  },
  screenSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingsBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldSelectorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  fieldSelectorText: {
    color: '#4338CA',
    fontSize: 12,
    fontWeight: '700',
  },
  mascotSection: { alignItems: 'center', paddingVertical: 8 },
  transcribedBox: {
    marginHorizontal: 20,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 8,
  },
  transcribedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  transcribedLabel: { color: '#64748B', fontSize: 11, fontWeight: '700' },
  transcribedSpeakBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  transcribedSpeakText: {
    color: '#6366F1',
    fontSize: 11,
    fontWeight: '700',
  },
  transcribedText: { color: '#334155', fontSize: 14, fontStyle: 'italic', lineHeight: 21 },
  processingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginVertical: 10 },
  processingText: { color: '#6366F1', fontSize: 14, fontWeight: '700' },
  voiceSection: { alignItems: 'center', paddingVertical: 8 },
  voiceHint: { color: '#64748B', fontSize: 12, marginTop: 8, fontWeight: '600' },
  audioSourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    alignSelf: 'center',
  },
  audioSourceText: {
    fontSize: 11,
    fontWeight: '700',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 12,
    gap: 8,
  },
  situationalBtn: {
    flex: 1.25,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EEF2FF',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderWidth: 1.5,
    borderColor: '#C7D2FE',
  },
  situationalBtnText: {
    color: '#4F46E5',
    fontSize: 13,
    fontWeight: '700',
  },
  pasteToggleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 8,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  pasteToggleBtnText: { color: '#475569', fontSize: 13, fontWeight: '700' },
  pasteContainer: { marginHorizontal: 20, marginTop: 10 },
  pasteInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    color: '#0F172A',
    padding: 14,
    fontSize: 14,
    lineHeight: 21,
    minHeight: 90,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  pasteSubmitBtn: { backgroundColor: '#6366F1', borderRadius: 14, padding: 14, alignItems: 'center' },
  pasteSubmitBtnDisabled: { opacity: 0.4 },
  pasteSubmitText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
  section: { marginTop: 18 },
  recentList: { marginHorizontal: 20, gap: 10 },
  sectionTitle: { color: '#64748B', fontSize: 12, fontWeight: '800', marginLeft: 22, marginBottom: 8 },
  emptyText: { color: '#64748B', fontSize: 14, textAlign: 'center', lineHeight: 22, marginTop: 28, paddingHorizontal: 36 },
});
