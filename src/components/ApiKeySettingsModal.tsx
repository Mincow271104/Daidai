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
import { setCustomUserKeys, getGeminiKeys } from '../services/api';
import {
  syncAllSmartNotifications,
  scheduleTestNotification,
} from '../services/notifications';

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
      setActiveKeys(currentAllKeys.length > 0 ? currentAllKeys : savedKeys);
      setAutoSpeak(speakEnabled);
      setNotifSettings(notif);
      setKeysInput('');
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

  const handleTestNotif = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await scheduleTestNotification();
    Alert.alert(
      'Đã lên lịch test',
      'DaiDai sẽ gửi thông báo thử sau 2 giây! Bạn có thể khóa màn hình để kiểm tra banner và âm thanh nhé! 🦜'
    );
  };

  const handleAddKeys = async () => {
    const raw = keysInput.trim();
    if (!raw) return;

    // Tách theo dấu phẩy hoặc dấu xuống dòng
    const newKeys = raw
      .split(/[\n,]+/)
      .map((k) => k.trim())
      .filter((k) => k.length > 10);

    if (newKeys.length === 0) {
      Alert.alert('Khóa không hợp lệ', 'Khóa Gemini API phải có ít nhất 10 ký tự.');
      return;
    }

    setIsSaving(true);
    try {
      const combined = Array.from(new Set([...activeKeys, ...newKeys]));
      await setSavedApiKeys(combined);
      setCustomUserKeys(combined);
      setActiveKeys(combined);
      setKeysInput('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Thành công', `Đã lưu ${newKeys.length} khóa API mới vào ứng dụng.`);
      onSettingsChanged?.();
    } catch (err: any) {
      Alert.alert('Lỗi', err.message || 'Không thể lưu API Key.');
    } finally {
      setIsSaving(false);
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
                  <Text style={styles.cardSubtitle}>
                    Nhắc ôn tập theo FSRS và bảo vệ ngọn lửa Streak
                  </Text>
                </View>
              </View>

              <View style={styles.notifList}>
                {/* 1. Nhắc ôn tập buổi tối */}
                <View style={styles.notifRow}>
                  <View style={styles.notifInfo}>
                    <Text style={styles.notifTitle}>🦜 Nhắc ôn tập buổi tối (20:30)</Text>
                    <Text style={styles.notifSubtitle}>
                      Ôn từ vựng sắp quên theo FSRS trước khi đi ngủ
                    </Text>
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
                  <View style={styles.notifInfo}>
                    <Text style={styles.notifTitle}>🔥 Cảnh báo cứu Streak (21:45)</Text>
                    <Text style={styles.notifSubtitle}>
                      Chỉ gửi khi hôm nay chưa kịp làm bài tập
                    </Text>
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
                  <View style={styles.notifInfo}>
                    <Text style={styles.notifTitle}>☕ Khẩu ngữ đi làm buổi sáng (08:15)</Text>
                    <Text style={styles.notifSubtitle}>
                      Nạp 1 câu tiếng Đài Loan thực chiến mỗi sáng
                    </Text>
                  </View>
                  <Switch
                    value={notifSettings.morningEnabled}
                    onValueChange={(v) => handleToggleNotif('morningEnabled', v)}
                    trackColor={{ false: '#CBD5E1', true: '#818CF8' }}
                    thumbColor={notifSettings.morningEnabled ? '#6366F1' : '#F1F5F9'}
                  />
                </View>
              </View>

              {/* Nút gửi thử thông báo */}
              <Pressable style={styles.testNotifBtn} onPress={handleTestNotif}>
                <Feather name="send" size={14} color="#6366F1" />
                <Text style={styles.testNotifBtnText}>Gửi thử thông báo mẫu ngay (2s)</Text>
              </Pressable>
            </View>

            {/* Tùy chọn 3: Quản lý Gemini API Keys */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardIconBox}>
                  <Feather name="key" size={18} color="#F59E0B" />
                </View>
                <View style={styles.cardInfo}>
                  <Text style={styles.cardTitle}>Danh sách Gemini API Key</Text>
                  <Text style={styles.cardSubtitle}>
                    Tự động xoay tua khi một khóa chạm hạn ngạch 429
                  </Text>
                </View>
              </View>

              {/* Danh sách các key đang có */}
              {activeKeys.length > 0 ? (
                <View style={styles.keyList}>
                  {activeKeys.map((k, idx) => (
                    <View key={k + idx} style={styles.keyRow}>
                      <View style={styles.keyBadge}>
                        <Text style={styles.keyBadgeText}>Key #{idx + 1}</Text>
                      </View>
                      <Text style={styles.keyText}>{maskKey(k)}</Text>
                      <Pressable
                        style={styles.keyDeleteBtn}
                        onPress={() => handleDeleteKey(k)}
                        hitSlop={8}
                      >
                        <Feather name="trash-2" size={16} color="#EF4444" />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.emptyKeyBox}>
                  <Text style={styles.emptyKeyText}>Chưa có API Key nào được lưu.</Text>
                </View>
              )}

              {/* Form thêm key mới */}
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  value={keysInput}
                  onChangeText={setKeysInput}
                  placeholder="Dán API Key (AIzaSy...) tại đây..."
                  placeholderTextColor="#94A3B8"
                  multiline
                  numberOfLines={2}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Pressable
                  style={[styles.saveBtn, (!keysInput.trim() || isSaving) && styles.saveBtnDisabled]}
                  onPress={handleAddKeys}
                  disabled={!keysInput.trim() || isSaving}
                >
                  <Feather name="plus-circle" size={16} color="#FFFFFF" />
                  <Text style={styles.saveBtnText}>Thêm Khóa</Text>
                </Pressable>
              </View>

              <Text style={styles.helperText}>
                💡 Lấy khóa miễn phí tại{' '}
                <Text style={styles.helperLink}>aistudio.google.com</Text>. Nhập 2–3 khóa để không
                lo hết quota khi sử dụng cả ngày!
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
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    padding: 12,
    fontSize: 13,
    color: '#0F172A',
    minHeight: 56,
    textAlignVertical: 'top',
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
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 12,
  },
  notifInfo: {
    flex: 1,
  },
  notifTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  notifSubtitle: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    lineHeight: 15,
  },
  testNotifBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
    paddingVertical: 11,
    marginTop: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  testNotifBtnText: {
    color: '#4F46E5',
    fontSize: 13,
    fontWeight: '700',
  },
});
