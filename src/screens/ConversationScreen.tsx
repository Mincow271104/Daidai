import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Modal,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRecorder } from '../hooks/useRecorder';
import { ClickableSentence } from '../components/ClickableSentence';
import { WordContextModal } from '../components/WordContextModal';
import { FieldPickerModal } from '../components/FieldPickerModal';
import { NativeFeedbackModal } from '../components/NativeFeedbackModal';
import { ApiKeySettingsModal } from '../components/ApiKeySettingsModal';
import { SituationalAssistantModal } from '../components/SituationalAssistantModal';
import { ConversationMessage, ConversationSession, AITerm } from '../types';
import {
  translateConversationTurn,
  translateInstantFirstPass,
  analyzeBackgroundSecondPass,
  transcribeSpeech,
  classifyTopicForContent,
} from '../services/api';
import {
  insertConversationMessage,
  getConversationMessages,
  toggleSaveConversationMessage,
  clearConversationSession,
  insertVocabulary,
  getConversationSessions,
  createOrUpdateConversationSession,
  deleteConversationSession,
  termExists,
  getAutoSpeakSetting,
} from '../database/repository';
import { useFieldStore } from '../store/fieldStore';
import { useScrollLockStore } from '../store/scrollLockStore';
import { getField } from '../constants/fields';
import { speakChinese } from '../utils/speak';
import { cleanChineseText } from '../utils/similarity';

function formatSessionTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');

  if (isToday) {
    return `Hôm nay ${hours}:${minutes}`;
  }
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  return `${day}/${month} ${hours}:${minutes}`;
}

