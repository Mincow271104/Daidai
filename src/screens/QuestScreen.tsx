import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Mascot } from '../components/Mascot';
import { QuestCard } from '../components/QuestCard';
import { DialogueModal } from '../components/DialogueModal';
import { ApiKeySettingsModal } from '../components/ApiKeySettingsModal';
import { useMascotStore } from '../store/mascotStore';
import { useVocabularyStore } from '../store/vocabularyStore';
import { useFieldStore } from '../store/fieldStore';
import { recordAnswer } from '../services/fsrs';
import {
  insertQuestHistory,
  getQuestStreak,
  recordQuestCompletion,
  getDueVocabulary,
  getOldVocabulary,
  getAllVocabulary,
  getTotalStats,
} from '../database/repository';
import { generateQuests, generateSentenceQuests } from '../services/api';
import { cancelStreakSaverAlert } from '../services/notifications';
import { getRandomPhrase } from '../constants/phrases';
import { VocabularyItem, AIQuest } from '../types';

interface QuestSession {
  vocab: VocabularyItem;
  quest: AIQuest;
}

type SessionStatus = 'loading' | 'ready' | 'empty' | 'complete';

export function QuestScreen() {
  const isFocused = useIsFocused();
  const { state: mascotState, message, setState: setMascotState } = useMascotStore();
  const { loadStats, loadVocabulary } = useVocabularyStore();
  const field = useFieldStore((s) => s.field);

  // Tab mặc định: 'communication'
  const [activeTab, setActiveTab] = useState<'communication' | 'domain'>('communication');
  const [showDialogueModal, setShowDialogueModal] = useState(false);

  // Trạng thái kiểm soát: Chỉ chạy bài tập và đếm giờ khi user bấm "Bắt đầu làm bài"
  const [isQuizActive, setIsQuizActive] = useState(false);
  const [dueCount, setDueCount] = useState(0);
  const [hasOldWords, setHasOldWords] = useState(false);
  const [vocabStats, setVocabStats] = useState({ total: 0, mastered: 0, due: 0 });

  const [status, setStatus] = useState<SessionStatus>('loading');
  const [sessions, setSessions] = useState<QuestSession[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [streak, setStreak] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const correctRef = useRef(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [isReviewingOld, setIsReviewingOld] = useState(false);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);

  // Tải thông tin thống kê số lượng từ cần ôn (chạy tức thì trên SQLite, không gọi AI, không chạy đếm giờ)
  const refreshCounts = useCallback(async () => {
    try {
      const allWords = await getAllVocabulary(activeTab);
      const dueWords = await getDueVocabulary(5, activeTab);
      const stats = await getTotalStats(activeTab);
      setDueCount(dueWords.length);
      setVocabStats(stats);
      setHasOldWords(allWords.length > 0);
      setStreak(await getQuestStreak());
      setMascotState(
        'idle',
        dueWords.length > 0
          ? `Hôm nay bạn có ${dueWords.length} câu cần củng cố phản xạ!`
          : 'Hôm nay bạn đã ôn tập rất tốt!'
      );
    } catch (err: any) {
      setError(err.message);
    }
  }, [activeTab, setMascotState]);

  // Khi vào màn hình bài tập và chưa bắt đầu làm bài, chỉ làm mới số liệu tổng quan
  useEffect(() => {
    if (isFocused && !isQuizActive) {
      refreshCounts();
    }
  }, [isFocused, isQuizActive, refreshCounts]);

  const loadQuestSession = useCallback(
    async (forceOld: boolean = false) => {
      setStatus('loading');
      setError(null);
      setMascotState('processing', getRandomPhrase('processing'));
      try {
        const allWords = await getAllVocabulary(activeTab);
        setHasOldWords(allWords.length > 0);

        let vocabs: VocabularyItem[] = [];
        let isOldMode = false;

        if (forceOld) {
          vocabs = await getOldVocabulary(5, activeTab);
          isOldMode = true;
        } else {
          vocabs = await getDueVocabulary(5, activeTab);
        }

        if (vocabs.length === 0) {
          setStatus('empty');
          setIsReviewingOld(false);
          setMascotState(
            'sleeping',
            allWords.length > 0
              ? 'Tất cả bài tập hôm nay đã xong! Bạn có thể làm lại các từ cũ nhé.'
              : getRandomPhrase('sleeping')
          );
          return;
        }

        setIsReviewingOld(isOldMode);

        let quests: AIQuest[] = [];
        if (activeTab === 'communication') {
          quests = await generateSentenceQuests(vocabs);
        } else {
          quests = await generateQuests(vocabs, field);
        }

        setSessions(vocabs.map((vocab, i) => ({ vocab, quest: quests[i] })));
        setCurrentIndex(0);
        correctRef.current = 0;
        setCorrectCount(0);
        setStreak(await getQuestStreak());
        setStatus('ready');
        setMascotState(
          'teaching',
          isOldMode
            ? 'Đang ôn lại những từ cũ để nhớ sâu hơn! Cố lên nhé!'
            : getRandomPhrase('teaching')
        );
      } catch (err: any) {
        setError(err.message);
        setStatus('empty');
        setIsReviewingOld(false);
        setMascotState('confused', getRandomPhrase('confused'));
      }
    },
    [activeTab, field, setMascotState]
  );

  const startQuiz = useCallback(
    (forceOld: boolean = false) => {
      setIsQuizActive(true);
      loadQuestSession(forceOld);
    },
    [loadQuestSession]
  );

  const handleTabChange = (tab: 'communication' | 'domain') => {
    if (tab === activeTab) return;
    Haptics.selectionAsync();
    setIsReviewingOld(false);
    setIsQuizActive(false);
    setActiveTab(tab);
  };

  const handleAnswer = useCallback(
    async (selectedIndex: number, isCorrect: boolean, timeTakenMs: number) => {
      const current = sessions[currentIndex];
      if (!current) return;

      await recordAnswer(current.vocab.id, isCorrect, timeTakenMs);

      let questType: 'listening' | 'multiple_choice' | 'reorder' = 'multiple_choice';
      if (current.quest.kind === 'listen_to_tw' || current.quest.kind === 'listen_to_vi') {
        questType = 'listening';
      } else if (current.quest.kind === 'reorder') {
        questType = 'reorder';
      }

      await insertQuestHistory({
        vocab_id: current.vocab.id,
        quest_type: questType,
        answer_given: selectedIndex,
        correct_index: current.quest.correct_index,
        is_correct: isCorrect,
        time_taken_ms: timeTakenMs,
      });

      if (isCorrect) {
        correctRef.current += 1;
        setCorrectCount(correctRef.current);
        setMascotState('eureka', getRandomPhrase('eureka'));
      } else {
        setMascotState('confused', getRandomPhrase('confused'));
      }

      if (currentIndex + 1 >= sessions.length) {
        const newStreak = await recordQuestCompletion(correctRef.current > 0);
        setStreak(newStreak);
        await loadStats();
        await loadVocabulary();
        if (correctRef.current > 0) {
          await cancelStreakSaverAlert();
        }
        setStatus('complete');
        setMascotState('eureka', `Đúng ${correctRef.current}/${sessions.length} câu.`);
      } else {
        setCurrentIndex((i) => i + 1);
        setMascotState('teaching', getRandomPhrase('teaching'));
      }
    },
    [sessions, currentIndex, setMascotState, loadStats, loadVocabulary]
  );

  const current = sessions[currentIndex];
  const masteredPercent =
    vocabStats.total > 0
      ? Math.min(100, Math.round((vocabStats.mastered / vocabStats.total) * 100))
      : 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {/* Header màn hình */}
      <View style={styles.screenHeader}>
        {isQuizActive ? (
          <Pressable
            style={styles.exitQuizBtn}
            onPress={() => {
              Haptics.selectionAsync();
              setIsQuizActive(false);
              refreshCounts();
            }}
          >
            <Feather name="arrow-left" size={18} color="#4F46E5" />
            <Text style={styles.exitQuizBtnText}>Dừng bài tập</Text>
          </Pressable>
        ) : (
          <View style={styles.screenHeaderLeft}>
            <Text style={styles.screenTitle}>Bài tập</Text>
          </View>
        )}

        <View style={styles.headerRightActions}>
          {streak > 0 && (
            <View style={styles.streakBadge}>
              <Text style={styles.streakBadgeText}>🔥 {streak} ngày</Text>
            </View>
          )}

          {!isQuizActive && (
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
          )}
        </View>
      </View>

      {/* 2 Tab trên cùng: Giao tiếp vs Chuyên ngành */}
      {!isQuizActive && (
        <View style={styles.topTabsWrapper}>
          <View style={styles.topTabsContainer}>
            <Pressable
              style={[styles.topTab, activeTab === 'communication' && styles.topTabActive]}
              onPress={() => handleTabChange('communication')}
            >
              <Feather
                name="message-circle"
                size={16}
                color={activeTab === 'communication' ? '#6366F1' : '#64748B'}
              />
              <Text
                style={[
                  styles.topTabText,
                  activeTab === 'communication' && styles.topTabTextActive,
                ]}
              >
                Giao tiếp
              </Text>
            </Pressable>

            <Pressable
              style={[styles.topTab, activeTab === 'domain' && styles.topTabActive]}
              onPress={() => handleTabChange('domain')}
            >
              <Feather
                name="briefcase"
                size={16}
                color={activeTab === 'domain' ? '#6366F1' : '#64748B'}
              />
              <Text
                style={[
                  styles.topTabText,
                  activeTab === 'domain' && styles.topTabTextActive,
                ]}
              >
                Chuyên ngành
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* ─── VIEW 1: TRANG CHỦ BÀI TẬP (BỐ CỤC ĐẦY ĐẶN, KHÔNG TRỐNG TRẢI) ─── */}
        {!isQuizActive && (
          <View style={styles.hubContainer}>
            {/* Thanh lời chào Mascot tích hợp */}
            <View style={styles.greetingCard}>
              <View style={styles.mascotAvatarCol}>
                <Mascot state={mascotState} size={44} />
              </View>
              <View style={styles.greetingTextCol}>
                <Text style={styles.greetingTitle}>
                  {dueCount > 0
                    ? `Hôm nay có ${dueCount} câu cần củng cố`
                    : 'Bạn đã hoàn thành tốt các câu cần ôn!'}
                </Text>
                <Text style={styles.greetingSubtitle}>
                  {dueCount > 0
                    ? 'Hãy hoàn thành bài tập để ghi nhớ lâu nhé'
                    : 'Sẵn sàng luyện phản xạ giao tiếp bất cứ lúc nào'}
                </Text>
              </View>
            </View>

            {/* Bảng chỉ số thống kê ôn tập 3 cột */}
            <View style={styles.statsRow}>
              <View style={[styles.statBox, { borderColor: '#FDE68A', backgroundColor: '#FFFBEB' }]}>
                <Text style={[styles.statNumber, { color: '#D97706' }]}>{dueCount}</Text>
                <Text style={styles.statLabel}>Cần ôn hôm nay</Text>
              </View>
              <View style={[styles.statBox, { borderColor: '#A7F3D0', backgroundColor: '#ECFDF5' }]}>
                <Text style={[styles.statNumber, { color: '#059669' }]}>{vocabStats.mastered}</Text>
                <Text style={styles.statLabel}>Đã thành thạo</Text>
              </View>
              <View style={[styles.statBox, { borderColor: '#C7D2FE', backgroundColor: '#EEF2FF' }]}>
                <Text style={[styles.statNumber, { color: '#4F46E5' }]}>{vocabStats.total}</Text>
                <Text style={styles.statLabel}>Tổng trong kho</Text>
              </View>
            </View>

            {/* Thẻ 1: Trắc nghiệm ôn tập */}
            <View style={styles.hubCard}>
              <View style={styles.hubCardHeader}>
                <View style={[styles.hubIconCircle, { backgroundColor: '#ECFDF5' }]}>
                  <Feather name="award" size={18} color="#10B981" />
                </View>
                <View style={styles.hubCardTitleCol}>
                  <Text style={styles.hubCardTitle}>Trắc nghiệm ôn tập</Text>
                  <Text style={styles.hubCardSubtitle}>
                    {activeTab === 'communication'
                      ? 'Kho câu & cụm từ giao tiếp'
                      : `Thuật ngữ chuyên ngành (${field})`}
                  </Text>
                </View>
              </View>

              {/* Thanh tiến độ thành thạo */}
              <View style={styles.progressBarSection}>
                <View style={styles.progressLabelRow}>
                  <Text style={styles.progressLabel}>Tiến độ thành thạo</Text>
                  <Text style={styles.progressPercent}>
                    {masteredPercent}% ({vocabStats.mastered}/{vocabStats.total} câu)
                  </Text>
                </View>
                <View style={styles.progressBarTrack}>
                  <View style={[styles.progressBarFill, { width: `${masteredPercent}%` }]} />
                </View>
              </View>

              {dueCount > 0 ? (
                <View style={styles.quizActionCol}>
                  <Pressable
                    style={styles.quizStartBtn}
                    onPress={() => {
                      Haptics.selectionAsync();
                      startQuiz(false);
                    }}
                  >
                    <Feather name="play" size={15} color="#FFFFFF" />
                    <Text style={styles.quizStartBtnText}>
                      Bắt đầu làm bài ({dueCount} câu)
                    </Text>
                  </Pressable>
                  {hasOldWords && (
                    <Pressable
                      style={styles.quizSecondaryBtn}
                      onPress={() => {
                        Haptics.selectionAsync();
                        startQuiz(true);
                      }}
                    >
                      <Feather name="refresh-cw" size={13} color="#475569" />
                      <Text style={styles.quizSecondaryBtnText}>Làm lại những từ cũ</Text>
                    </Pressable>
                  )}
                </View>
              ) : hasOldWords ? (
                <View style={styles.quizStatusDoneBox}>
                  <View style={styles.quizStatusRow}>
                    <Feather name="check-circle" size={15} color="#10B981" />
                    <Text style={styles.quizStatusDoneText}>
                      Đã hoàn thành các câu cần ôn hôm nay
                    </Text>
                  </View>
                  <Pressable
                    style={styles.quizReviewOldBtn}
                    onPress={() => {
                      Haptics.selectionAsync();
                      startQuiz(true);
                    }}
                  >
                    <Feather name="refresh-cw" size={14} color="#FFFFFF" />
                    <Text style={styles.quizStartBtnText}>Làm lại những từ cũ</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.quizEmptyBox}>
                  <Feather name="inbox" size={22} color="#94A3B8" />
                  <Text style={styles.quizEmptyText}>Chưa có từ hoặc câu nào trong kho</Text>
                </View>
              )}
            </View>

            {/* Thẻ 2: Hội thoại nhập vai */}
            <View style={styles.hubCard}>
              <View style={styles.hubCardHeader}>
                <View style={[styles.hubIconCircle, { backgroundColor: '#EEF2FF' }]}>
                  <Feather name="message-square" size={18} color="#6366F1" />
                </View>
                <View style={styles.hubCardTitleCol}>
                  <Text style={styles.hubCardTitle}>Hội thoại nhập vai</Text>
                  <Text style={styles.hubCardSubtitle}>
                    Luyện phản xạ theo ngữ cảnh thực tế
                  </Text>
                </View>
              </View>

              {/* Gợi ý các tình huống nhanh */}
              <View style={styles.scenarioChipsWrap}>
                <Pressable
                  style={styles.scenarioChip}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setShowDialogueModal(true);
                  }}
                >
                  <Feather name="coffee" size={12} color="#4F46E5" />
                  <Text style={styles.scenarioChipText}>Gọi đồ uống</Text>
                </Pressable>

                <Pressable
                  style={styles.scenarioChip}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setShowDialogueModal(true);
                  }}
                >
                  <Feather name="map-pin" size={12} color="#4F46E5" />
                  <Text style={styles.scenarioChipText}>Đi tàu & hỏi đường</Text>
                </Pressable>

                <Pressable
                  style={styles.scenarioChip}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setShowDialogueModal(true);
                  }}
                >
                  <Feather name="shopping-bag" size={12} color="#4F46E5" />
                  <Text style={styles.scenarioChipText}>Cửa hàng tiện lợi</Text>
                </Pressable>

                <Pressable
                  style={[styles.scenarioChip, styles.scenarioChipCustom]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setShowDialogueModal(true);
                  }}
                >
                  <Feather name="plus-circle" size={12} color="#059669" />
                  <Text style={[styles.scenarioChipText, { color: '#059669' }]}>Tự tạo tình huống</Text>
                </Pressable>
              </View>

              <Pressable
                style={styles.dialogueActionBtn}
                onPress={() => {
                  Haptics.selectionAsync();
                  setShowDialogueModal(true);
                }}
              >
                <Feather name="message-circle" size={15} color="#FFFFFF" />
                <Text style={styles.dialogueActionBtnText}>Vào hội thoại nhập vai</Text>
                <Feather name="chevron-right" size={15} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        )}

        {/* ─── VIEW 2: QUIZ ĐANG HOẠT ĐỘNG (BẮT ĐẦU ĐẾM GIỜ KHI USER ĐÃ SẴN SÀNG) ─── */}
        {isQuizActive && (
          <View>
            <View style={styles.mascotQuizSection}>
              <Mascot state={mascotState} message={message} size={50} />
            </View>

            {isReviewingOld && (
              <View style={styles.modeBadgeWrap}>
                <View style={styles.modeBadge}>
                  <Feather name="refresh-cw" size={11} color="#6366F1" />
                  <Text style={styles.modeBadgeText}>Đang ôn lại những từ cũ</Text>
                </View>
              </View>
            )}

            {status === 'loading' && (
              <View style={styles.center}>
                <ActivityIndicator size="large" color="#6366F1" />
                <Text style={styles.muted}>Đang chuẩn bị câu hỏi...</Text>
              </View>
            )}

            {error && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
                <Pressable
                  style={[styles.retryBtn, { marginTop: 12 }]}
                  onPress={() => loadQuestSession(isReviewingOld)}
                >
                  <Text style={styles.retryBtnText}>Thử lại</Text>
                </Pressable>
              </View>
            )}

            {status === 'empty' && (
              <View style={styles.center}>
                <Feather name="inbox" size={34} color="#94A3B8" />
                <Text style={styles.emptyTitle}>Không có câu hỏi để ôn tập</Text>
                <Pressable
                  style={styles.secondaryBtn}
                  onPress={() => {
                    setIsQuizActive(false);
                    refreshCounts();
                  }}
                >
                  <Text style={styles.secondaryBtnText}>Trở về trang ôn tập</Text>
                </Pressable>
              </View>
            )}

            {status === 'ready' && current && (
              <>
                <View style={styles.progressRow}>
                  {sessions.map((_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.dot,
                        i < currentIndex && styles.dotDone,
                        i === currentIndex && styles.dotActive,
                      ]}
                    />
                  ))}
                </View>
                <View style={styles.questSection}>
                  <QuestCard
                    key={current.vocab.id + currentIndex}
                    quest={current.quest}
                    onAnswer={handleAnswer}
                    englishTerm={current.vocab.original_term}
                  />
                </View>
              </>
            )}

            {status === 'complete' && (
              <View style={styles.center}>
                <View style={styles.completeIconCircle}>
                  <Feather name="award" size={36} color="#6366F1" />
                </View>
                <Text style={styles.emptyTitle}>Hoàn thành xuất sắc!</Text>
                <Text style={styles.score}>
                  {correctCount}/{sessions.length} câu đúng
                </Text>
                <View style={styles.completeBtnCol}>
                  <Pressable
                    style={styles.reviewOldMainBtn}
                    onPress={() => {
                      setIsQuizActive(false);
                      refreshCounts();
                    }}
                  >
                    <Feather name="check" size={16} color="#FFFFFF" />
                    <Text style={styles.reviewOldMainBtnText}>Hoàn thành & Trở về</Text>
                  </Pressable>

                  {hasOldWords && (
                    <Pressable
                      style={styles.secondaryBtn}
                      onPress={() => loadQuestSession(true)}
                    >
                      <Text style={styles.secondaryBtnText}>Làm lại những từ cũ</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* Modal Hội thoại nhập vai */}
      <DialogueModal
        visible={showDialogueModal}
        onClose={() => {
          setShowDialogueModal(false);
          refreshCounts();
        }}
        onSaveSentence={() => {
          loadVocabulary();
          loadStats();
          refreshCounts();
        }}
      />

      <ApiKeySettingsModal
        visible={settingsModalVisible}
        onClose={() => setSettingsModalVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFDF9' },
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
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
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  screenHeaderLeft: {
    flex: 1,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.3,
  },
  exitQuizBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: '#EEF2FF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  exitQuizBtnText: {
    color: '#4F46E5',
    fontSize: 13,
    fontWeight: '700',
  },
  streakBadge: {
    backgroundColor: '#FEF3C7',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  streakBadgeText: {
    color: '#B45309',
    fontSize: 12,
    fontWeight: '800',
  },
  topTabsWrapper: {
    backgroundColor: '#FFFDF9',
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    zIndex: 10,
  },
  topTabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 3,
  },
  topTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 9,
  },
  topTabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 2,
  },
  topTabText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '700',
  },
  topTabTextActive: {
    color: '#6366F1',
    fontWeight: '800',
  },
  content: { paddingTop: 10, paddingBottom: 40 },
  greetingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#F1F5F9',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  mascotAvatarCol: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  greetingTextCol: {
    flex: 1,
  },
  greetingTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  greetingSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statBox: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
  },
  statNumber: {
    fontSize: 18,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '600',
    textAlign: 'center',
  },
  hubContainer: {
    paddingHorizontal: 16,
    gap: 12,
  },
  hubCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#F1F5F9',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 5,
    elevation: 2,
  },
  hubCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  hubIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hubCardTitleCol: {
    flex: 1,
  },
  hubCardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  hubCardSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
  progressBarSection: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  progressPercent: {
    fontSize: 12,
    color: '#059669',
    fontWeight: '700',
  },
  progressBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  quizActionCol: {
    gap: 8,
  },
  quizStartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#10B981',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  quizStartBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  quizSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  quizSecondaryBtnText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '600',
  },
  quizStatusDoneBox: {
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#BBF7D0',
    gap: 10,
  },
  quizStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  quizStatusDoneText: {
    color: '#047857',
    fontSize: 13,
    fontWeight: '700',
  },
  quizReviewOldBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#6366F1',
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  quizEmptyBox: {
    alignItems: 'center',
    paddingVertical: 12,
    gap: 4,
  },
  quizEmptyText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
  },
  scenarioChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  scenarioChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  scenarioChipCustom: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  scenarioChipText: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
  },
  dialogueActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#6366F1',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  dialogueActionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  mascotQuizSection: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  modeBadgeWrap: {
    alignItems: 'center',
    marginBottom: 10,
  },
  modeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  modeBadgeText: {
    color: '#4F46E5',
    fontSize: 12,
    fontWeight: '700',
  },
  center: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 36 },
  muted: { color: '#64748B', fontSize: 14, marginTop: 12, textAlign: 'center', lineHeight: 21 },
  completeIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  reviewOldMainBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#6366F1',
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 14,
    marginTop: 18,
    width: '100%',
    maxWidth: 280,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  reviewOldMainBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryBtn: {
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginTop: 10,
    width: '100%',
    maxWidth: 280,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '700',
  },
  completeBtnCol: {
    width: '100%',
    alignItems: 'center',
    marginTop: 4,
  },
  errorBox: {
    marginHorizontal: 20,
    backgroundColor: '#FEF2F2',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
  },
  errorText: { color: '#DC2626', fontSize: 13 },
  emptyTitle: { color: '#0F172A', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  score: { color: '#6366F1', fontSize: 18, fontWeight: '800', marginTop: 8 },
  progressRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginVertical: 8 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#E2E8F0' },
  dotDone: { backgroundColor: '#10B981' },
  dotActive: { backgroundColor: '#6366F1', width: 24 },
  questSection: { marginHorizontal: 16, marginTop: 4 },
  retryBtn: {
    backgroundColor: '#6366F1',
    borderRadius: 14,
    paddingHorizontal: 28,
    paddingVertical: 12,
    marginTop: 18,
  },
  retryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
