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
import {
  setCustomUserKeys,
  getGeminiKeys,
  testGeminiApiKey,
  getKeyQuotaInfo,
  KeyQuotaInfo,
} from '../services/api';
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
  const [quotaMap, setQuotaMap] = useState<Record<string, KeyQuotaInfo>>({});

  useEffect(() => {
    if (visible) {
      loadSettings();
    }
  }, [visible]);

  // Cập nhật lượng Quota & thời gian hồi theo thời gian thực mỗi 1 giây khi mở modal
  useEffect(() => {
    if (visible && activeKeys.length > 0) {
      const updateQuotas = () => {
        const map: Record<string, KeyQuotaInfo> = {};
        for (const k of activeKeys) {
          map[k] = getKeyQuotaInfo(k);
        }
        setQuotaMap(map);
      };

      updateQuotas();
      const timer = setInterval(updateQuotas, 1000);
      return () => clearInterval(timer);
    }
  }, [visible, activeKeys]);

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
      const initialQuota: Record<string, KeyQuotaInfo> = {};
      loadedKeys.forEach((k) => {
        initialMap[k] = { status: 'valid', message: 'Khóa đã lưu' };
        initialQuota[k] = getKeyQuotaInfo(k);
      });
      setKeyValidationMap(initialMap);
      setQuotaMap(initialQuota);
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

    // Tách theo dấu phẩy hoặc dấu xuống dòng nếu người dùng dán nhiều key
    const tokens = raw
      .split(/[\n,]+/)
      .map((k) => k.trim())
      .filter(Boolean);

    if (tokens.length === 0) {
      Alert.alert('Khóa không hợp lệ', 'Vui lòng nhập API Key.');
      return;
    }

    // Kiểm tra định dạng cơ bản: không chứa khoảng trắng
    for (const token of tokens) {
      if (/\s/.test(token)) {
        Alert.alert(
          'Khóa không hợp lệ',
          'API Key không được chứa khoảng trắng. Vui lòng kiểm tra lại chuỗi bạn vừa nhập.'
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
    const trimmed = key.trim();
    if (trimmed.length <= 14) return trimmed;
    return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`;
  };

  const getEnergyColor = (ratio: number): string => {
    if (ratio >= 0.7) return '#10B981'; // >= 70%: màu xanh lá
    if (ratio >= 0.3) return '#F59E0B'; // 30% - 69%: màu vàng
    return '#EF4444'; // < 30%: màu đỏ
  };

  const formatResetTime = (quota: KeyQuotaInfo): string => {
    if (quota.isCoolingDown || quota.status === 'exhausted_rpm') {
      return `Reset sau ${quota.rpmResetSeconds}s`;
    }
    if (quota.status === 'exhausted_daily') {
      return `Reset ngày sau ${quota.dailyResetHoursRemaining}h ${quota.dailyResetMinutesRemaining}p`;
    }
    if (quota.rpmResetSeconds > 0) {
      return `Hồi sau ${quota.rpmResetSeconds}s • Reset ngày sau ${quota.dailyResetHoursRemaining}h ${quota.dailyResetMinutesRemaining}p`;
    }
    return `Reset ngày sau ${quota.dailyResetHoursRemaining}h ${quota.dailyResetMinutesRemaining}p`;
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

            {/* Tùy chọn 3: Quản lý Gemini API Keys & Hạn mức Quota */}
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardIconBox}>
                  <Feather name="key" size={18} color="#64748B" />
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
                    const quota = quotaMap[k] || getKeyQuotaInfo(k);
                    const rpmRatio = quota.rpmRemaining / quota.rpmLimit;
                    const rpdRatio = quota.rpdRemaining / quota.rpdLimit;

                    return (
                      <View key={k + idx} style={styles.keyCard}>
                        {/* Dòng tiêu đề Key */}
                        <View style={styles.keyCardHeader}>
                          <View style={styles.keyBadge}>
                            <Text style={styles.keyBadgeText}>Key #{idx + 1}</Text>
                          </View>
                          <Text style={styles.keyText} numberOfLines={1}>
                            {maskKey(k)}
                          </Text>

                          {/* Huy hiệu trạng thái nếu đang test hoặc lỗi */}
                          {statusInfo.status === 'testing' ? (
                            <View style={styles.statusPillTesting}>
                              <ActivityIndicator size="small" color="#64748B" />
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
                            <Feather name="trash-2" size={13} color="#94A3B8" />
                          </Pressable>
                        </View>

                        {/* Thanh năng lượng & Thời gian reset */}
                        <View style={styles.energyPanel}>
                          <View style={styles.energyRow}>
                            <Text style={styles.energyLabel} numberOfLines={1}>Phút</Text>
                            <View style={styles.energyTrack}>
                              <View
                                style={[
                                  styles.energyFill,
                                  {
                                    width: `${Math.max(4, Math.round(rpmRatio * 100))}%`,
                                    backgroundColor: getEnergyColor(rpmRatio),
                                  },
                                ]}
                              />
                            </View>
                          </View>

                          <View style={styles.energyRow}>
                            <Text style={styles.energyLabel} numberOfLines={1}>Ngày</Text>
                            <View style={styles.energyTrack}>
                              <View
                                style={[
                                  styles.energyFill,
                                  {
                                    width: `${Math.max(4, Math.round(rpdRatio * 100))}%`,
                                    backgroundColor: getEnergyColor(rpdRatio),
                                  },
                                ]}
                              />
                            </View>
                          </View>

                          <View style={styles.resetRow}>
                            <Feather name="clock" size={11} color="#64748B" />
                            <Text style={styles.resetText} numberOfLines={1}>
                              {formatResetTime(quota)}
                            </Text>
                          </View>
                        </View>
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
                    placeholder="Dán Gemini API Key tại đây..."
                    placeholderTextColor="#94A3B8"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
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
    gap: 10,
  },
  keyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
  },
  keyCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  keyBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  keyBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  keyText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    letterSpacing: 0.2,
  },
  keyActionBtn: {
    padding: 6,
    borderRadius: 6,
  },
  statusPillInvalid: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  statusTextInvalid: {
    fontSize: 10,
    fontWeight: '700',
    color: '#DC2626',
  },
  statusPillTesting: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  energyPanel: {
    backgroundColor: '#FAFAFA',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 6,
  },
  energyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  energyLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748B',
    width: 42,
  },
  energyTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    overflow: 'hidden',
  },
  energyFill: {
    height: '100%',
    borderRadius: 3,
  },
  resetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  resetText: {
    flex: 1,
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
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
