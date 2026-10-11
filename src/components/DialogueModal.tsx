import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { SCENARIOS, Scenario } from '../constants/scenarios';
import { SpeakPractice } from './SpeakPractice';
import {
  DialogueTurn,
  CustomScenario,
  DialogueOption,
} from '../types';
import {
  generateFullDialogueScenario,
} from '../services/api';
import {
  insertVocabulary,
  termExists,
  getCustomScenarios,
  insertCustomScenario,
  deleteCustomScenario,
} from '../database/repository';
import { speakChinese } from '../utils/speak';

interface DialogueModalProps {
  visible: boolean;
  onClose: () => void;
  onSaveSentence?: () => void;
}

type DialogueStage = 'select_scenario' | 'in_dialogue' | 'recap';

export function DialogueModal({ visible, onClose, onSaveSentence }: DialogueModalProps) {
  const [stage, setStage] = useState<DialogueStage>('select_scenario');
  const [activeScenario, setActiveScenario] = useState<Scenario | CustomScenario | null>(null);

  // Kịch bản tự tạo đã lưu trong máy
  const [customScenarios, setCustomScenarios] = useState<CustomScenario[]>([]);
  const [showCreateCustom, setShowCreateCustom] = useState(false);
  const [customPromptInput, setCustomPromptInput] = useState('');
  const [customRoleInput, setCustomRoleInput] = useState('');
  const [isGeneratingCustom, setIsGeneratingCustom] = useState(false);
  const [loadingScenarioId, setLoadingScenarioId] = useState<string | null>(null);
  const isGeneratingRef = useRef(false);

  // Danh sách toàn bộ các lượt của kịch bản hiện tại (Tối ưu 1: Single-call / Prebaked)
  const [allTurns, setAllTurns] = useState<DialogueTurn[]>([]);
  const [turnIndex, setTurnIndex] = useState(1);
  const [currentTurn, setCurrentTurn] = useState<DialogueTurn | null>(null);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(null);
  const [history, setHistory] = useState<{ role: 'character' | 'user'; text: string }[]>([]);

  // Các câu đã học trong phiên để lưu vào kho
  const [recapSentences, setRecapSentences] = useState<{ tw: string; pinyin: string; vi: string; en: string }[]>([]);
  const [savedTwSet, setSavedTwSet] = useState<Set<string>>(new Set());

  // Nạp kịch bản tự tạo từ SQLite
  const loadCustomList = useCallback(async () => {
    try {
      const list = await getCustomScenarios();
      setCustomScenarios(list);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setStage('select_scenario');
      setActiveScenario(null);
      setCurrentTurn(null);
      setAllTurns([]);
      setHistory([]);
      setRecapSentences([]);
      setSavedTwSet(new Set());
      setSelectedOptionIndex(null);
      setShowCreateCustom(false);
      setCustomPromptInput('');
      setCustomRoleInput('');
      setLoadingScenarioId(null);
      isGeneratingRef.current = false;
      loadCustomList();
    }
  }, [visible, loadCustomList]);

  // ─── Bắt đầu kịch bản có sẵn (Tối ưu 3: 0 Token Gemini) ──────────

  const startScenario = async (scenario: Scenario) => {
    if (isGeneratingRef.current) return;
    isGeneratingRef.current = true;
    setLoadingScenarioId(scenario.id);
    Haptics.selectionAsync();

    try {
      if (scenario.prebaked_turns && scenario.prebaked_turns.length > 0) {
        // Dùng ngay bộ kịch bản mẫu không tốn API
        setActiveScenario(scenario);
        setHistory([]);
        setRecapSentences([]);
        setSelectedOptionIndex(null);
        setAllTurns(scenario.prebaked_turns);
        setCurrentTurn(scenario.prebaked_turns[0]);
        setTurnIndex(1);
        setStage('in_dialogue');
        speakChinese(scenario.prebaked_turns[0].character_tw);
      } else {
        // Nếu chưa có prebaked turns, gọi sinh trọn gói 1 lần duy nhất
        setIsGeneratingCustom(true);
        const turns = await generateFullDialogueScenario(scenario.prompt, scenario.topic);
        setActiveScenario(scenario);
        setHistory([]);
        setRecapSentences([]);
        setSelectedOptionIndex(null);
        setAllTurns(turns);
        setCurrentTurn(turns[0]);
        setTurnIndex(1);
        setStage('in_dialogue');
        speakChinese(turns[0].character_tw);
      }
    } catch (e: any) {
      Alert.alert('Lỗi', e.message || 'Không thể tạo kịch bản');
    } finally {
      setIsGeneratingCustom(false);
      setLoadingScenarioId(null);
      isGeneratingRef.current = false;
    }
  };

  // ─── Bắt đầu kịch bản tự tạo đã lưu ──────────────────────────────

  const startSavedCustomScenario = (cs: CustomScenario) => {
    if (isGeneratingRef.current) return;
    Haptics.selectionAsync();
    setActiveScenario(cs);
    setAllTurns(cs.turns);
    setCurrentTurn(cs.turns[0]);
    setTurnIndex(1);
    setStage('in_dialogue');
    setSelectedOptionIndex(null);
    speakChinese(cs.turns[0].character_tw);
  };

  const handleDeleteCustomScenario = async (id: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await deleteCustomScenario(id);
    await loadCustomList();
  };

  // ─── Tạo mới kịch bản cá nhân hóa (Tối ưu 1: Đúng 1 API call) ────

  const handleCreateCustomScenario = async () => {
    if (isGeneratingRef.current) return;
    const prompt = customPromptInput.trim();
    if (!prompt) {
      Alert.alert('Thông báo', 'Vui lòng nhập tình huống bạn muốn luyện tập.');
      return;
    }

    const role = customRoleInput.trim();
    isGeneratingRef.current = true;
    setIsGeneratingCustom(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const turns = await generateFullDialogueScenario(prompt, 'custom', role || undefined);

      // Lưu vào SQLite để lần sau chơi offline không tốn API
      const title = prompt.length > 25 ? prompt.slice(0, 25) + '...' : prompt;
      const saved = await insertCustomScenario({
        title,
        prompt,
        topic: 'custom',
        turns,
      });

      await loadCustomList();
      setShowCreateCustom(false);
      setCustomPromptInput('');
      setCustomRoleInput('');

      // Khởi động phiên
      setActiveScenario(saved);
      setAllTurns(turns);
      setCurrentTurn(turns[0]);
      setTurnIndex(1);
      setStage('in_dialogue');
      setSelectedOptionIndex(null);
      speakChinese(turns[0].character_tw);
    } catch (e: any) {
      Alert.alert('Lỗi', e.message || 'Không thể tạo kịch bản.');
    } finally {
      setIsGeneratingCustom(false);
      isGeneratingRef.current = false;
    }
  };

  // ─── Chọn đáp án ──────────────────────────────────────────────────

  const handleSelectOption = (optionIndex: number) => {
    if (!currentTurn || !activeScenario || selectedOptionIndex !== null) return;

    setSelectedOptionIndex(optionIndex);
    const chosen = currentTurn.options[optionIndex];
    const isCorrect = optionIndex === currentTurn.correct_index;

    Haptics.notificationAsync(
      isCorrect ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning
    );

    // Lưu vào danh sách tổng kết
    const newRecap = [...recapSentences];
    newRecap.push({
      tw: currentTurn.character_tw,
      pinyin: currentTurn.character_pinyin,
      vi: currentTurn.character_vi,
      en: currentTurn.character_en,
    });
    if (chosen) {
      newRecap.push({
        tw: chosen.tw,
        pinyin: chosen.pinyin,
        vi: chosen.vi,
        en: chosen.en,
      });
    }
    setRecapSentences(newRecap);

    setHistory((prev) => [
      ...prev,
      { role: 'character', text: currentTurn.character_tw },
      { role: 'user', text: chosen?.tw || '' },
    ]);
  };

  // ─── Tiến sang lượt tiếp theo (0 mạng, 0 token) ───────────────────

  const handleProceedNextTurn = () => {
    Haptics.selectionAsync();
    if (!currentTurn || !activeScenario) return;

    const isLastTurn = turnIndex >= allTurns.length || currentTurn.is_final;
    if (isLastTurn) {
      setStage('recap');
    } else {
      const nextIndex = turnIndex + 1;
      const nextTurn = allTurns[nextIndex - 1];
      if (nextTurn) {
        setTurnIndex(nextIndex);
        setCurrentTurn(nextTurn);
        setSelectedOptionIndex(null);
        speakChinese(nextTurn.character_tw);
      } else {
        setStage('recap');
      }
    }
  };

  // ─── Lưu câu vào kho từ ───────────────────────────────────────────

  const handleSaveRecapSentence = async (s: { tw: string; pinyin: string; vi: string; en: string }) => {
    if (!activeScenario) return;
    try {
      const exists = await termExists(s.en, 'sentence');
      if (exists) {
        setSavedTwSet((prev) => new Set(prev).add(s.tw));
        return;
      }

      await insertVocabulary({
        original_term: s.en,
        tw_term: s.tw,
        tw_traditional: s.tw,
        pinyin: s.pinyin,
        vi: s.vi,
        scope: 'communication',
        kind: 'sentence',
        topic: activeScenario.topic,
        context_sentence: `Hội thoại: ${activeScenario.title}`,
        source: 'dialogue',
      });

      setSavedTwSet((prev) => new Set(prev).add(s.tw));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaveSentence?.();
    } catch (e: any) {
      Alert.alert('Lỗi', e.message || 'Không thể lưu câu');
    }
  };


  const isLastTurn = currentTurn ? (turnIndex >= allTurns.length || !!currentTurn.is_final) : false;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Header Modal */}
          <View style={styles.modalHeader}>
            <View style={styles.headerTitleRow}>
              <Feather name="message-square" size={18} color="#6366F1" />
              <Text style={styles.modalTitle}>
                {stage === 'select_scenario'
                  ? 'Hội thoại nhập vai chuẩn Đài Loan'
                  : stage === 'in_dialogue'
                  ? activeScenario?.title
                  : 'Tổng kết hội thoại'}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10}>
              <Feather name="x" size={20} color="#64748B" />
            </Pressable>
          </View>

          {/* GIAI ĐOẠN 1: CHỌN HOẶC TỰ TẠO KỊCH BẢN */}
          {stage === 'select_scenario' && (
            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {/* Thẻ tạo kịch bản cá nhân hóa */}
              <View style={styles.customBox}>
                <Pressable
                  style={styles.customHeaderToggle}
                  onPress={() => setShowCreateCustom(!showCreateCustom)}
                >
                  <View style={styles.customTitleRow}>
                    <Feather name="plus-circle" size={18} color="#6366F1" />
                    <Text style={styles.customHeaderTitle}>Tự tạo tình huống của bạn</Text>
                  </View>
                  <Feather
                    name={showCreateCustom ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color="#6366F1"
                  />
                </Pressable>

                {showCreateCustom && (
                  <View style={styles.customForm}>
                    <Text style={styles.customInputHint}>
                      Tình huống bạn muốn luyện tập:
                    </Text>
                    <TextInput
                      style={styles.customInput}
                      value={customPromptInput}
                      onChangeText={setCustomPromptInput}
                      placeholder="Mô tả bối cảnh (VD: Phục vụ tại quán lẩu, Phỏng vấn xin việc...)"
                      placeholderTextColor="#94A3B8"
                    />

                    <Text style={[styles.customInputHint, { marginTop: 10 }]}>
                      Vai trò của bạn (không bắt buộc):
                    </Text>
                    <TextInput
                      style={styles.customInput}
                      value={customRoleInput}
                      onChangeText={setCustomRoleInput}
                      placeholder="VD: Nhân viên phục vụ, Ứng viên, Khách hàng..."
                      placeholderTextColor="#94A3B8"
                    />
                    <Pressable
                      style={[
                        styles.createCustomBtn,
                        (!customPromptInput.trim() || isGeneratingCustom) && styles.btnDisabled,
                      ]}
                      onPress={handleCreateCustomScenario}
                      disabled={!customPromptInput.trim() || isGeneratingCustom}
                    >
                      {isGeneratingCustom ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <>
                          <Feather name="zap" size={15} color="#FFFFFF" />
                          <Text style={styles.createCustomBtnText}>Tạo & Nhập vai ngay (1 click)</Text>
                        </>
                      )}
                    </Pressable>
                  </View>
                )}
              </View>

              {/* Danh sách kịch bản tự tạo đã lưu */}
              {customScenarios.length > 0 && (
                <View style={styles.savedCustomSection}>
                  <Text style={styles.sectionSubtitle}>🌟 TÌNH HUỐNG CỦA BẠN (LƯU OFFLINE):</Text>
                  <View style={styles.scenariosGrid}>
                    {customScenarios.map((cs) => (
                      <View key={cs.id} style={styles.scenarioCard}>
                        <View style={styles.customCardHeader}>
                          <Text style={styles.scenarioTitle}>{cs.title}</Text>
                          <Pressable
                            onPress={() => handleDeleteCustomScenario(cs.id)}
                            hitSlop={6}
                          >
                            <Feather name="trash-2" size={14} color="#EF4444" />
                          </Pressable>
                        </View>
                        <Text style={styles.scenarioDesc}>{cs.prompt}</Text>
                        <Pressable
                          style={[styles.scenarioFooter, (loadingScenarioId !== null || isGeneratingCustom) && styles.scenarioCardDisabled]}
                          onPress={() => startSavedCustomScenario(cs)}
                          disabled={loadingScenarioId !== null || isGeneratingCustom}
                        >
                          <Text style={styles.scenarioStartText}>Luyện lại (0 API) →</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Danh sách kịch bản có sẵn */}
              <Text style={styles.sectionSubtitle}>BỐI CẢNH GIAO TIẾP PHỔ BIẾN:</Text>
              <View style={styles.scenariosGrid}>
                {SCENARIOS.map((sc) => {
                  const isLoadingThis = loadingScenarioId === sc.id;
                  const isBlocked = loadingScenarioId !== null || isGeneratingCustom;

                  return (
                    <Pressable
                      key={sc.id}
                      style={[styles.scenarioCard, isBlocked && !isLoadingThis && styles.scenarioCardDisabled]}
                      onPress={() => startScenario(sc)}
                      disabled={isBlocked}
                    >
                      <View style={styles.scenarioCardTop}>
                        <Text style={styles.scenarioTitle}>{sc.title}</Text>
                        {sc.prebaked_turns && (
                          <View style={styles.zeroQuotaBadge}>
                            <Text style={styles.zeroQuotaBadgeText}>Sẵn sàng</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.scenarioDesc}>{sc.prompt}</Text>
                      <View style={styles.scenarioFooter}>
                        {isLoadingThis ? (
                          <View style={styles.scenarioLoadingRow}>
                            <ActivityIndicator size="small" color="#6366F1" />
                            <Text style={styles.scenarioLoadingText}>Đang chuẩn bị...</Text>
                          </View>
                        ) : (
                          <Text style={styles.scenarioStartText}>Bắt đầu →</Text>
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          )}

          {/* GIAI ĐOẠN 2: LƯỢT ĐỐI THOẠI TRỰC TIẾP */}
          {stage === 'in_dialogue' && currentTurn && (
            <View style={styles.dialogueContainer}>
              {/* Chỉ số lượt linh hoạt 3 - 5 lượt & Vai trò */}
              <View style={styles.turnIndicatorRow}>
                <Text style={styles.turnIndicatorText}>
                  {`Lượt ${turnIndex}/${allTurns.length}`}
                </Text>
                {currentTurn.user_role_name ? (
                  <View style={styles.userRoleBadge}>
                    <Text style={styles.userRoleBadgeText} numberOfLines={1}>
                      Vai của bạn: {currentTurn.user_role_name}
                    </Text>
                  </View>
                ) : null}
              </View>

              <ScrollView style={styles.dialogueScroll} showsVerticalScrollIndicator={false}>
                {/* Bong bóng câu của nhân vật đối thoại */}
                <View style={styles.characterBubble}>
                  <View style={styles.characterBubbleHeader}>
                    <View style={styles.characterRoleWrapper}>
                      <Text style={styles.characterName}>
                        {currentTurn.character_name || 'Đối tác bản xứ (Đài Loan)'}
                      </Text>
                    </View>
                    <Pressable
                      style={styles.speakerBtn}
                      onPress={() => speakChinese(currentTurn.character_tw)}
                      hitSlop={6}
                    >
                      <Feather name="volume-2" size={16} color="#6366F1" />
                    </Pressable>
                  </View>
                  <Text style={styles.characterTw}>{currentTurn.character_tw}</Text>
                  <Text style={styles.characterPinyin}>{currentTurn.character_pinyin}</Text>
                  <Text style={styles.characterVi}>{currentTurn.character_vi}</Text>
                </View>

                <Text style={styles.replyPrompt}>
                  {`Chọn câu phản hồi của bạn (${currentTurn.user_role_name || 'Bạn'}):`}
                </Text>

                {/* Danh sách 3 Lựa chọn phản hồi */}
                <View style={styles.optionsList}>
                  {currentTurn.options.map((opt, oIdx) => {
                    const isSelected = selectedOptionIndex === oIdx;
                    const isCorrect = oIdx === currentTurn.correct_index;
                    const hasAnswered = selectedOptionIndex !== null;

                    return (
                      <View key={oIdx}>
                        <Pressable
                          style={[
                            styles.optionCard,
                            hasAnswered && isCorrect && styles.optionCardCorrect,
                            hasAnswered && isSelected && !isCorrect && styles.optionCardWrong,
                            hasAnswered && !isSelected && !isCorrect && styles.optionCardDimmed,
                          ]}
                          onPress={() => handleSelectOption(oIdx)}
                          disabled={hasAnswered}
                        >

                          <View style={styles.optionHeaderRow}>
                            <Text
                              style={[
                                styles.optionTw,
                                hasAnswered && isCorrect && styles.textCorrect,
                                { flex: 1 },
                              ]}
                            >
                              {opt.tw}
                            </Text>
                            {hasAnswered && (
                              <Pressable
                                style={styles.optionSpeakerBtn}
                                onPress={() => speakChinese(opt.tw)}
                                hitSlop={8}
                              >
                                <Feather
                                  name="volume-2"
                                  size={16}
                                  color={isCorrect ? '#10B981' : '#6366F1'}
                                />
                              </Pressable>
                            )}
                          </View>
                          <Text style={styles.optionPinyin}>{opt.pinyin}</Text>
                          {hasAnswered && (
                            <Text style={styles.optionVi}>{opt.vi}</Text>
                          )}
                        </Pressable>

                        {/* MỤC 1: NÚT LUYỆN NÓI CÂU ĐÚNG (Dùng SpeakPractice chuẩn) */}
                        {hasAnswered && isSelected && isCorrect && (
                          <SpeakPractice
                            targetSentence={opt.tw}
                            targetPinyin={opt.pinyin}
                            title="Luyện phát âm câu trả lời này"
                          />
                        )}
                      </View>
                    );
                  })}
                </View>

                {/* Nút tiếp tục sau khi chọn xong */}
                {selectedOptionIndex !== null && (
                  <Pressable
                    style={styles.continueTurnBtn}
                    onPress={handleProceedNextTurn}
                  >
                    <Text style={styles.continueTurnBtnText}>
                      {isLastTurn
                        ? 'Xem tổng kết phiên hội thoại →'
                        : 'Tiếp tục câu tiếp theo →'}
                    </Text>
                    <Feather name="arrow-right" size={16} color="#FFFFFF" />
                  </Pressable>
                )}
              </ScrollView>
            </View>
          )}

          {/* GIAI ĐOẠN 3: TỔNG KẾT & LƯU CÂU */}
          {stage === 'recap' && (
            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.recapHeaderBox}>
                <Feather name="award" size={26} color="#6366F1" />
                <Text style={styles.recapHeaderTitle}>Hoàn thành kịch bản!</Text>
                <Text style={styles.recapHeaderDesc}>
                  Dưới đây là các câu tự nhiên chuẩn Đài Loan được dùng trong phiên:
                </Text>
              </View>

              <View style={styles.recapList}>
                {recapSentences.map((s, idx) => {
                  const isSaved = savedTwSet.has(s.tw);
                  return (
                    <View key={idx} style={styles.recapItem}>
                      <View style={styles.recapItemLeft}>
                        <Text style={styles.recapTw}>{s.tw}</Text>
                        <Text style={styles.recapPinyin}>{s.pinyin}</Text>
                        <Text style={styles.recapVi}>{s.vi}</Text>
                      </View>
                      <View style={styles.recapItemRight}>
                        <Pressable
                          style={styles.speakerBtn}
                          onPress={() => speakChinese(s.tw)}
                          hitSlop={6}
                        >
                          <Feather name="volume-2" size={15} color="#6366F1" />
                        </Pressable>
                        <Pressable
                          style={[styles.saveBtn, isSaved && styles.saveBtnDisabled]}
                          onPress={() => handleSaveRecapSentence(s)}
                          disabled={isSaved}
                        >
                          <Feather
                            name={isSaved ? 'check' : 'plus'}
                            size={14}
                            color={isSaved ? '#059669' : '#FFFFFF'}
                          />
                          <Text style={[styles.saveBtnText, isSaved && styles.saveBtnTextDisabled]}>
                            {isSaved ? 'Đã lưu' : 'Lưu'}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>

              <Pressable style={styles.doneBtn} onPress={onClose}>
                <Text style={styles.doneBtnText}>Xong</Text>
              </Pressable>
            </ScrollView>
          )}
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
    paddingBottom: 24,
    paddingHorizontal: 16,
    maxHeight: '92%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '800',
  },
  modalBody: {
    marginTop: 10,
  },
  customBox: {
    backgroundColor: '#EEF2FF',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    marginBottom: 16,
  },
  customHeaderToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  customTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  customHeaderTitle: {
    color: '#4338CA',
    fontSize: 14,
    fontWeight: '800',
  },
  customForm: {
    marginTop: 10,
  },
  customInputHint: {
    color: '#64748B',
    fontSize: 12,
    marginBottom: 6,
  },
  customInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#0F172A',
    marginBottom: 8,
  },
  createCustomBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#6366F1',
    borderRadius: 10,
    paddingVertical: 10,
  },
  createCustomBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.5,
  },
  savedCustomSection: {
    marginBottom: 12,
  },
  sectionSubtitle: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  scenariosGrid: {
    gap: 10,
    paddingBottom: 20,
  },
  scenarioCard: {
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  scenarioCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  customCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  scenarioTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
  },
  zeroQuotaBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  zeroQuotaBadgeText: {
    color: '#059669',
    fontSize: 10,
    fontWeight: '700',
  },
  scenarioDesc: {
    color: '#64748B',
    fontSize: 12,
    lineHeight: 17,
  },
  scenarioFooter: {
    marginTop: 8,
    alignItems: 'flex-end',
  },
  scenarioStartText: {
    color: '#6366F1',
    fontSize: 13,
    fontWeight: '800',
  },
  scenarioLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scenarioLoadingText: {
    color: '#6366F1',
    fontSize: 12,
    fontWeight: '700',
  },
  scenarioCardDisabled: {
    opacity: 0.5,
  },
  dialogueContainer: {
    minHeight: 400,
    paddingTop: 8,
  },
  turnIndicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  turnIndicatorText: {
    color: '#6366F1',
    fontSize: 12,
    fontWeight: '800',
  },
  userRoleBadge: {
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    maxWidth: '65%',
  },
  userRoleBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  characterRoleWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dialogueScroll: {
    maxHeight: 520,
  },
  characterBubble: {
    backgroundColor: '#EEF2FF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#C7D2FE',
    marginBottom: 12,
  },
  characterBubbleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  characterName: {
    color: '#6366F1',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  speakerBtn: {
    padding: 5,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  characterTw: {
    color: '#0F172A',
    fontSize: 19,
    fontWeight: '800',
    lineHeight: 26,
  },
  characterPinyin: {
    color: '#4338CA',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  characterVi: {
    color: '#475569',
    fontSize: 13,
    marginTop: 4,
    fontStyle: 'italic',
  },
  replyPrompt: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  optionsList: {
    gap: 10,
    paddingBottom: 16,
  },
  optionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  optionCardCorrect: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
  },
  optionCardWrong: {
    backgroundColor: '#FEF2F2',
    borderColor: '#EF4444',
  },
  optionCardDimmed: {
    opacity: 0.45,
  },
  optionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  optionSpeakerBtn: {
    padding: 4,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    marginLeft: 8,
  },
  optionTw: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '800',
  },
  textCorrect: {
    color: '#047857',
  },
  optionPinyin: {
    color: '#6366F1',
    fontSize: 12,
    marginTop: 2,
  },
  optionVi: {
    color: '#475569',
    fontSize: 12,
    marginTop: 4,
    fontWeight: '600',
  },
  practiceContainer: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  practiceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  practiceHeaderTitle: {
    color: '#4338CA',
    fontSize: 12,
    fontWeight: '700',
  },
  practiceActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  practiceMicBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#6366F1',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  practiceMicBtnActive: {
    backgroundColor: '#DC2626',
  },
  practiceMicBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  scoringLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scoringLoadingText: {
    color: '#6366F1',
    fontSize: 12,
  },
  scoreResultBox: {
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
  },
  scoreResultBoxPassed: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  scoreResultBoxFailed: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
  },
  scoreRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scorePill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  scorePillPassed: {
    backgroundColor: '#D1FAE5',
  },
  scorePillFailed: {
    backgroundColor: '#FEE2E2',
  },
  scorePillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  scoreTextPassed: {
    color: '#065F46',
  },
  scoreTextFailed: {
    color: '#991B1B',
  },
  scoreFeedbackText: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
  scoreTranscriptText: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 4,
    fontStyle: 'italic',
  },
  continueTurnBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#6366F1',
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 14,
    marginBottom: 24,
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  continueTurnBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  recapHeaderBox: {
    alignItems: 'center',
    paddingVertical: 12,
    gap: 6,
  },
  recapHeaderTitle: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '800',
  },
  recapHeaderDesc: {
    color: '#64748B',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  recapList: {
    gap: 10,
    marginVertical: 12,
  },
  recapItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  recapItemLeft: {
    flex: 1,
    paddingRight: 8,
  },
  recapTw: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
  },
  recapPinyin: {
    color: '#6366F1',
    fontSize: 11,
    marginTop: 2,
  },
  recapVi: {
    color: '#475569',
    fontSize: 12,
    marginTop: 2,
  },
  recapItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#6366F1',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  saveBtnDisabled: {
    backgroundColor: '#ECFDF5',
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  saveBtnTextDisabled: {
    color: '#059669',
  },
  doneBtn: {
    backgroundColor: '#6366F1',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  doneBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
});
