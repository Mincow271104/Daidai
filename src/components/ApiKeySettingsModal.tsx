import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  Switch,
  ScrollView,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import {
  getSavedApiKeys,
  setSavedApiKeys,
  getAutoSpeakSetting,
  setAutoSpeakSetting,
  getNotificationSettings,
  setNotificationSettings,
  NotificationSettings,
} from '../database/repository';
import { setCustomUserKeys, getGeminiKeys, testGeminiApiKey } from '../services/api';
import { syncAllSmartNotifications } from '../services/notifications';
import { ensureOnline } from '../services/network';

interface ApiKeySettingsModalProps {
  visible: boolean;
  onClose: () => void;
  onSettingsChanged?: () => void;
}

export function ApiKeySettingsModal({
  visible,
  onClose,
  onSettingsChanged,
}: ApiKeySettingsModalProps) {
  const [keysInput, setKeysInput] = useState('');
  const [activeKeys, setActiveKeys] = useState<string[]>([]);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [notifSettings, setNotifSettings] = useState<NotificationSettings>({
    eveningEnabled: true,
    streakEnabled: true,
    morningEnabled: true,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [testingStatusText, setTestingStatusText] = useState('');
  const [keyValidationMap, setKeyValidationMap] = useState<
    Record<string, { status: 'idle' | 'testing' | 'valid' | 'invalid'; message?: string }>
  >({});

  useEffect(() => {
    if (visible) {
      loadSettings();
    }
  }, [visible]);

  const loadSettings = async () => {
    try {
      const [savedKeys, speakEnabled, notif] = await Promise.all([
        getSavedApiKeys(),
        getAutoSpeakSetting(),
        getNotificationSettings(),
      ]);
      const currentAllKeys = getGeminiKeys();
      const loadedKeys = currentAllKeys.length > 0 ? currentAllKeys : savedKeys;
      setActiveKeys(loadedKeys);
      setAutoSpeak(speakEnabled);
      setNotifSettings(notif);
      setKeysInput('');

      const initialMap: Record<string, { status: 'idle' | 'testing' | 'valid' | 'invalid'; message?: string }> = {};
      loadedKeys.forEach((k) => {
        initialMap[k] = { status: 'valid', message: 'Khóa đã lưu' };
      });
      setKeyValidationMap(initialMap);
    } catch {
      // ignore
    }
  };

  const handleToggleAutoSpeak = async (value: boolean) => {
    setAutoSpeak(value);
    Haptics.selectionAsync();
    await setAutoSpeakSetting(value);
    onSettingsChanged?.();
  };

  const handleToggleNotif = async (key: keyof NotificationSettings, val: boolean) => {
    const updated = { ...notifSettings, [key]: val };
    setNotifSettings(updated);
    Haptics.selectionAsync();
    await setNotificationSettings({ [key]: val });
    await syncAllSmartNotifications();
    onSettingsChanged?.();
  };

  const handleAddKeys = async () => {
    const raw = keysInput.trim();
    if (!raw) return;

    // Giới hạn độ dài dán vào tối đa 200 ký tự để chặn dán nhầm văn bản dài
    if (raw.length > 200) {
      Alert.alert(
        'Đoạn văn bản quá dài',
        'Nội dung vừa dán vượt quá giới hạn cho phép (tối đa 200 ký tự). Gemini API Key chuẩn dài đúng 39 ký tự và bắt đầu bằng "AIzaSy".'
      );
      return;
    }

    // Tách theo dấu phẩy hoặc dấu xuống dòng nếu người dùng dán nhiều key
    const tokens = raw
      .split(/[\n,]+/)
      .map((k) => k.trim())
      .filter(Boolean);

    if (tokens.length === 0) {
      Alert.alert('Khóa không hợp lệ', 'Vui lòng nhập API Key.');
      return;
    }

    // Kiểm tra định dạng từng token
    for (const token of tokens) {
      if (/\s/.test(token)) {
        Alert.alert(
          'Khóa không hợp lệ',
          'API Key không được chứa khoảng trắng. Bạn có thể đã dán nhầm một đoạn văn bản.'
        );
        return;
      }
      if (token.length < 35 || token.length > 45) {
        Alert.alert(
          'Độ dài không hợp lệ',
          `Khóa "${maskKey(token)}" có ${token.length} ký tự. Gemini API Key chuẩn thường có đúng 39 ký tự.`
        );
        return;
      }
      if (!token.startsWith('AIza')) {
        Alert.alert(
          'Tiền tố không hợp lệ',
          `Khóa "${maskKey(token)}" không bắt đầu bằng "AIza". Vui lòng lấy khóa từ Google AI Studio.`
        );
        return;
      }
    }

    // Kiểm tra kết nối mạng trước khi test ngầm
    const online = await ensureOnline('Kiểm tra API Key');
    if (!online) return;

    setIsSaving(true);
    setTestingStatusText('Đang kiểm tra kết nối với Google AI...');

    try {
      const validNewKeys: string[] = [];

      for (const token of tokens) {
        const checkResult = await testGeminiApiKey(token);
        if (!checkResult.valid) {
          Alert.alert(
            'Khóa không hoạt động',
            `Không thể thêm khóa ${maskKey(token)}:\n${checkResult.reason}`
          );
          setIsSaving(false);
          setTestingStatusText('');
          return;
        }
        validNewKeys.push(token);
      }

      const combined = Array.from(new Set([...activeKeys, ...validNewKeys]));
      await setSavedApiKeys(combined);
      setCustomUserKeys(combined);
      setActiveKeys(combined);

      // Cập nhật trạng thái hợp lệ cho các key vừa thêm
      const updatedMap = { ...keyValidationMap };
      validNewKeys.forEach((k) => {
        updatedMap[k] = { status: 'valid', message: 'Hoạt động tốt' };
      });
      setKeyValidationMap(updatedMap);

      setKeysInput('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(
        'Khóa hoạt động tốt',
        `Đã kiểm tra thành công và lưu ${validNewKeys.length} khóa API vào ứng dụng.`
      );
      onSettingsChanged?.();
    } catch (err: any) {
      Alert.alert('Lỗi kiểm tra', err.message || 'Không thể xác thực API Key.');
    } finally {
      setIsSaving(false);
      setTestingStatusText('');
    }
  };

  const handleTestKey = async (keyToTest: string) => {
    const online = await ensureOnline('Kiểm tra API Key');
    if (!online) return;

    setKeyValidationMap((prev) => ({
      ...prev,
      [keyToTest]: { status: 'testing', message: 'Đang kiểm tra...' },
    }));
    Haptics.selectionAsync();

    const result = await testGeminiApiKey(keyToTest);

    setKeyValidationMap((prev) => ({
      ...prev,
      [keyToTest]: {
        status: result.valid ? 'valid' : 'invalid',
        message: result.reason,
      },
    }));

    if (result.valid) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Khóa hoạt động tốt', `${maskKey(keyToTest)}:\n${result.reason}`);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Khóa báo lỗi', `${maskKey(keyToTest)}:\n${result.reason}`);
    }
  };

  const handleDeleteKey = async (keyToDelete: string) => {
    const updated = activeKeys.filter((k) => k !== keyToDelete);
    setActiveKeys(updated);
    await setSavedApiKeys(updated);
    setCustomUserKeys(updated);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    onSettingsChanged?.();
  };

  const maskKey = (key: string) => {
    if (key.length <= 10) return key;
    return `${key.slice(0, 6)}...${key.slice(-4)}`;
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <View style={styles.headerIcon}>
                <Feather name="settings" size={20} color="#6366F1" />
              </View>
              <Text style={styles.title}>Cài đặt & API Key</Text>
            </View>
            <Pressable
              style={styles.closeBtn}
              onPress={() => {
                Haptics.selectionAsync();
                onClose();
              }}
              hitSlop={12}
            >
              <Feather name="x" size={22} color="#64748B" />
            </Pressable>
          </View>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {/* Tùy chọn 1: Phát âm thanh sau khi dịch */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardIconBox}>
                  <Feather
                    name={autoSpeak ? 'volume-2' : 'volume-x'}
                    size={18}
                    color={autoSpeak ? '#10B981' : '#94A3B8'}
                  />
                </View>
                <View style={styles.cardInfo}>
                  <Text style={styles.cardTitle}>Tự động phát giọng đọc</Text>
                  <Text style={styles.cardSubtitle}>
                    {autoSpeak
                      ? 'Tự động phát âm thanh bản dịch cho người đối diện nghe'
                      : 'Chỉ hiển thị văn bản (tiện cho nơi yên tĩnh hoặc phòng họp)'}
                  </Text>
                </View>
                <Switch
                  value={autoSpeak}
                  onValueChange={handleToggleAutoSpeak}
                  trackColor={{ false: '#CBD5E1', true: '#818CF8' }}
                  thumbColor={autoSpeak ? '#6366F1' : '#F1F5F9'}
                />
              </View>
            </View>

            {/* Tùy chọn 2: Thông báo Thông minh */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={[styles.cardIconBox, { backgroundColor: '#EEF2FF' }]}>
                  <Feather name="bell" size={18} color="#6366F1" />
                </View>
                <View style={styles.cardInfo}>
                  <Text style={styles.cardTitle}>Thông báo Thông minh</Text>
                </View>
              </View>

              <View style={styles.notifList}>
                {/* 1. Nhắc ôn tập buổi tối */}
                <View style={styles.notifRow}>
                  <View style={styles.notifTitleRow}>
                    <Feather name="moon" size={15} color="#475569" />
                    <Text style={styles.notifTitle}>Nhắc ôn tập buổi tối (20:30)</Text>
                  </View>
                  <Switch
                    value={notifSettings.eveningEnabled}
                    onValueChange={(v) => handleToggleNotif('eveningEnabled', v)}
                    trackColor={{ false: '#CBD5E1', true: '#818CF8' }}
                    thumbColor={notifSettings.eveningEnabled ? '#6366F1' : '#F1F5F9'}
                  />
                </View>

                {/* 2. Cứu Streak khẩn cấp */}
                <View style={styles.notifRow}>
                  <View style={styles.notifTitleRow}>
                    <Feather name="zap" size={15} color="#475569" />
                    <Text style={styles.notifTitle}>Cảnh báo cứu Streak (21:45)</Text>
                  </View>
                  <Switch
                    value={notifSettings.streakEnabled}
                    onValueChange={(v) => handleToggleNotif('streakEnabled', v)}
                    trackColor={{ false: '#CBD5E1', true: '#818CF8' }}
                    thumbColor={notifSettings.streakEnabled ? '#6366F1' : '#F1F5F9'}
                  />
                </View>

                {/* 3. Khẩu ngữ buổi sáng */}
                <View style={[styles.notifRow, { borderBottomWidth: 0 }]}>
                  <View style={styles.notifTitleRow}>
                    <Feather name="sun" size={15} color="#475569" />
                    <Text style={styles.notifTitle}>Khẩu ngữ đi làm buổi sáng (08:15)</Text>
                  </View>
                  <Switch
                    value={notifSettings.morningEnabled}
                    onValueChange={(v) => handleToggleNotif('morningEnabled', v)}
                    trackColor={{ false: '#CBD5E1', true: '#818CF8' }}
                    thumbColor={notifSettings.morningEnabled ? '#6366F1' : '#F1F5F9'}
                  />
                </View>
              </View>
            </View>

            {/* Tùy chọn 3: Quản lý Gemini API Keys */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardIconBox}>
                  <Feather name="key" size={18} color="#F59E0B" />
                </View>
                <View style={styles.cardInfo}>
                  <Text style={styles.cardTitle}>Danh sách Gemini API Key</Text>
                </View>
              </View>

              {/* Danh sách các key đang có */}
              {activeKeys.length > 0 ? (
                <View style={styles.keyList}>
                  {activeKeys.map((k, idx) => {
                    const statusInfo = keyValidationMap[k] || { status: 'valid', message: 'Đã lưu' };
                    return (
                      <View key={k + idx} style={styles.keyRow}>
                        <View style={styles.keyBadge}>
                          <Text style={styles.keyBadgeText}>Key #{idx + 1}</Text>
                        </View>
                        <Text style={styles.keyText} numberOfLines={1}>
                          {maskKey(k)}
                        </Text>

                        {/* Huy hiệu trạng thái kiểm tra ngầm */}
                        {statusInfo.status === 'testing' ? (
                          <View style={styles.statusPillTesting}>
                            <ActivityIndicator size="small" color="#6366F1" />
                          </View>
                        ) : statusInfo.status === 'valid' ? (
                          <View style={styles.statusPillValid}>
                            <Feather name="check" size={10} color="#059669" />
                            <Text style={styles.statusTextValid}>Hoạt động</Text>
                          </View>
                        ) : statusInfo.status === 'invalid' ? (
                          <Pressable
                            style={styles.statusPillInvalid}
                            onPress={() =>
                              Alert.alert('Chi tiết lỗi', statusInfo.message || 'Khóa không hoạt động.')
                            }
                            hitSlop={6}
                          >
                            <Feather name="alert-circle" size={10} color="#DC2626" />
                            <Text style={styles.statusTextInvalid}>Lỗi</Text>
                          </Pressable>
                        ) : null}

                        {/* Nút kiểm tra lại */}
                        <Pressable
                          style={styles.keyActionBtn}
                          onPress={() => handleTestKey(k)}
                          hitSlop={8}
                          disabled={statusInfo.status === 'testing'}
                        >
                          <Feather name="refresh-cw" size={12} color="#64748B" />
                        </Pressable>

                        {/* Nút xóa */}
                        <Pressable
                          style={styles.keyActionBtn}
                          onPress={() => handleDeleteKey(k)}
                          hitSlop={8}
                        >
                          <Feather name="trash-2" size={14} color="#94A3B8" />
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <View style={styles.emptyKeyBox}>
                  <Text style={styles.emptyKeyText}>Chưa có API Key nào được lưu.</Text>
                </View>
              )}

              {/* Form thêm key mới */}
              <View style={styles.inputContainer}>
                <View style={styles.inputWrap}>
                  <TextInput
                    style={styles.input}
                    value={keysInput}
                    onChangeText={setKeysInput}
                    placeholder="Dán Gemini API Key (AIzaSy...) tại đây..."
                    placeholderTextColor="#94A3B8"
                    maxLength={150}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {keysInput.trim().length > 0 && (
                    <Text style={styles.charCountText}>
                      {keysInput.trim().length}/39 ký tự
                    </Text>
                  )}
                </View>

                <Pressable
                  style={[
                    styles.saveBtn,
                    (!keysInput.trim() || isSaving) && styles.saveBtnDisabled,
                  ]}
                  onPress={handleAddKeys}
                  disabled={!keysInput.trim() || isSaving}
                >
                  {isSaving ? (
                    <>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                      <Text style={styles.saveBtnText}>
                        {testingStatusText || 'Đang kiểm tra...'}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Feather name="check-circle" size={16} color="#FFFFFF" />
                      <Text style={styles.saveBtnText}>Kiểm tra & Thêm Khóa</Text>
                    </>
                  )}
                </Pressable>
              </View>

              <Text style={styles.helperText}>
                Lấy khóa tại <Text style={styles.helperLink}>aistudio.google.com</Text>
              </Text>
            </View>

            <View style={{ height: 24 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 20,
    paddingHorizontal: 20,
    maxHeight: '85%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    marginTop: 14,
  },
  card: {
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardIconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardInfo: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 16,
  },
  keyList: {
    marginTop: 12,
    gap: 8,
  },
  keyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 10,
  },
  keyBadge: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  keyBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6366F1',
  },
  keyText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#334155',
  },
  keyDeleteBtn: {
    padding: 6,
  },
  keyActionBtn: {
    padding: 6,
    borderRadius: 6,
  },
  statusPillValid: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  statusTextValid: {
    fontSize: 10,
    fontWeight: '700',
    color: '#065F46',
  },
  statusPillInvalid: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  statusTextInvalid: {
    fontSize: 10,
    fontWeight: '700',
    color: '#991B1B',
  },
  statusPillTesting: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  emptyKeyBox: {
    marginTop: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  emptyKeyText: {
    fontSize: 13,
    color: '#94A3B8',
    fontStyle: 'italic',
  },
  inputContainer: {
    marginTop: 12,
    gap: 10,
  },
  inputWrap: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
  },
  input: {
    fontSize: 13,
    color: '#0F172A',
    padding: 0,
    minHeight: 28,
  },
  charCountText: {
    alignSelf: 'flex-end',
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 4,
    fontWeight: '500',
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6366F1',
    borderRadius: 12,
    paddingVertical: 12,
    gap: 8,
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  helperText: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 18,
    marginTop: 12,
  },
  helperLink: {
    color: '#6366F1',
    fontWeight: '700',
  },
  notifList: {
    marginTop: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 12,
  },
  notifTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  notifTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
});