export function ConversationScreen() {
  const isScrollLocked = useScrollLockStore((s) => s.isScrollLocked);
  const field = useFieldStore((s) => s.field);
  const recordingSenderRef = useRef<'me' | 'partner' | null>(null);
  const processAndTranslateAudioRef = useRef<((uri: string, durationMs: number, sender: 'me' | 'partner') => Promise<void>) | null>(null);

  const recorder = useRecorder({
    autoStopOnSilence: true,
    silenceTimeoutMs: 1500,
    onAutoStop: async ({ uri, durationMs }) => {
      const sender = recordingSenderRef.current;
      recordingSenderRef.current = null;
      setRecordingSender(null);
      if (uri && durationMs >= 500 && sender && processAndTranslateAudioRef.current) {
        await processAndTranslateAudioRef.current(uri, durationMs, sender);
      }
    },
  });
  const scrollViewRef = useRef<ScrollView>(null);

  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('session_active_default');
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [fieldModalVisible, setFieldModalVisible] = useState(false);
  const [savedTermKeys, setSavedTermKeys] = useState<Set<string>>(new Set());

  const [isProcessing, setIsProcessing] = useState(false);
  const [recordingSender, setRecordingSender] = useState<'me' | 'partner' | null>(null);
  const [sourceBadge, setSourceBadge] = useState<'local' | 'gemini' | 'offline' | null>(null);

  // Chế độ Đối thoại Trực diện Split-Screen (lật 180 độ đối diện người Đài)
  const [isSplitScreen, setIsSplitScreen] = useState(false);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [situationalModalVisible, setSituationalModalVisible] = useState(false);

  // Tra cứu từ theo ngữ cảnh
  const [wordModalVisible, setWordModalVisible] = useState(false);
  const [targetWord, setTargetWord] = useState('');
  const [targetSentence, setTargetSentence] = useState('');


  // Góp ý từ người bản xứ Đài Loan (Người Đài không nói như vậy)
  const [feedbackModalVisible, setFeedbackModalVisible] = useState(false);
  const [feedbackPhrase, setFeedbackPhrase] = useState('');

  const handleOpenFeedback = (msg: ConversationMessage) => {
    setFeedbackPhrase(msg.translation_tw || msg.spoken_text);
    setFeedbackModalVisible(true);
  };

  // Nạp danh sách phiên và tin nhắn của phiên hiện tại
  const loadSessionsAndMessages = useCallback(async () => {
    try {
      const sList = await getConversationSessions();
      setSessions(sList);
      let targetId = activeSessionId;
      if (sList.length > 0 && targetId === 'session_active_default') {
        targetId = sList[0].id;
        setActiveSessionId(targetId);
      }
      const msgs = await getConversationMessages(targetId);
      setMessages(msgs);
    } catch (e) {
      console.warn('loadSessionsAndMessages error:', e);
    }
  }, [activeSessionId]);

  useEffect(() => {
    loadSessionsAndMessages();
  }, []);

  useEffect(() => {
    // Tự động cuộn xuống đáy khi có tin nhắn mới
    if (messages.length > 0) {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 200);
    }
  }, [messages.length]);

  // Đổi phiên đối thoại từ lịch sử
  const handleSelectSession = async (sessionId: string) => {
    Haptics.selectionAsync();
    setActiveSessionId(sessionId);
    const msgs = await getConversationMessages(sessionId);
    setMessages(msgs);
    setHistoryModalVisible(false);
  };

  // Tạo cuộc hội thoại mới
  const handleStartNewSession = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const newId = `session_${Date.now()}`;
    setActiveSessionId(newId);
    setMessages([]);
    setHistoryModalVisible(false);
  };

  // Xóa một phiên đối thoại
  const handleDeleteSession = async (sessionId: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await deleteConversationSession(sessionId);
    const updated = await getConversationSessions();
    setSessions(updated);
    if (activeSessionId === sessionId) {
      if (updated.length > 0) {
        setActiveSessionId(updated[0].id);
        const msgs = await getConversationMessages(updated[0].id);
        setMessages(msgs);
      } else {
        const newId = `session_${Date.now()}`;
        setActiveSessionId(newId);
        setMessages([]);
      }
    }
  };

  // Lưu riêng thuật ngữ chuyên ngành phát hiện trong câu
  const handleSaveTerm = async (term: AITerm, msgField?: string) => {
    Haptics.selectionAsync();
    const termField = msgField || term.category || field;
    const key = term.original_term.toLowerCase();
    const exists = await termExists(term.original_term, 'term');
    if (!exists) {
      let termTopic = 'other';
      try {
        termTopic = await classifyTopicForContent(
          term.tw_traditional + ' ' + (term.vi || ''),
          term.original_term
        );
      } catch {}

      await insertVocabulary({
        original_term: term.original_term,
        tw_term: term.tw_traditional,
        tw_traditional: term.tw_traditional,
        pinyin: term.pinyin,
        vi: term.vi,
        category: termField,
        context_sentence: term.original_term,
        context_note: `Trích xuất từ hội thoại (${getField(termField).label})`,
        scope: 'domain',
        kind: 'term',
        topic: termTopic || 'other',
        source: 'conversation',
      });
    }
    setSavedTermKeys((prev) => new Set(prev).add(key));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // Bắt đầu ghi âm
  const handleStartRecording = async (sender: 'me' | 'partner') => {
    if (recorder.isRecording || isProcessing) return;
    recordingSenderRef.current = sender;
    setRecordingSender(sender);
    const ok = await recorder.startRecording();
    if (!ok) {
      recordingSenderRef.current = null;
      setRecordingSender(null);
    }
  };

  // Dừng ghi âm thủ công & Xử lý dịch ngay
  const handleStopRecording = async () => {
    if (!recorder.isRecording || !recordingSenderRef.current) return;
    const sender = recordingSenderRef.current;
    recordingSenderRef.current = null;
    setRecordingSender(null);

    const { uri, durationMs } = await recorder.stopRecording();
    if (!uri || durationMs < 500) {
      return;
    }
    await processAndTranslateAudio(uri, durationMs, sender);
  };

  // Hủy ghi âm khi nói sai hoặc muốn nói lại (không tốn quota)
  const handleCancelRecording = async () => {
    recordingSenderRef.current = null;
    setRecordingSender(null);
    await recorder.cancelRecording();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  };

  // Hàm xử lý dịch câu khi ghi âm hoàn tất (Kiến trúc 2 thì: Pass 1 tức thì, Pass 2 phân tích ngầm)
  const processAndTranslateAudio = async (
    uri: string,
    durationMs: number,
    sender: 'me' | 'partner'
  ) => {
    setIsProcessing(true);
    try {
      // 1. Nhận diện giọng nói STT (Local GPU 16kHz VAD đa ngữ trước, tự động fallback Gemini Multimodal)
      let spokenText = '';
      let source: 'local' | 'gemini' | 'offline' = 'local';

      // Dùng chế độ tự động nhận diện đa ngữ (Auto-detection) tương tự tab Học tập:
      // Whisper large-v3-turbo tự động nhận diện tiếng Trung Phồn thể Đài Loan, tiếng Việt và tiếng Anh chính xác 100%,
      // tránh ép cứng khiến Whisper bị ảo giác lặp từ hoặc sai lệch ngữ âm.
      const targetLang = undefined;

      const transcribeRes = await transcribeSpeech(uri, targetLang, field);
      if (transcribeRes?.text) {
        spokenText = transcribeRes.text.trim();
        source = transcribeRes.source;
      }

      if (!spokenText) {
        throw new Error('Không nhận diện được giọng nói. Hãy nói to và thử lại nhé!');
      }

      // 2. PASS 1: Dịch Siêu Tốc (~0.5s - 0.7s)
      const instant = await translateInstantFirstPass(spokenText, sender, field);
      setSourceBadge(instant.source);

      // Lưu tin nhắn vào DB & Cập nhật UI ngay lập tức
      const newMsg = await insertConversationMessage({
        session_id: activeSessionId,
        sender,
        spoken_text: instant.spoken_text,
        translation_tw: instant.translation_tw,
        translation_vi: instant.translation_vi,
        translation_en: instant.translation_en,
        pinyin: instant.pinyin,
        chunks: instant.chunks && instant.chunks.length > 0 ? instant.chunks : [instant.translation_tw],
        terms: [],
        field,
        is_saved: 0,
      });

      setMessages((prev) => [...prev, newMsg]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Cập nhật/Tạo session trong DB
      const preview = instant.translation_vi || instant.translation_tw || instant.spoken_text;
      await createOrUpdateConversationSession(activeSessionId, preview);
      const updatedSessions = await getConversationSessions();
      setSessions(updatedSessions);

      // Kiểm tra tùy chọn Tự động phát âm thanh
      const autoSpeak = await getAutoSpeakSetting();
      if (autoSpeak && sender === 'me') {
        speakChinese(instant.translation_tw);
      }

      // Hoàn tất hiển thị tức thì cho người dùng!
      setIsProcessing(false);

      // 3. PASS 2: Phân tích ngầm (Background Analysis) bóc tách thuật ngữ chuyên ngành & chunks
      // Tối ưu Quota: Chỉ gọi Gemini lần 2 khi cần thiết (không tốn quota nếu đã khớp offline/local, hoặc danh mục thông thường, hoặc câu quá ngắn)
      const isSimpleCategory = ['daily', 'food', 'transport'].includes(field);
      const isShortText =
        sender === 'partner'
          ? spokenText.trim().length < 6
          : spokenText.trim().split(/\s+/).length < 4;
      const shouldRunPass2 = instant.source === 'gemini' && !isSimpleCategory && !isShortText;

      if (shouldRunPass2) {
        analyzeBackgroundSecondPass(spokenText, instant.translation_tw, field, sender)
          .then((bg) => {
            if (bg && (bg.terms.length > 0 || bg.chunks.length > 0)) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === newMsg.id
                    ? {
                        ...m,
                        chunks: bg.chunks.length > 0 ? bg.chunks : m.chunks,
                        terms: bg.terms.length > 0 ? bg.terms : m.terms,
                        natural_note: bg.natural_note || m.natural_note,
                      }
                    : m
                )
              );
            }
          })
          .catch(() => {});
      }
    } catch (err: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      console.warn('processAndTranslateAudio error:', err);
      setIsProcessing(false);
    }
  };
  processAndTranslateAudioRef.current = processAndTranslateAudio;

  // Lưu câu đối thoại vào kho từ vựng FSRS để ôn tập
  const handleToggleSave = async (msg: ConversationMessage) => {
    Haptics.selectionAsync();
    try {
      const isNowSaved = await toggleSaveConversationMessage(msg.id);

      if (isNowSaved) {
        let msgTopic = 'other';
        try {
          msgTopic = await classifyTopicForContent(msg.translation_tw, msg.spoken_text);
        } catch {}

        // Lưu vào bảng vocabulary để đưa vào thuật toán FSRS
        await insertVocabulary({
          original_term: msg.translation_en || msg.spoken_text,
          tw_term: msg.translation_tw,
          tw_traditional: msg.translation_tw,
          pinyin: msg.pinyin,
          vi: msg.translation_vi,
          category: 'conversation',
          context_sentence: msg.translation_tw,
          context_note: msg.natural_note || `Hội thoại: ${msg.spoken_text}`,
          source: 'conversation',
          scope: 'communication',
          kind: 'sentence',
          topic: msgTopic || 'other',
          chunks: msg.chunks,
          natural_tw: msg.natural_tw,
          natural_pinyin: msg.natural_pinyin,
          natural_note: msg.natural_note,
        });
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, is_saved: isNowSaved ? 1 : 0 } : m))
      );
    } catch (e) {
      console.warn('handleToggleSave error:', e);
    }
  };

  // Xóa sạch hội thoại hiện tại
  const handleClearSession = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await clearConversationSession(activeSessionId);
    setMessages([]);
    const updatedSessions = await getConversationSessions();
    setSessions(updatedSessions);
  };

  // Mở popup tra từ trong ngữ cảnh khi bấm vào chunk
  const handlePressWord = (word: string, fullSentence: string) => {
    setTargetWord(word);
    setTargetSentence(fullSentence);
    setWordModalVisible(true);
  };

  // Tin nhắn mới nhất phục vụ chế độ Đối thoại Trực diện
  const latestMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const latestTw = latestMsg?.translation_tw || '';
  const latestPinyin = latestMsg?.pinyin || '';
  const latestVi = latestMsg?.translation_vi || '';

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        {/* Hàng 1: Tiêu đề & Quản lý phiên + Nút Cài đặt ở góc phải ngoài cùng */}
        <View style={styles.headerTopRow}>
          <View style={styles.screenHeaderLeft}>
            <Text style={styles.screenTitle} numberOfLines={1}>Hội thoại</Text>
          </View>

          <View style={styles.headerActions}>
            {/* Nút tạo mới */}
            <Pressable
              style={styles.newChatBtn}
              onPress={handleStartNewSession}
              hitSlop={8}
            >
              <Feather name="plus" size={14} color="#6366F1" />
              <Text style={styles.newChatText}>Mới</Text>
            </Pressable>

            {/* Nút Lịch sử phiên */}
            <Pressable
              style={styles.historyBtn}
              onPress={() => setHistoryModalVisible(true)}
              hitSlop={8}
            >
              <Feather name="clock" size={15} color="#475569" />
              {sessions.length > 0 && (
                <View style={styles.historyCountBadge}>
                  <Text style={styles.historyCountText}>{sessions.length}</Text>
                </View>
              )}
            </Pressable>

            {/* Nút Cài đặt & API Key - Luôn ở góc ngoài cùng bên phải */}
            <Pressable
              style={styles.settingsIconBtn}
              onPress={() => {
                Haptics.selectionAsync();
                setSettingsModalVisible(true);
              }}
              hitSlop={8}
            >
              <Feather name="settings" size={15} color="#475569" />
            </Pressable>

            {messages.length > 0 && (
              <Pressable onPress={handleClearSession} hitSlop={10} style={styles.clearBtn}>
                <Feather name="trash-2" size={15} color="#94A3B8" />
              </Pressable>
            )}
          </View>
        </View>

        {/* Hàng 2: Chọn Chuyên ngành & Chế độ đối diện / Hỏi AI */}
        <View style={styles.headerBottomRow}>
          <Pressable
            style={styles.fieldSelectorBadge}
            onPress={() => setFieldModalVisible(true)}
            hitSlop={6}
          >
            <Feather name="briefcase" size={13} color="#6366F1" />
            <Text style={styles.fieldSelectorText} numberOfLines={1}>
              {getField(field).label}
            </Text>
            <Feather name="chevron-down" size={13} color="#6366F1" />
          </Pressable>

          <View style={styles.headerBottomActions}>
            <Pressable
              style={styles.situationalBtnBadge}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSituationalModalVisible(true);
              }}
              hitSlop={6}
            >
              <Feather name="compass" size={13} color="#4F46E5" />
              <Text style={styles.situationalBtnText}>Hỏi AI ngữ cảnh</Text>
            </Pressable>

            {/* Nút Chế độ Trực diện (Split-Screen) */}
            <Pressable
              style={[styles.splitModeBadge, isSplitScreen && styles.splitModeBadgeActive]}
              onPress={() => {
                Haptics.selectionAsync();
                setIsSplitScreen(!isSplitScreen);
              }}
              hitSlop={6}
            >
              <Feather
                name={isSplitScreen ? 'message-square' : 'minimize-2'}
                size={13}
                color={isSplitScreen ? '#FFFFFF' : '#6366F1'}
              />
              <Text style={[styles.splitModeBadgeText, isSplitScreen && styles.splitModeBadgeTextActive]}>
                {isSplitScreen ? 'Chat dọc' : 'Trực diện'}
              </Text>
            </Pressable>

            {sourceBadge ? (
              <View style={styles.sourceBadge}>
                <Feather
                  name={sourceBadge === 'local' ? 'cpu' : 'cloud'}
                  size={11}
                  color={sourceBadge === 'local' ? '#047857' : '#6366F1'}
                />
                <Text style={styles.sourceBadgeText}>
                  {sourceBadge === 'local' ? 'GPU' : 'Cloud'}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {/* GIAO DIỆN CHÍNH: Chế độ Đối thoại Trực diện hoặc Timeline Chat */}
      {isSplitScreen ? (
        <View style={styles.splitScreenContainer}>
          {/* NỬA TRÊN: Lật ngược 180 độ đối diện người Đài Loan */}
          <View style={styles.splitPartnerHalf}>
            <View style={styles.splitInvertedWrapper}>
              <View style={styles.splitHeaderBar}>
                <View style={styles.splitRoleBadge}>
                  <Text style={styles.splitRoleBadgeText}>Đối tác</Text>
                </View>
                {latestTw ? (
                  <Pressable
                    style={styles.splitAudioBtn}
                    onPress={() => speakChinese(latestTw)}
                    hitSlop={8}
                  >
                    <Feather name="volume-2" size={17} color="#059669" />
                  </Pressable>
                ) : null}
              </View>

              <ScrollView style={styles.splitTextScroll} showsVerticalScrollIndicator={false}>
                {latestTw ? (
                  <>
                    <Text style={styles.splitGiantTwText}>{latestTw}</Text>
                    {latestPinyin ? (
                      <Text style={styles.splitPinyinText}>{latestPinyin}</Text>
                    ) : null}
                  </>
                ) : (
                  <Text style={styles.splitPlaceholderText}>點擊說話...</Text>
                )}
              </ScrollView>

              {/* Nút Micro của người Đài */}
              <View style={styles.splitMicWrapper}>
                <Pressable
                  style={[
                    styles.splitMicCircleBtn,
                    styles.splitMicCirclePartner,
                    recorder.isRecording && recordingSender === 'partner' && styles.splitMicCircleActive,
                  ]}
                  onPress={() => {
                    if (recorder.isRecording) {
                      handleStopRecording();
                    } else {
                      handleStartRecording('partner');
                    }
                  }}
                  disabled={isProcessing}
                >
                  <Feather
                    name={recorder.isRecording && recordingSender === 'partner' ? 'square' : 'mic'}
                    size={22}
                    color="#FFFFFF"
                  />
                  <Text style={styles.splitMicBtnLabel}>
                    {recorder.isRecording && recordingSender === 'partner'
                      ? `結束 (${recorder.duration}s)`
                      : '點擊說話'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>

          {/* THANH NGĂN TRUNG TÂM */}
          <View style={styles.splitCenterDivider}>
            <View style={styles.splitDividerLine} />
            <Pressable
              style={styles.splitExitPill}
              onPress={() => setIsSplitScreen(false)}
              hitSlop={6}
            >
              <Feather name="minimize-2" size={12} color="#475569" />
              <Text style={styles.splitExitText}>Thoát trực diện</Text>
            </Pressable>
            <View style={styles.splitDividerLine} />
          </View>

          {/* NỬA DƯỚI: Hướng về phía bạn */}
          <View style={styles.splitMeHalf}>
            <View style={styles.splitHeaderBar}>
              <View style={styles.splitRoleBadge}>
                <Text style={styles.splitRoleBadgeText}>Tôi</Text>
              </View>
              {latestTw ? (
                <Pressable
                  style={styles.splitAudioBtn}
                  onPress={() => speakChinese(latestTw)}
                  hitSlop={8}
                >
                  <Feather name="volume-2" size={17} color="#6366F1" />
                </Pressable>
              ) : null}
            </View>

            <ScrollView style={styles.splitTextScroll} showsVerticalScrollIndicator={false}>
              {latestVi || latestMsg?.spoken_text ? (
                <>
                  <Text style={styles.splitViText}>
                    {latestVi || latestMsg?.spoken_text}
                  </Text>
                  {latestTw ? (
                    <Text style={styles.splitTwPreviewText}>
                      {latestMsg?.sender === 'partner'
                        ? `🗣️ Đối tác nói: ${latestTw}`
                        : `👉 Dịch tiếng Đài: ${latestTw}`}
                    </Text>
                  ) : null}
                </>
              ) : (
                <Text style={styles.splitPlaceholderText}>Chạm mic để nói...</Text>
              )}
            </ScrollView>

            {/* Nút Micro của bạn */}
            <View style={styles.splitMicWrapper}>
              <Pressable
                style={[
                  styles.splitMicCircleBtn,
                  styles.splitMicCircleMe,
                  recorder.isRecording && recordingSender === 'me' && styles.splitMicCircleActive,
                ]}
                onPress={() => {
                  if (recorder.isRecording) {
                    handleStopRecording();
                  } else {
                    handleStartRecording('me');
                  }
                }}
                disabled={isProcessing}
              >
                <Feather
                  name={recorder.isRecording && recordingSender === 'me' ? 'square' : 'mic'}
                  size={22}
                  color="#FFFFFF"
                />
                <Text style={styles.splitMicBtnLabel}>
                  {recorder.isRecording && recordingSender === 'me'
                    ? `Dừng (${recorder.duration}s)`
                    : 'Tôi nói'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      ) : (
        <>
          {/* Timeline Chat */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.chatScroll}
        contentContainerStyle={styles.chatContent}
        scrollEnabled={!isScrollLocked}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {messages.length === 0 && !isProcessing && (
          <View style={styles.emptyBox}>
            <View style={styles.emptyIconWrap}>
              <Feather name="message-circle" size={36} color="#6366F1" />
            </View>
            <Text style={styles.emptyTitle}>Bắt đầu cuộc trò chuyện!</Text>
            <Text style={styles.emptyText}>
              Bấm nút tím để nói tiếng Việt/Anh, hoặc bấm nút xanh để người Đài Loan nói tiếng Trung.
              Mọi câu đối thoại sẽ được lưu để bạn học lại sau này!
            </Text>
          </View>
        )}

        {messages.map((msg) => {
          const isMe = msg.sender === 'me';
          return (
            <View
              key={msg.id}
              style={[styles.msgRow, isMe ? styles.msgRowMe : styles.msgRowPartner]}
            >
              <View
                style={[
                  styles.bubble,
                  isMe ? styles.bubbleMe : styles.bubblePartner,
                ]}
              >
                {/* Sender Tag */}
                <View style={styles.bubbleTagRow}>
                  <Text style={[styles.senderTagText, isMe ? styles.tagMe : styles.tagPartner]}>
                    {isMe ? 'Tôi nói' : 'Họ nói'}
                  </Text>
                </View>

                {/* Spoken Original (chỉ hiện khi là người dùng nói, hoặc khi đối tác nói có khác biệt với bản chuẩn hóa) */}
                {isMe || (msg.spoken_text && msg.spoken_text.trim() !== msg.translation_tw.trim()) ? (
                  <Text style={styles.spokenOriginal}>"{msg.spoken_text}"</Text>
                ) : null}

                {/* Main Chinese Sentence (Clickable) */}
                <View style={styles.chineseSentenceBox}>
                  <ClickableSentence
                    sentence={msg.translation_tw}
                    chunks={msg.chunks}
                    onPressWord={handlePressWord}
                    textStyle={[styles.chineseText, isMe ? styles.textMe : styles.textPartner]}
                    highlightColor={isMe ? '#E0E7FF' : '#D1FAE5'}
                  />
                  <Text style={styles.pinyinText}>{msg.pinyin}</Text>
                </View>

                {/* Translation Meaning (VI + EN) */}
                <View style={styles.meaningDivider} />
                {!isMe || (msg.translation_vi && msg.translation_vi.trim().toLowerCase() !== msg.spoken_text.trim().toLowerCase()) ? (
                  <Text style={styles.viMeaningText}>{msg.translation_vi}</Text>
                ) : null}
                {msg.translation_en ? (
                  <Text style={styles.enMeaningText}>{msg.translation_en}</Text>
                ) : null}

                {/* Thuật ngữ chuyên ngành phát hiện trong câu */}
                {msg.terms && msg.terms.length > 0 && (
                  <View style={styles.bubbleTermsBox}>
                    <View style={styles.bubbleTermsHeader}>
                      <Feather name="briefcase" size={12} color="#6366F1" />
                      <Text style={styles.bubbleTermsTitle}>
                        Thuật ngữ ({getField(msg.field || 'it').label}):
                      </Text>
                    </View>
                    {msg.terms.map((t, idx) => {
                      const isSaved = savedTermKeys.has(t.original_term.toLowerCase());
                      return (
                        <View key={idx} style={styles.termItemRow}>
                          <View style={styles.termItemInfo}>
                            <View style={styles.termItemTwRow}>
                              <Text style={styles.termItemTw}>{t.tw_traditional}</Text>
                              <Text style={styles.termItemPinyin}>({t.pinyin})</Text>
                            </View>
                            <Text style={styles.termItemEn} numberOfLines={2}>
                              {t.original_term}{t.vi ? ` • ${t.vi}` : ''}
                            </Text>
                          </View>
                          <Pressable
                            style={[styles.termSaveBtn, isSaved && styles.termSaveBtnActive]}
                            onPress={() => handleSaveTerm(t, msg.field)}
                            hitSlop={6}
                          >
                            <Feather
                              name={isSaved ? 'check' : 'bookmark'}
                              size={12}
                              color={isSaved ? '#059669' : '#6366F1'}
                            />
                            <Text
                              style={[
                                styles.termSaveBtnText,
                                isSaved && styles.termSaveBtnTextActive,
                              ]}
                            >
                              {isSaved ? 'Đã lưu' : 'Lưu từ'}
                            </Text>
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* Action Buttons inside Bubble */}
                <View style={styles.bubbleActionsRow}>
                  {/* Nút nghe phát âm */}
                  <Pressable
                    style={styles.actionIconBtn}
                    onPress={() => speakChinese(msg.translation_tw)}
                    hitSlop={8}
                  >
                    <Feather name="volume-2" size={15} color="#6366F1" />
                    <Text style={styles.actionBtnLabel}>Phát âm</Text>
                  </Pressable>

                  {/* Nút lưu câu để học */}
                  <Pressable
                    style={[styles.actionIconBtn, msg.is_saved === 1 && styles.actionBtnSaved]}
                    onPress={() => handleToggleSave(msg)}
                    hitSlop={8}
                  >
                    <Feather
                      name={msg.is_saved === 1 ? 'check' : 'bookmark'}
                      size={15}
                      color={msg.is_saved === 1 ? '#047857' : '#64748B'}
                    />
                    <Text
                      style={[
                        styles.actionBtnLabel,
                        msg.is_saved === 1 && { color: '#047857', fontWeight: '700' },
                      ]}
                    >
                      {msg.is_saved === 1 ? 'Đã lưu' : 'Lưu học'}
                    </Text>
                  </Pressable>

                  {/* Nút Người Đài nói khác */}
                  <Pressable
                    style={styles.actionIconBtn}
                    onPress={() => handleOpenFeedback(msg)}
                    hitSlop={8}
                  >
                    <Feather name="flag" size={14} color="#EF4444" />
                    <Text style={[styles.actionBtnLabel, { color: '#DC2626' }]}>
                      Góp ý bản xứ
                    </Text>
                  </Pressable>
                </View>
              </View>
            </View>
          );
        })}

        {isProcessing && (
          <View style={styles.processingBubble}>
            <ActivityIndicator size="small" color="#6366F1" />
            <Text style={styles.processingText}>Đang nhận diện & dịch câu...</Text>
          </View>
        )}
      </ScrollView>

      {/* Bottom Dual-Microphone Dock hoặc Thanh điều khiển khi đang ghi âm */}
      {recorder.isRecording || recordingSender !== null ? (
        <View style={styles.activeRecordingDock}>
          <View style={styles.activeRecordingStatusRow}>
            <View style={styles.pulseDot} />
            <Text style={styles.activeRecordingSenderLabel}>
              Đang nghe: {recordingSender === 'me' ? 'Tôi nói' : 'Họ nói'} • {recorder.duration}s
            </Text>
          </View>

          <View style={styles.activeRecordingButtonsRow}>
            {/* Nút Hủy / Nói lại */}
            <Pressable
              style={styles.cancelRecordBtn}
              onPress={handleCancelRecording}
              hitSlop={8}
            >
              <Feather name="x-circle" size={18} color="#EF4444" />
              <Text style={styles.cancelRecordBtnText}>✕ Hủy / Nói lại</Text>
            </Pressable>

            {/* Nút Dừng & Dịch ngay */}
            <Pressable
              style={[
                styles.finishRecordBtn,
                recordingSender === 'partner' ? styles.finishRecordBtnPartner : styles.finishRecordBtnMe,
              ]}
              onPress={handleStopRecording}
              hitSlop={8}
            >
              <Feather name="check" size={18} color="#FFFFFF" />
              <Text style={styles.finishRecordBtnText}>Dừng & Dịch ngay</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.bottomDock}>
          {/* Nút Tôi nói (VI/EN) */}
          <Pressable
            style={[styles.micBtn, styles.micBtnMe]}
            onPress={() => handleStartRecording('me')}
            disabled={isProcessing}
          >
            <Feather name="mic" size={22} color="#FFFFFF" />
            <View style={styles.micLabelWrap}>
              <Text style={styles.micMainLabel}>Tôi nói</Text>
              <Text style={styles.micSubLabel}>Việt / Anh</Text>
            </View>
          </Pressable>

          {/* Nút Họ nói (zh-TW) */}
          <Pressable
            style={[styles.micBtn, styles.micBtnPartner]}
            onPress={() => handleStartRecording('partner')}
            disabled={isProcessing}
          >
            <Feather name="user" size={22} color="#FFFFFF" />
            <View style={styles.micLabelWrap}>
              <Text style={styles.micMainLabel}>Họ nói</Text>
              <Text style={styles.micSubLabel}>中文 (Đài Loan)</Text>
            </View>
          </Pressable>
        </View>
      )}
        </>
      )}

      {/* Modal Chọn Lĩnh vực chuyên ngành */}
      <FieldPickerModal
        visible={fieldModalVisible}
        onClose={() => setFieldModalVisible(false)}
      />

      {/* Modal Lịch sử 5 phiên đối thoại */}
      <Modal
        visible={historyModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setHistoryModalVisible(false)}
      >
        <View style={styles.historyModalOverlay}>
          <Pressable
            style={styles.historyModalBackdrop}
            onPress={() => setHistoryModalVisible(false)}
          />
          <View style={styles.historySheetContainer}>
            <View style={styles.sheetIndicator} />

            <View style={styles.historyHeader}>
              <View style={styles.historyHeaderLeft}>
                <Feather name="clock" size={18} color="#475569" />
                <Text style={styles.historyTitle}>Lịch sử đối thoại</Text>
                <View style={styles.historyBadge}>
                  <Text style={styles.historyBadgeText}>{sessions.length}/5</Text>
                </View>
              </View>
              <Pressable
                onPress={() => setHistoryModalVisible(false)}
                hitSlop={10}
              >
                <Feather name="x" size={18} color="#64748B" />
              </Pressable>
            </View>

            <Text style={styles.historySubtitle}>
              Tối đa 5 phiên đối thoại gần nhất được lưu tự động:
            </Text>

            <ScrollView style={styles.historyListScroll} showsVerticalScrollIndicator={false}>
              {sessions.length === 0 ? (
                <View style={styles.historyEmpty}>
                  <Text style={styles.historyEmptyText}>Chưa có phiên hội thoại nào.</Text>
                </View>
              ) : (
                sessions.map((s) => {
                  const isActive = s.id === activeSessionId;
                  return (
                    <Pressable
                      key={s.id}
                      style={[styles.sessionCard, isActive && styles.sessionCardActive]}
                      onPress={() => handleSelectSession(s.id)}
                    >
                      <View style={[styles.sessionIconWrap, isActive && styles.sessionIconWrapActive]}>
                        <Feather
                          name="message-circle"
                          size={18}
                          color={isActive ? '#6366F1' : '#64748B'}
                        />
                      </View>
                      <View style={styles.sessionInfo}>
                        <View style={styles.sessionTitleRow}>
                          <Text
                            style={[styles.sessionTitle, isActive && styles.sessionTitleActive]}
                            numberOfLines={1}
                          >
                            {s.title || 'Cuộc đối thoại'}
                          </Text>
                          {isActive && (
                            <View style={styles.activeTag}>
                              <Text style={styles.activeTagText}>Hiện tại</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.sessionMeta}>
                          {s.turn_count} lượt nói • {formatSessionTime(s.updated_at)}
                        </Text>
                      </View>
                      <Pressable
                        style={styles.sessionDeleteBtn}
                        onPress={() => handleDeleteSession(s.id)}
                        hitSlop={10}
                      >
                        <Feather name="trash-2" size={16} color="#94A3B8" />
                      </Pressable>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>

            <Pressable
              style={styles.startNewSessionBtn}
              onPress={handleStartNewSession}
            >
              <Feather name="plus" size={18} color="#FFFFFF" />
              <Text style={styles.startNewSessionBtnText}>Bắt đầu hội thoại mới</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Word In-Context Lookup Modal */}
      <WordContextModal
        visible={wordModalVisible}
        word={targetWord}
        fullSentence={targetSentence}
        fieldKey={field}
        onClose={() => setWordModalVisible(false)}
      />


      {/* Modal Góp ý của người bản xứ Đài Loan (Người Đài không nói như vậy) */}
      <NativeFeedbackModal
        visible={feedbackModalVisible}
        onClose={() => setFeedbackModalVisible(false)}
        originalPhrase={feedbackPhrase}
        fieldKey={field}
      />

      {/* Modal Cài đặt & Quản lý API Key */}
      <ApiKeySettingsModal
        visible={settingsModalVisible}
        onClose={() => setSettingsModalVisible(false)}
      />

      {/* Modal Diễn đạt theo ngữ cảnh bản xứ Đài Loan */}
      <SituationalAssistantModal
        visible={situationalModalVisible}
        onClose={() => setSituationalModalVisible(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FFFDF9',
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  screenHeaderLeft: {
    flexShrink: 0,
    minWidth: 92,
  },
  screenTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.2,
  },
  screenSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
  headerBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  fieldSelectorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EEF2FF',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  fieldSelectorText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4338CA',
  },
  situationalBtnBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  situationalBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  headerBottomActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    justifyContent: 'flex-end',
  },
  splitModeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  splitModeBadgeActive: {
    backgroundColor: '#6366F1',
    borderColor: '#6366F1',
  },
  splitModeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6366F1',
  },
  splitModeBadgeTextActive: {
    color: '#FFFFFF',
  },
  settingsIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // ─── Split Screen Styles ───
  splitScreenContainer: {
    flex: 1,
    backgroundColor: '#FFFDF9',
  },
  splitPartnerHalf: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  splitInvertedWrapper: {
    flex: 1,
    transform: [{ rotate: '180deg' }],
    justifyContent: 'space-between',
  },
  splitHeaderBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  splitRoleBadge: {
    backgroundColor: '#EEF2FF',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  splitRoleBadgeText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
  },
  splitAudioBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  splitTextScroll: {
    flex: 1,
    marginVertical: 8,
  },
  splitGiantTwText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    lineHeight: 34,
    letterSpacing: 0.5,
  },
  splitPinyinText: {
    fontSize: 13,
    color: '#6366F1',
    marginTop: 4,
    lineHeight: 18,
    fontWeight: '600',
  },
  splitPlaceholderText: {
    fontSize: 15,
    color: '#94A3B8',
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  splitMicWrapper: {
    alignItems: 'center',
    paddingTop: 6,
  },
  splitMicCircleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 24,
    gap: 8,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  splitMicCirclePartner: {
    backgroundColor: '#059669',
  },
  splitMicCircleMe: {
    backgroundColor: '#6366F1',
  },
  splitMicCircleActive: {
    backgroundColor: '#EF4444',
  },
  splitMicBtnLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  splitCenterDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    paddingVertical: 5,
    paddingHorizontal: 16,
    gap: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#E2E8F0',
  },
  splitDividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  splitExitPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  splitExitText: {
    color: '#475569',
    fontSize: 11,
    fontWeight: '700',
  },
  splitMeHalf: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    padding: 16,
    justifyContent: 'space-between',
  },
  splitViText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 26,
  },
  splitTwPreviewText: {
    fontSize: 14,
    color: '#6366F1',
    marginTop: 6,
    lineHeight: 20,
    fontWeight: '600',
  },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sourceBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  historyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  historyCountBadge: {
    backgroundColor: '#6366F1',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginLeft: 3,
  },
  historyCountText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  newChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  newChatText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4338CA',
  },
  clearBtn: {
    padding: 6,
  },
  chatScroll: {
    flex: 1,
  },
  chatContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 110,
  },
  emptyBox: {
    paddingVertical: 60,
    paddingHorizontal: 32,
    alignItems: 'center',
  },
  emptyIconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    borderWidth: 1.5,
    borderColor: '#C7D2FE',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1E293B',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
  },
  msgRow: {
    marginVertical: 8,
    flexDirection: 'row',
  },
  msgRowMe: {
    justifyContent: 'flex-end',
  },
  msgRowPartner: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '88%',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1.5,
  },
  bubbleMe: {
    backgroundColor: '#F5F3FF',
    borderColor: '#DDD6FE',
    borderBottomRightRadius: 4,
  },
  bubblePartner: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderBottomLeftRadius: 4,
  },
  bubbleTagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  senderTagText: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tagMe: {
    color: '#6366F1',
  },
  tagPartner: {
    color: '#059669',
  },
  spokenOriginal: {
    fontSize: 13,
    fontStyle: 'italic',
    color: '#64748B',
    marginBottom: 8,
  },
  chineseSentenceBox: {
    marginBottom: 8,
  },
  chineseText: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 28,
  },
  textMe: {
    color: '#1E1B4B',
  },
  textPartner: {
    color: '#064E3B',
  },
  pinyinText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6366F1',
    marginTop: 4,
    letterSpacing: 0.5,
  },
  naturalBox: {
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    padding: 10,
    marginTop: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  naturalTagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  naturalTagLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  naturalTagLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#B45309',
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
  naturalTwText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#92400E',
  },
  naturalPinyinText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#B45309',
    marginTop: 1,
    letterSpacing: 0.5,
  },
  naturalNoteText: {
    fontSize: 12,
    color: '#78350F',
    marginTop: 2,
  },
  meaningDivider: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.06)',
    marginVertical: 8,
  },
  viMeaningText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    lineHeight: 20,
  },
  enMeaningText: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
  },
  bubbleTermsBox: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  bubbleTermsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  bubbleTermsTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6366F1',
    textTransform: 'uppercase',
  },
  termItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
  },
  termItemInfo: {
    flex: 1,
  },
  termItemTwRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 4,
  },
  termItemTw: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  termItemPinyin: {
    fontSize: 11,
    color: '#6366F1',
    fontWeight: '600',
  },
  termItemEn: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 1,
  },
  termSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  termSaveBtnActive: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  termSaveBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4338CA',
  },
  termSaveBtnTextActive: {
    color: '#059669',
  },
  bubbleActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
  },
  actionIconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  actionBtnSaved: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
  },
  actionBtnNatural: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  actionBtnLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  processingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginVertical: 12,
  },
  processingText: {
    fontSize: 13,
    color: '#6366F1',
    fontWeight: '600',
  },
  bottomDock: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  micBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 12,
    borderRadius: 16,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  micBtnMe: {
    backgroundColor: '#6366F1',
  },
  micBtnPartner: {
    backgroundColor: '#059669',
  },
  micBtnRecording: {
    backgroundColor: '#4338CA',
    transform: [{ scale: 0.98 }],
  },
  micBtnRecordingPartner: {
    backgroundColor: '#047857',
    transform: [{ scale: 0.98 }],
  },
  micLabelWrap: {
    alignItems: 'flex-start',
  },
  micMainLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  micSubLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: 'rgba(255,255,255,0.8)',
  },
  activeRecordingDock: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 6,
    gap: 8,
  },
  activeRecordingStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  activeRecordingSenderLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#991B1B',
    flex: 1,
    marginLeft: 8,
  },
  vadBadge: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  vadBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B91C1C',
  },
  activeRecordingButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelRecordBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FEF2F2',
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
    paddingVertical: 12,
    borderRadius: 14,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  cancelRecordBtnText: {
    color: '#DC2626',
    fontSize: 14,
    fontWeight: '800',
  },
  finishRecordBtn: {
    flex: 1.2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 14,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  finishRecordBtnMe: {
    backgroundColor: '#6366F1',
  },
  finishRecordBtnPartner: {
    backgroundColor: '#059669',
  },
  finishRecordBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  pulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#EF4444',
  },
  historyModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'flex-end',
  },
  historyModalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  historySheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 24,
    maxHeight: '80%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 20,
  },
  sheetIndicator: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E8F0',
    alignSelf: 'center',
    marginBottom: 12,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  historyHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  historyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  historyBadge: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  historyBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6366F1',
  },
  historySubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 14,
  },
  historyListScroll: {
    flexGrow: 0,
    marginBottom: 14,
  },
  historyEmpty: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  historyEmptyText: {
    fontSize: 13,
    color: '#94A3B8',
  },
  sessionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: '#F1F5F9',
  },
  sessionCardActive: {
    backgroundColor: '#EEF2FF',
    borderColor: '#6366F1',
  },
  sessionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  sessionIconWrapActive: {
    backgroundColor: '#E0E7FF',
  },
  sessionInfo: {
    flex: 1,
  },
  sessionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sessionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
    flex: 1,
  },
  sessionTitleActive: {
    color: '#4338CA',
  },
  activeTag: {
    backgroundColor: '#6366F1',
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  activeTagText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  sessionMeta: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  sessionDeleteBtn: {
    padding: 6,
    marginLeft: 6,
  },
  startNewSessionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#6366F1',
    borderRadius: 14,
    paddingVertical: 13,
  },
  startNewSessionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});
