import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { AIQuest } from '../types';
import { speakChinese } from '../utils/speak';

interface QuestCardProps {
  quest: AIQuest;
  onAnswer: (selectedIndex: number, isCorrect: boolean, timeTakenMs: number) => void;
  englishTerm: string;
}

export function QuestCard({ quest, onAnswer, englishTerm }: QuestCardProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
  const startTime = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const revealedRef = useRef(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  // Lưu lại kết quả chờ người dùng bấm "Tiếp tục"
  const pendingAnswerRef = useRef<{
    selectedIndex: number;
    isCorrect: boolean;
    timeTakenMs: number;
  } | null>(null);

  // Trạng thái riêng cho dạng bài Sắp xếp cụm từ (reorder)
  const [selectedChunks, setSelectedChunks] = useState<string[]>([]);
  const [availableChunks, setAvailableChunks] = useState<string[]>(
    quest.chunks_shuffled ? [...quest.chunks_shuffled] : []
  );

  const playAudio = useCallback(() => {
    if (quest.audio_text) {
      speakChinese(quest.audio_text);
    }
  }, [quest.audio_text]);

  const handleSelect = useCallback(
    (index: number) => {
      if (revealedRef.current) return;
      revealedRef.current = true;
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      const timeTaken = Date.now() - startTime.current;
      const isCorrect = index === quest.correct_index;
      setSelected(index);
      setRevealed(true);

      pendingAnswerRef.current = {
        selectedIndex: index,
        isCorrect,
        timeTakenMs: timeTaken,
      };

      Haptics.notificationAsync(
        isCorrect ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error
      );
      if (!isCorrect) {
        Animated.sequence([
          Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
          Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
        ]).start();
      }
      // Countdown dừng lại, không tự nhảy câu -> Chờ người dùng xem pinyin/nghĩa rồi bấm "Tiếp tục"
    },
    [quest.correct_index, shakeAnim]
  );

  // Xử lý bài sắp xếp (reorder)
  const handleChunkPick = useCallback(
    (chunk: string, index: number) => {
      if (revealedRef.current) return;
      Haptics.selectionAsync();

      const nextSelected = [...selectedChunks, chunk];
      const nextAvailable = [...availableChunks];
      nextAvailable.splice(index, 1);

      setSelectedChunks(nextSelected);
      setAvailableChunks(nextAvailable);

      // Nếu đã ghép hết các cụm từ -> Tự động chấm điểm
      if (nextAvailable.length === 0 && quest.answer_chunks) {
        const isMatch = nextSelected.join('') === quest.answer_chunks.join('');
        revealedRef.current = true;
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        const timeTaken = Date.now() - startTime.current;
        setRevealed(true);

        pendingAnswerRef.current = {
          selectedIndex: isMatch ? 0 : -1,
          isCorrect: isMatch,
          timeTakenMs: timeTaken,
        };

        Haptics.notificationAsync(
          isMatch ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error
        );
        if (!isMatch) {
          Animated.sequence([
            Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
            Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
            Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
          ]).start();
        }
      }
    },
    [selectedChunks, availableChunks, quest.answer_chunks, shakeAnim]
  );

  const handleChunkRemove = useCallback((chunk: string, index: number) => {
    if (revealedRef.current) return;
    Haptics.selectionAsync();
    const nextSelected = [...selectedChunks];
    nextSelected.splice(index, 1);
    setSelectedChunks(nextSelected);
    setAvailableChunks((prev) => [...prev, chunk]);
  }, [selectedChunks]);

  const handleResetChunks = useCallback(() => {
    if (revealedRef.current) return;
    Haptics.selectionAsync();
    setSelectedChunks([]);
    setAvailableChunks(quest.chunks_shuffled ? [...quest.chunks_shuffled] : []);
  }, [quest.chunks_shuffled]);

  const handleContinue = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (pendingAnswerRef.current) {
      const { selectedIndex, isCorrect, timeTakenMs } = pendingAnswerRef.current;
      onAnswer(selectedIndex, isCorrect, timeTakenMs);
    } else {
      onAnswer(-1, false, 30000);
    }
  }, [onAnswer]);

  useEffect(() => {
    Animated.timing(opacityAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();

    // Tự động phát âm đối với bài tập nghe
    if ((quest.kind === 'listen_to_tw' || quest.kind === 'listen_to_vi') && quest.audio_text) {
      const t = setTimeout(() => playAudio(), 400);
      return () => clearTimeout(t);
    }
  }, [quest.kind, quest.audio_text, playAudio]);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          if (quest.kind === 'reorder') {
            revealedRef.current = true;
            setRevealed(true);
            pendingAnswerRef.current = {
              selectedIndex: -1,
              isCorrect: false,
              timeTakenMs: 30000,
            };
          } else {
            handleSelect(-1);
          }
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [handleSelect, quest.kind]);

  const timerColor = timeLeft > 15 ? '#10B981' : timeLeft > 5 ? '#F59E0B' : '#EF4444';

  const kindLabel =
    quest.kind === 'reorder'
      ? 'Sắp xếp cụm'
      : quest.kind === 'fill_blank'
      ? 'Điền chỗ trống'
      : quest.kind === 'listen_to_vi'
      ? 'Nghe & Chọn nghĩa'
      : quest.kind === 'listen_to_tw'
      ? 'Nghe & Chọn chữ'
      : quest.kind === 'tw_to_vi'
      ? 'Nghĩa tiếng Việt'
      : 'Anh → Phồn thể';

  return (
    <Animated.View style={[styles.container, { opacity: opacityAnim, transform: [{ translateX: shakeAnim }] }]}>
      <View style={styles.topRow}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{kindLabel}</Text>
        </View>
        <Text style={[styles.timer, { color: timerColor }]}>{timeLeft}s</Text>
      </View>

      {/* ── BÀI SẮP XẾP CỤM (REORDER) ── */}
      {quest.kind === 'reorder' ? (
        <View style={styles.reorderSection}>
          <Text style={styles.reorderPrompt}>{quest.prompt_text}</Text>
          {quest.prompt_pinyin ? (
            <Text style={styles.reorderPinyinPrompt}>{quest.prompt_pinyin}</Text>
          ) : null}
          <Text style={styles.question}>{quest.question}</Text>

          {/* Khung chứa các cụm đang được ghép */}
          <View style={styles.assemblyBox}>
            {selectedChunks.length === 0 ? (
              <Text style={styles.assemblyPlaceholder}>Chạm các cụm từ bên dưới để ghép câu...</Text>
            ) : (
              <View style={styles.chunkWrap}>
                {selectedChunks.map((chunk, idx) => (
                  <Pressable
                    key={idx}
                    style={styles.selectedChunkChip}
                    onPress={() => handleChunkRemove(chunk, idx)}
                    disabled={revealed}
                  >
                    <Text style={styles.selectedChunkText}>{chunk}</Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {/* Đáp án đúng hiện ra khi trả lời xong */}
          {revealed && quest.answer_chunks && (
            <View style={styles.revealedAnswerBox}>
              <View style={styles.revealedAnswerHeader}>
                <Text style={styles.revealedAnswerLabel}>Câu đúng:</Text>
                {quest.target_sentence ? (
                  <Pressable
                    style={styles.revealedSpeakerBtn}
                    onPress={() => speakChinese(quest.target_sentence!)}
                    hitSlop={8}
                  >
                    <Feather name="volume-2" size={16} color="#047857" />
                  </Pressable>
                ) : null}
              </View>
              <Text style={styles.revealedAnswerText}>{quest.answer_chunks.join('')}</Text>
            </View>
          )}

          {/* Các cụm còn lại để chọn */}
          <View style={styles.availableSection}>
            <View style={styles.chunkWrap}>
              {availableChunks.map((chunk, idx) => (
                <Pressable
                  key={idx}
                  style={styles.availableChunkChip}
                  onPress={() => handleChunkPick(chunk, idx)}
                  disabled={revealed}
                >
                  <Text style={styles.availableChunkText}>{chunk}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Nút làm lại */}
          {!revealed && selectedChunks.length > 0 && (
            <Pressable style={styles.resetBtn} onPress={handleResetChunks}>
              <Feather name="rotate-ccw" size={14} color="#6366F1" />
              <Text style={styles.resetBtnText}>Làm lại</Text>
            </Pressable>
          )}
        </View>
      ) : quest.kind === 'fill_blank' ? (
        /* ── BÀI ĐIỀN CHỖ TRỐNG (FILL_BLANK) ── */
        <View style={styles.fillBlankSection}>
          <Text style={styles.promptHint}>{quest.prompt_text}</Text>
          <View style={styles.sentenceCard}>
            <Text style={styles.blankedSentenceText}>{quest.target_sentence}</Text>
            {quest.prompt_pinyin ? (
              <Text style={styles.sentencePinyinText}>{quest.prompt_pinyin}</Text>
            ) : null}
          </View>
          <Text style={styles.question}>{quest.question}</Text>

          {/* 4 Lựa chọn cụm từ: Chỉ hiện pinyin & tiếng Việt sau khi chọn */}
          <View style={styles.options}>
            {quest.options.map((option, i) => {
              const isCorrect = i === quest.correct_index;
              const isWrongPick = revealed && i === selected && !isCorrect;
              const hasMeta = revealed && (quest.options_pinyin?.[i] || quest.options_vi?.[i]);
              return (
                <Pressable key={i} onPress={() => handleSelect(i)} disabled={revealed}>
                  <View
                    style={[
                      styles.option,
                      revealed && isCorrect && styles.optionCorrect,
                      isWrongPick && styles.optionWrong,
                      revealed && !isCorrect && !isWrongPick && styles.optionDimmed,
                    ]}
                  >
                    <View style={styles.optionContentCol}>
                      <Text
                        style={[
                          styles.optionText,
                          revealed && isCorrect && styles.textCorrect,
                          isWrongPick && styles.textWrong,
                        ]}
                      >
                        {option}
                      </Text>
                      {hasMeta ? (
                        <View style={styles.optionMetaBox}>
                          {quest.options_pinyin?.[i] ? (
                            <Text
                              style={[
                                styles.optionPinyinText,
                                revealed && isCorrect && styles.pinyinCorrect,
                                isWrongPick && styles.pinyinWrong,
                              ]}
                            >
                              {quest.options_pinyin[i]}
                            </Text>
                          ) : null}
                          {quest.options_vi?.[i] ? (
                            <Text style={styles.optionViText}>{quest.options_vi[i]}</Text>
                          ) : null}
                        </View>
                      ) : null}
                    </View>

                    {revealed ? (
                      <View style={styles.optionRightCol}>
                        <Pressable
                          style={styles.optionSpeakerBtn}
                          onPress={() => speakChinese(option)}
                          hitSlop={8}
                        >
                          <Feather name="volume-2" size={15} color="#6366F1" />
                        </Pressable>
                        {isCorrect && <Feather name="check" size={20} color="#047857" />}
                        {isWrongPick && <Feather name="x" size={20} color="#B91C1C" />}
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : quest.kind === 'listen_to_vi' ? (
        /* ── BÀI TẬP NGHE CHỌN NGHĨA VIỆT ── */
        <View style={styles.listenSection}>
          <Pressable style={styles.bigSpeakerBtn} onPress={playAudio}>
            <Feather name="volume-2" size={32} color="#6366F1" />
            <Text style={styles.speakerPrompt}>Bấm để nghe lại</Text>
          </Pressable>
          <Text style={styles.question}>{quest.question}</Text>

          {revealed && quest.audio_text ? (
            <View style={styles.revealedAnswerBox}>
              <View style={styles.revealedAnswerHeader}>
                <Text style={styles.revealedAnswerLabel}>Phát âm đúng:</Text>
                <Pressable
                  style={styles.revealedSpeakerBtn}
                  onPress={() => speakChinese(quest.audio_text!)}
                  hitSlop={8}
                >
                  <Feather name="volume-2" size={16} color="#047857" />
                </Pressable>
              </View>
              <Text style={styles.revealedAnswerText}>{quest.audio_text}</Text>
              {quest.prompt_pinyin ? <Text style={styles.revealedPinyinText}>({quest.prompt_pinyin})</Text> : null}
            </View>
          ) : null}

          <View style={styles.options}>
            {quest.options.map((option, i) => {
              const isCorrect = i === quest.correct_index;
              const isWrongPick = revealed && i === selected && !isCorrect;
              return (
                <Pressable key={i} onPress={() => handleSelect(i)} disabled={revealed}>
                  <View
                    style={[
                      styles.option,
                      revealed && isCorrect && styles.optionCorrect,
                      isWrongPick && styles.optionWrong,
                      revealed && !isCorrect && !isWrongPick && styles.optionDimmed,
                    ]}
                  >
                    <View style={styles.optionContentCol}>
                      <Text
                        style={[
                          styles.optionText,
                          revealed && isCorrect && styles.textCorrect,
                          isWrongPick && styles.textWrong,
                        ]}
                      >
                        {option}
                      </Text>
                    </View>
                    {(revealed && isCorrect) || isWrongPick ? (
                      <View style={styles.optionRightCol}>
                        {revealed && isCorrect && <Feather name="check" size={20} color="#047857" />}
                        {isWrongPick && <Feather name="x" size={20} color="#B91C1C" />}
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : quest.kind === 'listen_to_tw' ? (
        /* ── BÀI TẬP NGHE CHỌN CHỮ PHỒN THỂ ── */
        <View style={styles.listenSection}>
          <Pressable style={styles.bigSpeakerBtn} onPress={playAudio}>
            <Feather name="volume-2" size={32} color="#6366F1" />
            <Text style={styles.speakerPrompt}>Bấm để nghe lại</Text>
          </Pressable>
          <Text style={styles.question}>{quest.question}</Text>

          {revealed && quest.audio_text ? (
            <View style={styles.revealedAnswerBox}>
              <View style={styles.revealedAnswerHeader}>
                <Text style={styles.revealedAnswerLabel}>Chữ đúng:</Text>
                <Pressable
                  style={styles.revealedSpeakerBtn}
                  onPress={() => speakChinese(quest.audio_text!)}
                  hitSlop={8}
                >
                  <Feather name="volume-2" size={16} color="#047857" />
                </Pressable>
              </View>
              <Text style={styles.revealedAnswerText}>{quest.audio_text}</Text>
              {quest.prompt_pinyin ? <Text style={styles.revealedPinyinText}>({quest.prompt_pinyin})</Text> : null}
            </View>
          ) : null}

          <View style={styles.options}>
            {quest.options.map((option, i) => {
              const isCorrect = i === quest.correct_index;
              const isWrongPick = revealed && i === selected && !isCorrect;
              const hasMeta = revealed && (quest.options_pinyin?.[i] || quest.options_vi?.[i]);
              return (
                <Pressable key={i} onPress={() => handleSelect(i)} disabled={revealed}>
                  <View
                    style={[
                      styles.option,
                      revealed && isCorrect && styles.optionCorrect,
                      isWrongPick && styles.optionWrong,
                      revealed && !isCorrect && !isWrongPick && styles.optionDimmed,
                    ]}
                  >
                    <View style={styles.optionContentCol}>
                      <Text
                        style={[
                          styles.optionText,
                          revealed && isCorrect && styles.textCorrect,
                          isWrongPick && styles.textWrong,
                        ]}
                      >
                        {option}
                      </Text>
                      {hasMeta ? (
                        <View style={styles.optionMetaBox}>
                          {quest.options_pinyin?.[i] ? (
                            <Text
                              style={[
                                styles.optionPinyinText,
                                revealed && isCorrect && styles.pinyinCorrect,
                                isWrongPick && styles.pinyinWrong,
                              ]}
                            >
                              {quest.options_pinyin[i]}
                            </Text>
                          ) : null}
                          {quest.options_vi?.[i] ? (
                            <Text style={styles.optionViText}>{quest.options_vi[i]}</Text>
                          ) : null}
                        </View>
                      ) : null}
                    </View>

                    {revealed ? (
                      <View style={styles.optionRightCol}>
                        <Pressable
                          style={styles.optionSpeakerBtn}
                          onPress={() => speakChinese(option)}
                          hitSlop={8}
                        >
                          <Feather name="volume-2" size={15} color="#6366F1" />
                        </Pressable>
                        {isCorrect && <Feather name="check" size={20} color="#047857" />}
                        {isWrongPick && <Feather name="x" size={20} color="#B91C1C" />}
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : quest.kind === 'tw_to_vi' ? (
        /* ── PHỒN THỂ -> NGHĨA VIỆT ── */
        <View style={styles.twPromptSection}>
          <View style={styles.twPromptHeader}>
            <Text style={styles.twLarge}>{quest.prompt_text}</Text>
            {quest.prompt_text ? (
              <Pressable
                style={styles.twSpeakerBtn}
                onPress={() => speakChinese(quest.prompt_text!)}
                hitSlop={8}
              >
                <Feather name="volume-2" size={20} color="#6366F1" />
              </Pressable>
            ) : null}
          </View>
          {quest.prompt_pinyin ? (
            <Text style={styles.twPinyinSub}>{quest.prompt_pinyin}</Text>
          ) : null}
          <Text style={styles.question}>{quest.question}</Text>

          <View style={styles.options}>
            {quest.options.map((option, i) => {
              const isCorrect = i === quest.correct_index;
              const isWrongPick = revealed && i === selected && !isCorrect;
              return (
                <Pressable key={i} onPress={() => handleSelect(i)} disabled={revealed}>
                  <View
                    style={[
                      styles.option,
                      revealed && isCorrect && styles.optionCorrect,
                      isWrongPick && styles.optionWrong,
                      revealed && !isCorrect && !isWrongPick && styles.optionDimmed,
                    ]}
                  >
                    <View style={styles.optionContentCol}>
                      <Text
                        style={[
                          styles.optionText,
                          revealed && isCorrect && styles.textCorrect,
                          isWrongPick && styles.textWrong,
                        ]}
                      >
                        {option}
                      </Text>
                    </View>
                    {(revealed && isCorrect) || isWrongPick ? (
                      <View style={styles.optionRightCol}>
                        {revealed && isCorrect && <Feather name="check" size={20} color="#047857" />}
                        {isWrongPick && <Feather name="x" size={20} color="#B91C1C" />}
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : (
        /* ── ANH -> PHỒN THỂ (EN_TO_TW) ── */
        <View style={styles.enPromptSection}>
          <Text style={styles.term}>{englishTerm}</Text>
          <Text style={styles.question}>{quest.question}</Text>

          <View style={styles.options}>
            {quest.options.map((option, i) => {
              const isCorrect = i === quest.correct_index;
              const isWrongPick = revealed && i === selected && !isCorrect;
              const hasMeta = revealed && (quest.options_pinyin?.[i] || quest.options_vi?.[i]);
              return (
                <Pressable key={i} onPress={() => handleSelect(i)} disabled={revealed}>
                  <View
                    style={[
                      styles.option,
                      revealed && isCorrect && styles.optionCorrect,
                      isWrongPick && styles.optionWrong,
                      revealed && !isCorrect && !isWrongPick && styles.optionDimmed,
                    ]}
                  >
                    <View style={styles.optionContentCol}>
                      <Text
                        style={[
                          styles.optionText,
                          revealed && isCorrect && styles.textCorrect,
                          isWrongPick && styles.textWrong,
                        ]}
                      >
                        {option}
                      </Text>
                      {hasMeta ? (
                        <View style={styles.optionMetaBox}>
                          {quest.options_pinyin?.[i] ? (
                            <Text
                              style={[
                                styles.optionPinyinText,
                                revealed && isCorrect && styles.pinyinCorrect,
                                isWrongPick && styles.pinyinWrong,
                              ]}
                            >
                              {quest.options_pinyin[i]}
                            </Text>
                          ) : null}
                          {quest.options_vi?.[i] ? (
                            <Text style={styles.optionViText}>{quest.options_vi[i]}</Text>
                          ) : null}
                        </View>
                      ) : null}
                    </View>

                    {revealed ? (
                      <View style={styles.optionRightCol}>
                        <Pressable
                          style={styles.optionSpeakerBtn}
                          onPress={() => speakChinese(option)}
                          hitSlop={8}
                        >
                          <Feather name="volume-2" size={15} color="#6366F1" />
                        </Pressable>
                        {isCorrect && <Feather name="check" size={20} color="#047857" />}
                        {isWrongPick && <Feather name="x" size={20} color="#B91C1C" />}
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      {/* ── NÚT TIẾP TỤC: Hiện khi đã trả lời xong để người dùng chủ động xem pinyin, nghĩa và nghe phát âm ── */}
      {revealed && (
        <Pressable style={styles.continueBtn} onPress={handleContinue}>
          <Text style={styles.continueBtnText}>Tiếp tục</Text>
          <Feather name="arrow-right" size={18} color="#FFFFFF" />
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  badge: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: { color: '#6366F1', fontSize: 12, fontWeight: '700' },
  timer: { fontSize: 14, fontWeight: '800' },
  enPromptSection: { marginBottom: 16 },
  term: { color: '#6366F1', fontSize: 15, fontWeight: '800', marginBottom: 4 },
  twPromptSection: { alignItems: 'center', marginBottom: 16 },
  twPromptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 4,
  },
  twLarge: { color: '#0F172A', fontSize: 32, fontWeight: '800', letterSpacing: 1 },
  twSpeakerBtn: {
    backgroundColor: '#EEF2FF',
    padding: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  listenSection: { alignItems: 'center', marginBottom: 16 },
  bigSpeakerBtn: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 20,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    marginBottom: 12,
  },
  speakerPrompt: { color: '#6366F1', fontSize: 13, fontWeight: '700' },
  revealedAnswerBox: {
    backgroundColor: '#ECFDF5',
    padding: 12,
    borderRadius: 14,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    gap: 4,
  },
  revealedAnswerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  revealedAnswerLabel: {
    color: '#047857',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  revealedAnswerText: {
    color: '#065F46',
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 26,
  },
  revealedSpeakerBtn: {
    padding: 4,
  },
  question: { color: '#0F172A', fontSize: 16, fontWeight: '800', lineHeight: 24, marginBottom: 14 },
  options: { gap: 10, width: '100%' },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    minHeight: 52,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  optionCorrect: { borderColor: '#10B981', backgroundColor: '#ECFDF5' },
  optionWrong: { borderColor: '#EF4444', backgroundColor: '#FEF2F2' },
  optionDimmed: { opacity: 0.45 },
  optionText: {
    color: '#1E293B',
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    flexShrink: 1,
  },
  textCorrect: { color: '#047857', fontWeight: '800' },
  textWrong: { color: '#B91C1C' },
  optionContentCol: {
    flex: 1,
    justifyContent: 'center',
    flexShrink: 1,
    paddingVertical: 2,
  },
  optionMetaBox: {
    marginTop: 4,
    gap: 2,
  },
  optionPinyinText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  optionViText: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '500',
    fontStyle: 'italic',
  },
  pinyinCorrect: {
    color: '#059669',
    fontWeight: '600',
  },
  pinyinWrong: {
    color: '#DC2626',
  },
  optionRightCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 10,
  },
  optionSpeakerBtn: {
    backgroundColor: '#EEF2FF',
    padding: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  twPinyinSub: {
    color: '#6366F1',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  reorderPinyinPrompt: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  revealedPinyinText: {
    color: '#047857',
    fontSize: 13,
    fontStyle: 'italic',
  },

  // Styles cho Reorder
  reorderSection: {
    marginBottom: 10,
  },
  reorderPrompt: {
    color: '#6366F1',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 6,
  },
  assemblyBox: {
    minHeight: 70,
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 12,
    borderWidth: 2,
    borderColor: '#C7D2FE',
    borderStyle: 'dashed',
    justifyContent: 'center',
    marginBottom: 16,
  },
  assemblyPlaceholder: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  chunkWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  selectedChunkChip: {
    backgroundColor: '#6366F1',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  selectedChunkText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  availableSection: {
    marginTop: 8,
    marginBottom: 12,
  },
  availableChunkChip: {
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: '#C7D2FE',
  },
  availableChunkText: {
    color: '#1E1B4B',
    fontSize: 16,
    fontWeight: '800',
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  resetBtnText: {
    color: '#6366F1',
    fontSize: 13,
    fontWeight: '700',
  },

  // Styles cho Fill Blank
  fillBlankSection: {
    marginBottom: 10,
  },
  promptHint: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  sentenceCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    marginBottom: 12,
  },
  blankedSentenceText: {
    color: '#0F172A',
    fontSize: 19,
    fontWeight: '800',
    lineHeight: 28,
  },
  sentencePinyinText: {
    color: '#6366F1',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 6,
    letterSpacing: 0.5,
  },

  // Nút Tiếp tục
  continueBtn: {
    marginTop: 18,
    backgroundColor: '#6366F1',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  continueBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
});
