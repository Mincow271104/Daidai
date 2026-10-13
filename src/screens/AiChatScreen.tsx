import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  AiChatSession,
  AiChatMessage,
  AiChatFeedback,
} from '../types';
import {
  getAiChatSessions,
  createAiChatSession,
  deleteAiChatSession,
  getAiChatMessages,
  insertAiChatMessage,
  updateAiChatMessageFeedback,
  insertAiChatFeedback,
  getRecentAiChatFeedbacks,
  insertVocabulary,
  updateAiChatSessionTitle,
} from '../database/repository';
import { sendAiChatMessage, transcribeSpeech } from '../services/api';
import { useRecorder } from '../hooks/useRecorder';
import { speakChinese } from '../utils/speak';
import { ensureOnline } from '../services/network';

export function AiChatScreen() {
  const [sessions, setSessions] = useState<AiChatSession[]>([]);
  const [currentSession, setCurrentSession] = useState<AiChatSession | null>(null);
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);

  // Modal đóng góp ý kiến / sửa lỗi (Feedback)
  const [feedbackModalVisible, setFeedbackModalVisible] = useState(false);
  const [feedbackTargetMessage, setFeedbackTargetMessage] = useState<AiChatMessage | null>(null);
  const [userCorrectionText, setUserCorrectionText] = useState('');
  const [userReasonText, setUserReasonText] = useState('');

  // Thông báo nhỏ khi lưu từ vựng
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flatListRef = useRef<FlatList<AiChatMessage>>(null);

  // Voice recording qua useRecorder
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

  const showToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2500);
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const list = await getAiChatSessions(5);
      setSessions(list);
      if (!currentSession && list.length > 0) {
        setCurrentSession(list[0]);
      }
    } catch (e) {
      console.warn('loadSessions error:', e);
    }
  }, [currentSession]);

  const loadMessages = useCallback(async (sessionId: string) => {
    try {
      const msgs = await getAiChatMessages(sessionId);
      setMessages(msgs);
    } catch (e) {
      console.warn('loadMessages error:', e);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (currentSession) {
      loadMessages(currentSession.id);
    } else {
      setMessages([]);
    }
  }, [currentSession, loadMessages]);

  const handleStartNewSession = async () => {
    Haptics.selectionAsync();
    try {
      const newSess = await createAiChatSession('Hội thoại mới');
      setCurrentSession(newSess);
      setMessages([]);
      await loadSessions();
      setHistoryModalVisible(false);
    } catch (e) {
      console.warn('handleStartNewSession error:', e);
    }
  };

  const handleSelectSession = (sess: AiChatSession) => {
    Haptics.selectionAsync();
    setCurrentSession(sess);
    setHistoryModalVisible(false);
  };

  const handleDeleteSession = async (sessId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await deleteAiChatSession(sessId);
      const remaining = sessions.filter((s) => s.id !== sessId);
      setSessions(remaining);
      if (currentSession?.id === sessId) {
        setCurrentSession(remaining.length > 0 ? remaining[0] : null);
      }
    } catch (e) {
      console.warn('handleDeleteSession error:', e);
    }
  };

  const handleVoiceTranscribe = async (audioUri: string) => {
    setIsTranscribing(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const res = await transcribeSpeech(audioUri, 'vi');
      const text = res?.text?.trim() || '';
      if (text) {
        setInputText((prev) => (prev ? `${prev} ${text}` : text));
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

  const handleSendMessage = async () => {
    const text = inputText.trim();
    if (!text || isProcessing) return;

    const online = await ensureOnline('Gửi tin nhắn');
    if (!online) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setInputText('');
    setIsProcessing(true);

    try {
      let session = currentSession;
      let isFirstMessageInSession = false;

      // Nếu chưa có phiên làm việc thì tạo phiên mới
      if (!session) {
        const title = text.slice(0, 30);
        session = await createAiChatSession(title);
        setCurrentSession(session);
        isFirstMessageInSession = true;
      } else if (session.title === 'Hội thoại mới' && messages.length === 0) {
        const newTitle = text.slice(0, 30);
        await updateAiChatSessionTitle(session.id, newTitle);
        session.title = newTitle;
      }

      // Lưu tin nhắn của người dùng
      const userMsg = await insertAiChatMessage({
        session_id: session.id,
        role: 'user',
        content: text,
      });

      const updatedMessages = [...messages, userMsg];
      setMessages(updatedMessages);

      // Chuẩn bị rolling history (tối đa 4 tin nhắn gần nhất trước câu này)
      const rollingHistory = messages.slice(-4).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Lấy danh sách feedback sửa lỗi gần nhất để AI học hỏi
      const recentFeedbacks = await getRecentAiChatFeedbacks(4);

      // Gọi API Gemini
      const reply = await sendAiChatMessage(text, rollingHistory, recentFeedbacks);

      // Lưu câu trả lời của trợ lý
      const botMsg = await insertAiChatMessage({
        session_id: session.id,
        role: 'assistant',
        content: reply.content || '...',
        tw: reply.tw,
        pinyin: reply.pinyin,
        vi: reply.vi,
        explanation: reply.explanation,
      });

      setMessages((prev) => [...prev, botMsg]);
      await loadSessions();

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      Alert.alert('Lỗi', err.message || 'Không thể nhận phản hồi từ Trợ lý AI.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePositiveFeedback = async (msg: AiChatMessage) => {
    Haptics.selectionAsync();
    try {
      const nextFeedback = msg.feedback === 1 ? 0 : 1;
      await updateAiChatMessageFeedback(msg.id, nextFeedback);
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, feedback: nextFeedback } : m))
      );
      if (nextFeedback === 1) {
        showToast('Cảm ơn bạn đã xác nhận câu trả lời chuẩn!');
      }
    } catch (e) {
      console.warn('Feedback error:', e);
    }
  };

  const handleOpenNegativeFeedback = (msg: AiChatMessage) => {
    Haptics.selectionAsync();
    setFeedbackTargetMessage(msg);
    setUserCorrectionText('');
    setUserReasonText('');
    setFeedbackModalVisible(true);
  };

  const handleSubmitNegativeFeedback = async () => {
    if (!feedbackTargetMessage) return;
    const correction = userCorrectionText.trim();
    if (!correction) {
      Alert.alert('Thông báo', 'Vui lòng nhập cách diễn đạt chuẩn hoặc lý do góp ý.');
      return;
    }

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      // Tìm câu hỏi tương ứng của người dùng
      const msgIdx = messages.findIndex((m) => m.id === feedbackTargetMessage.id);
      let originalQuery = '';
      if (msgIdx > 0 && messages[msgIdx - 1].role === 'user') {
        originalQuery = messages[msgIdx - 1].content;
      }

      await insertAiChatFeedback({
        message_id: feedbackTargetMessage.id,
        original_query: originalQuery || feedbackTargetMessage.content,
        bot_response: feedbackTargetMessage.tw
          ? `${feedbackTargetMessage.tw} (${feedbackTargetMessage.content})`
          : feedbackTargetMessage.content,
        user_correction: correction,
        reason: userReasonText.trim() || undefined,
      });

      await updateAiChatMessageFeedback(feedbackTargetMessage.id, -1, correction);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === feedbackTargetMessage.id
            ? { ...m, feedback: -1, feedback_note: correction }
            : m
        )
      );

      setFeedbackModalVisible(false);
      setFeedbackTargetMessage(null);
      showToast('Đã ghi nhận góp ý! Trợ lý AI sẽ ghi nhớ để trả lời chuẩn hơn.');
    } catch (e) {
      console.warn('Submit feedback error:', e);
    }
  };

  const handleSaveToVocab = async (msg: AiChatMessage) => {
    if (!msg.tw) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await insertVocabulary({
        original_term: msg.vi || msg.tw,
        tw_term: msg.tw,
        tw_traditional: msg.tw,
        pinyin: msg.pinyin || '',
        category: 'general',
        context_sentence: msg.tw,
        context_note: msg.explanation || undefined,
        source: 'ai_chat',
      });
      showToast('Đã lưu vào Kho từ vựng!');
    } catch (e) {
      console.warn('Save to vocab error:', e);
    }
  };

  const renderMessageItem = ({ item }: { item: AiChatMessage }) => {
    const isUser = item.role === 'user';

    if (isUser) {
      return (
        <View style={styles.userMessageRow}>
          <View style={styles.userBubble}>
            <Text style={styles.userMessageText}>{item.content}</Text>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.botMessageRow}>
        <View style={styles.botBubble}>
          {/* Nội dung hội thoại / giải thích của bot */}
          <Text style={styles.botMessageText}>{item.content}</Text>

          {/* Card từ vựng / câu mẫu Phồn thể Đài Loan nếu có */}
          {item.tw && (
            <View style={styles.phraseCard}>
              <View style={styles.phraseCardHeader}>
                <View style={styles.phraseBadge}>
                  <Text style={styles.phraseBadgeText}>Chuẩn Đài Loan</Text>
                </View>

                <View style={styles.phraseActions}>
                  <Pressable
                    style={styles.iconBtn}
                    onPress={() => speakChinese(item.tw!)}
                    hitSlop={8}
                  >
                    <Feather name="volume-2" size={16} color="#475569" />
                  </Pressable>

                  <Pressable
                    style={styles.iconBtn}
                    onPress={() => handleSaveToVocab(item)}
                    hitSlop={8}
                  >
                    <Feather name="plus-circle" size={16} color="#475569" />
                  </Pressable>
                </View>
              </View>

              <Text style={styles.phraseTwText}>{item.tw}</Text>

              {item.pinyin && <Text style={styles.phrasePinyinText}>{item.pinyin}</Text>}

              {item.vi && <Text style={styles.phraseViText}>{item.vi}</Text>}

              {item.explanation && (
                <View style={styles.explanationBox}>
                  <Text style={styles.explanationText}>💡 {item.explanation}</Text>
                </View>
              )}
            </View>
          )}

          {/* Dải nút đánh giá phản hồi (Monochrome, tối giản) */}
          <View style={styles.feedbackRow}>
            <Pressable
              style={[
                styles.feedbackBtn,
                item.feedback === 1 && styles.feedbackBtnActive,
              ]}
              onPress={() => handlePositiveFeedback(item)}
              hitSlop={6}
            >
              <Feather
                name="thumbs-up"
                size={13}
                color={item.feedback === 1 ? '#4F46E5' : '#64748B'}
              />
              <Text
                style={[
                  styles.feedbackText,
                  item.feedback === 1 && styles.feedbackTextActive,
                ]}
              >
                Chuẩn
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.feedbackBtn,
                item.feedback === -1 && styles.feedbackBtnNegativeActive,
              ]}
              onPress={() => handleOpenNegativeFeedback(item)}
              hitSlop={6}
            >
              <Feather
                name="thumbs-down"
                size={13}
                color={item.feedback === -1 ? '#475569' : '#64748B'}
              />
              <Text
                style={[
                  styles.feedbackText,
                  item.feedback === -1 && styles.feedbackTextNegativeActive,
                ]}
              >
                Chưa chuẩn
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {/* Header thanh lịch, tối giản */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Trợ lý AI</Text>
          <View style={styles.twTag}>
            <Text style={styles.twTagText}>繁體</Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          {/* Nút xem lịch sử 5 phiên */}
          <Pressable
            style={styles.headerActionBtn}
            onPress={() => {
              Haptics.selectionAsync();
              setHistoryModalVisible(true);
            }}
            hitSlop={8}
          >
            <Feather name="clock" size={17} color="#475569" />
            {sessions.length > 0 && (
              <View style={styles.sessionCountBadge}>
                <Text style={styles.sessionCountText}>{sessions.length}</Text>
              </View>
            )}
          </Pressable>

          {/* Nút tạo cuộc hội thoại mới */}
          <Pressable
            style={styles.headerActionBtn}
            onPress={handleStartNewSession}
            hitSlop={8}
          >
            <Feather name="plus" size={18} color="#475569" />
          </Pressable>
        </View>
      </View>

      {/* Thông báo dạng Toast nhỏ khi lưu từ */}
      {toastMessage && (
        <View style={styles.toastContainer}>
          <Text style={styles.toastText}>{toastMessage}</Text>
        </View>
      )}

      {/* Danh sách tin nhắn */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessageItem}
          keyExtractor={(m) => m.id}
          contentContainerStyle={[
            styles.messagesContainer,
            messages.length === 0 && styles.emptyContainer,
          ]}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIconBox}>
                <Feather name="message-square" size={32} color="#64748B" />
              </View>
              <Text style={styles.emptyTitle}>Trợ lý tiếng Trung Phồn thể</Text>
              <Text style={styles.emptySubtitle}>
                Hỏi từ vựng, diễn đạt theo ngữ cảnh, hoặc phân biệt cách dùng từ chuẩn bản xứ Đài Loan.
              </Text>
            </View>
          }
        />

        {/* Trạng thái AI đang suy nghĩ */}
        {isProcessing && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#6366F1" />
            <Text style={styles.loadingText}>Trợ lý AI đang soạn câu trả lời...</Text>
          </View>
        )}

        {/* Thanh nhập liệu phía dưới */}
        <View style={styles.inputBar}>
          <Pressable
            style={[
              styles.micBtn,
              recorder.isRecording && styles.micBtnActive,
              isTranscribing && styles.micBtnTranscribing,
            ]}
            onPress={toggleRecording}
            disabled={isProcessing || isTranscribing}
          >
            {isTranscribing ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Feather
                name={recorder.isRecording ? 'square' : 'mic'}
                size={18}
                color={recorder.isRecording ? '#FFFFFF' : '#475569'}
              />
            )}
          </Pressable>

          <TextInput
            style={styles.textInput}
            value={inputText}
            onChangeText={setInputText}
            placeholder={
              recorder.isRecording
                ? 'Đang lắng nghe...'
                : 'Nhập câu hỏi hoặc tình huống...'
            }
            placeholderTextColor="#94A3B8"
            multiline
            maxLength={600}
            editable={!isProcessing}
          />

          <Pressable
            style={[
              styles.sendBtn,
              (!inputText.trim() || isProcessing) && styles.sendBtnDisabled,
            ]}
            onPress={handleSendMessage}
            disabled={!inputText.trim() || isProcessing}
          >
            <Feather name="arrow-up" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* Modal Lịch sử 5 phiên trò chuyện gần nhất */}
      <Modal
        visible={historyModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setHistoryModalVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setHistoryModalVisible(false)}
        >
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderTitleRow}>
                <Feather name="clock" size={17} color="#475569" />
                <Text style={styles.modalTitle}>Hội thoại gần đây (Tối đa 5)</Text>
              </View>
              <Pressable
                onPress={() => setHistoryModalVisible(false)}
                hitSlop={8}
              >
                <Feather name="x" size={20} color="#64748B" />
              </Pressable>
            </View>

            <View style={styles.sessionList}>
              {sessions.map((s, idx) => {
                const isActive = currentSession?.id === s.id;
                const dateStr = new Date(s.updated_at).toLocaleDateString('vi-VN', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                });

                return (
                  <View
                    key={s.id}
                    style={[styles.sessionItem, isActive && styles.sessionItemActive]}
                  >
                    <Pressable
                      style={styles.sessionItemContent}
                      onPress={() => handleSelectSession(s)}
                    >
                      <Text
                        style={[
                          styles.sessionTitle,
                          isActive && styles.sessionTitleActive,
                        ]}
                        numberOfLines={1}
                      >
                        {s.title || `Hội thoại #${idx + 1}`}
                      </Text>
                      <Text style={styles.sessionDate}>{dateStr}</Text>
                    </Pressable>

                    <Pressable
                      style={styles.deleteSessionBtn}
                      onPress={() => handleDeleteSession(s.id)}
                      hitSlop={8}
                    >
                      <Feather name="trash-2" size={14} color="#94A3B8" />
                    </Pressable>
                  </View>
                );
              })}

              {sessions.length === 0 && (
                <Text style={styles.emptySessionText}>Chưa có hội thoại nào được lưu.</Text>
              )}
            </View>

            <Pressable
              style={styles.newSessionModalBtn}
              onPress={handleStartNewSession}
            >
              <Feather name="plus" size={16} color="#FFFFFF" />
              <Text style={styles.newSessionModalBtnText}>Bắt đầu hội thoại mới</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Modal Góp ý câu chưa chuẩn để AI tự học hỏi */}
      <Modal
        visible={feedbackModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setFeedbackModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setFeedbackModalVisible(false)}
          >
            <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalHeader}>
                <View style={styles.modalHeaderTitleRow}>
                  <Feather name="edit-3" size={17} color="#475569" />
                  <Text style={styles.modalTitle}>Góp ý & Sửa lỗi cho AI</Text>
                </View>
                <Pressable
                  onPress={() => setFeedbackModalVisible(false)}
                  hitSlop={8}
                >
                  <Feather name="x" size={20} color="#64748B" />
                </Pressable>
              </View>

              <Text style={styles.feedbackGuideText}>
                Trợ lý AI sẽ ghi nhớ câu sửa này và áp dụng chuẩn ngữ cảnh Đài Loan cho các lần hỏi tiếp theo.
              </Text>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Cách diễn đạt chuẩn của người Đài (*)</Text>
                <TextInput
                  style={styles.feedbackInput}
                  value={userCorrectionText}
                  onChangeText={setUserCorrectionText}
                  placeholder="Ví dụ: Người Đài thường nói là..."
                  placeholderTextColor="#94A3B8"
                  multiline
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Lý do hoặc ghi chú (không bắt buộc)</Text>
                <TextInput
                  style={[styles.feedbackInput, { height: 60 }]}
                  value={userReasonText}
                  onChangeText={setUserReasonText}
                  placeholder="Ví dụ: Từ này bên Đại Lục hay dùng, Đài Loan dùng từ khác..."
                  placeholderTextColor="#94A3B8"
                  multiline
                />
              </View>

              <View style={styles.modalBtnRow}>
                <Pressable
                  style={styles.modalCancelBtn}
                  onPress={() => setFeedbackModalVisible(false)}
                >
                  <Text style={styles.modalCancelBtnText}>Hủy</Text>
                </Pressable>

                <Pressable
                  style={styles.modalSubmitBtn}
                  onPress={handleSubmitNegativeFeedback}
                >
                  <Text style={styles.modalSubmitBtnText}>Lưu góp ý</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FFFDF9',
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  twTag: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E0E7FF',
  },
  twTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4F46E5',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerActionBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  sessionCountBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    backgroundColor: '#6366F1',
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionCountText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  toastContainer: {
    position: 'absolute',
    top: 60,
    left: 20,
    right: 20,
    zIndex: 99,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  messagesContainer: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 14,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyWrap: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyIconBox: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
  },
  userMessageRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  userBubble: {
    maxWidth: '82%',
    backgroundColor: '#4F46E5',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderBottomRightRadius: 4,
  },
  userMessageText: {
    fontSize: 14,
    color: '#FFFFFF',
    lineHeight: 20,
  },
  botMessageRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  botBubble: {
    maxWidth: '92%',
    backgroundColor: '#FFFFFF',
    padding: 14,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  botMessageText: {
    fontSize: 14,
    color: '#1E293B',
    lineHeight: 21,
  },
  phraseCard: {
    marginTop: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  phraseCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  phraseBadge: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  phraseBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4F46E5',
  },
  phraseActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    padding: 4,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  phraseTwText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 2,
    letterSpacing: 0.5,
  },
  phrasePinyinText: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
  },
  phraseViText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
    marginTop: 4,
  },
  explanationBox: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  explanationText: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 17,
  },
  feedbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  feedbackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#F8FAFC',
  },
  feedbackBtnActive: {
    backgroundColor: '#EEF2FF',
  },
  feedbackBtnNegativeActive: {
    backgroundColor: '#F1F5F9',
  },
  feedbackText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '600',
  },
  feedbackTextActive: {
    color: '#4F46E5',
  },
  feedbackTextNegativeActive: {
    color: '#0F172A',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  loadingText: {
    fontSize: 12,
    color: '#6366F1',
    fontWeight: '600',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    gap: 8,
  },
  micBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  micBtnActive: {
    backgroundColor: '#EF4444',
  },
  micBtnTranscribing: {
    backgroundColor: '#6366F1',
  },
  textInput: {
    flex: 1,
    minHeight: 38,
    maxHeight: 100,
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    color: '#0F172A',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#4F46E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  sessionList: {
    marginVertical: 12,
    gap: 8,
  },
  sessionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  sessionItemActive: {
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
  },
  sessionItemContent: {
    flex: 1,
  },
  sessionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  sessionTitleActive: {
    color: '#4F46E5',
  },
  sessionDate: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 2,
  },
  deleteSessionBtn: {
    padding: 8,
  },
  emptySessionText: {
    textAlign: 'center',
    color: '#94A3B8',
    fontSize: 13,
    paddingVertical: 16,
  },
  newSessionModalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#4F46E5',
    paddingVertical: 12,
    borderRadius: 12,
    marginTop: 6,
  },
  newSessionModalBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  feedbackGuideText: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
    marginVertical: 10,
  },
  fieldGroup: {
    marginTop: 10,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  feedbackInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    color: '#0F172A',
    minHeight: 70,
    textAlignVertical: 'top',
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  modalCancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  modalSubmitBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: '#4F46E5',
    alignItems: 'center',
  },
  modalSubmitBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
