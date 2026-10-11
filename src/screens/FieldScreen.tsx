import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  FlatList,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Feather, FontAwesome } from '@expo/vector-icons';
import { useFieldStore } from '../store/fieldStore';
import { useVocabularyStore } from '../store/vocabularyStore';
import { FIELDS, getField, Field } from '../constants/fields';
import { suggestTerms } from '../services/api';
import {
  insertVocabulary,
  termExists,
  ensureFieldTopic,
  getUserCustomFields,
  addUserCustomField,
  getPinnedFields,
  togglePinField,
} from '../database/repository';
import { ApiKeySettingsModal } from '../components/ApiKeySettingsModal';
import { ensureOnline } from '../services/network';
import { AITerm } from '../types';

export function FieldScreen() {
  const { field, setField, load: loadFieldStore } = useFieldStore();
  const { vocabulary, loadVocabulary, loadStats } = useVocabularyStore();
  const [suggestions, setSuggestions] = useState<AITerm[]>([]);
  const [loading, setLoading] = useState(false);
  const [addedTerms, setAddedTerms] = useState<Set<string>>(new Set());
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);

  // Danh sách ngành nghề tùy biến & các ngành đã ghim
  const [customFields, setCustomFields] = useState<Field[]>([]);
  const [pinnedFieldKeys, setPinnedFieldKeys] = useState<string[]>([]);
  const [showAddFieldModal, setShowAddFieldModal] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [isAddingField, setIsAddingField] = useState(false);

  const loadCustomAndPinned = useCallback(async () => {
    try {
      const [cFields, pKeys] = await Promise.all([
        getUserCustomFields(),
        getPinnedFields(),
      ]);
      setCustomFields(cFields);
      setPinnedFieldKeys(pKeys);
    } catch (e) {
      console.warn('loadCustomAndPinned error:', e);
    }
  }, []);

  useEffect(() => {
    loadFieldStore();
    loadCustomAndPinned();
  }, [loadFieldStore, loadCustomAndPinned]);

  // Tổng hợp tất cả ngành (mặc định + người dùng tạo), sắp xếp ngành được ghim lên đầu
  const allFields = useMemo(() => {
    const combined = [...FIELDS, ...customFields];
    const pinnedSet = new Set(pinnedFieldKeys);
    return combined.sort((a, b) => {
      const aPinned = pinnedSet.has(a.key);
      const bPinned = pinnedSet.has(b.key);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return 0;
    });
  }, [customFields, pinnedFieldKeys]);

  const currentFieldObj = useMemo(() => {
    return getField(field, customFields);
  }, [field, customFields]);

  const loadSuggestions = useCallback(async (fieldKey: string) => {
    const online = await ensureOnline('Gợi ý thuật ngữ');
    if (!online) return;
    setLoading(true);
    try {
      const existing = vocabulary.map((v) => v.original_term);
      const fObj = getField(fieldKey, customFields);
      const res = await suggestTerms(fieldKey, existing, 8, fObj.prompt || fObj.label);
      setSuggestions(res);
    } catch (e: any) {
      Alert.alert('Thông báo', e?.message || 'Không thể tải từ gợi ý');
    } finally {
      setLoading(false);
    }
  }, [vocabulary, customFields]);

  // Tải gợi ý khi đổi ngành
  useEffect(() => {
    if (field) {
      loadSuggestions(field);
    }
  }, [field, loadSuggestions]);

  const handleSelectField = async (key: string) => {
    if (key === field) return;
    Haptics.selectionAsync();
    await setField(key);
  };

  const handleTogglePin = async (key: string, e: any) => {
    e?.stopPropagation?.();
    Haptics.selectionAsync();
    try {
      await togglePinField(key);
      const updatedKeys = await getPinnedFields();
      setPinnedFieldKeys(updatedKeys);
    } catch (err: any) {
      console.warn('togglePinField error:', err);
    }
  };

  const handleAddTerm = async (term: AITerm) => {
    try {
      const exists = await termExists(term.original_term);
      if (exists) {
        setAddedTerms((prev) => new Set(prev).add(term.original_term.toLowerCase()));
        return;
      }

      // Tự động tạo chủ đề Chuyên ngành bên Kho từ theo tên ngành hiện tại
      await ensureFieldTopic(field, currentFieldObj.label);

      await insertVocabulary({
        original_term: term.original_term,
        tw_term: term.tw_traditional,
        tw_traditional: term.tw_traditional,
        pinyin: term.pinyin,
        vi: term.vi,
        category: field,
        context_sentence: `Thuật ngữ chuyên ngành ${currentFieldObj.label}`,
        source: 'suggestion',
        scope: 'domain',
        kind: 'term',
        topic: field,
      });

      setAddedTerms((prev) => new Set(prev).add(term.original_term.toLowerCase()));
      await loadVocabulary();
      await loadStats();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Lỗi', e?.message || 'Không thể thêm từ');
    }
  };

  const handleCreateCustomField = async () => {
    const clean = newFieldName.trim();
    if (!clean) return;
    setIsAddingField(true);
    try {
      const created = await addUserCustomField(clean);
      await loadCustomAndPinned();
      await setField(created.key);
      setShowAddFieldModal(false);
      setNewFieldName('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      Alert.alert('Lỗi', err?.message || 'Không thể thêm chuyên ngành');
    } finally {
      setIsAddingField(false);
    }
  };

  const isTermAdded = (term: AITerm) => {
    const key = term.original_term.toLowerCase();
    if (addedTerms.has(key)) return true;
    return vocabulary.some((v) => v.original_term.toLowerCase() === key);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.screenHeader}>
        <Text style={styles.screenTitle}>Chuyên ngành</Text>
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

      {/* Danh sách ngành nghề cuộn ngang kèm icon sao ghim không màu */}
      <View style={styles.chipsContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsScroll}
        >
          {/* Nút Thêm ngành */}
          <Pressable
            style={styles.addSectorChip}
            onPress={() => {
              Haptics.selectionAsync();
              setNewFieldName('');
              setShowAddFieldModal(true);
            }}
          >
            <Feather name="plus" size={13} color="#0F172A" />
            <Text style={styles.addSectorChipText}>Thêm ngành</Text>
          </Pressable>

          {allFields.map((f) => {
            const active = f.key === field;
            const isPinned = pinnedFieldKeys.includes(f.key);

            return (
              <Pressable
                key={f.key}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => handleSelectField(f.key)}
              >
                {/* Icon sao không màu: đen/xám đơn sắc */}
                <Pressable
                  style={styles.starBtn}
                  onPress={(e) => handleTogglePin(f.key, e)}
                  hitSlop={6}
                >
                  <FontAwesome
                    name={isPinned ? 'star' : 'star-o'}
                    size={13}
                    color={active ? '#FFFFFF' : isPinned ? '#0F172A' : '#94A3B8'}
                  />
                </Pressable>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Phần gợi ý từ vựng */}
      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleCol}>
          <Text style={styles.sectionSuperTitle}>Thuật ngữ gợi ý</Text>
          <Text style={styles.sectionFieldLabel} numberOfLines={1} ellipsizeMode="tail">
            {currentFieldObj.label}
          </Text>
        </View>
        <Pressable
          style={styles.refreshBtn}
          onPress={() => loadSuggestions(field)}
          disabled={loading}
          hitSlop={6}
        >
          <Feather name="refresh-cw" size={12} color="#0F172A" />
          <Text style={styles.refreshText}>Lấy từ khác</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#0F172A" size="large" />
          <Text style={styles.loadingText}>Đang tìm thuật ngữ tiêu biểu...</Text>
        </View>
      ) : (
        <FlatList
          data={suggestions}
          keyExtractor={(item, idx) => item.original_term + idx}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => {
            const added = isTermAdded(item);
            return (
              <View style={styles.card}>
                <View style={styles.cardInfo}>
                  <Text style={styles.termEn}>{item.original_term}</Text>
                  <Text style={styles.termTw}>{item.tw_traditional}</Text>
                  <Text style={styles.termPinyin}>{item.pinyin}</Text>
                  {item.vi ? <Text style={styles.termVi}>{item.vi}</Text> : null}
                </View>

                <Pressable
                  style={[styles.addBtn, added && styles.addBtnDisabled]}
                  onPress={() => handleAddTerm(item)}
                  disabled={added}
                >
                  <Feather
                    name={added ? 'check' : 'plus'}
                    size={14}
                    color={added ? '#475569' : '#FFFFFF'}
                  />
                  <Text style={[styles.addBtnText, added && styles.addBtnTextDisabled]}>
                    {added ? 'Đã lưu' : 'Lưu từ'}
                  </Text>
                </Pressable>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>Bấm "Lấy từ khác" để tải gợi ý mới</Text>
            </View>
          }
        />
      )}

      {/* Modal Thêm chuyên ngành mới */}
      <Modal
        visible={showAddFieldModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddFieldModal(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setShowAddFieldModal(false)} />
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Thêm chuyên ngành mới</Text>
              <Pressable onPress={() => setShowAddFieldModal(false)} hitSlop={8}>
                <Feather name="x" size={16} color="#475569" />
              </Pressable>
            </View>

            <TextInput
              style={styles.modalInput}
              placeholder="Nhập tên ngành (vd: Cơ khí, Y tế, Xây dựng...)"
              placeholderTextColor="#94A3B8"
              value={newFieldName}
              onChangeText={setNewFieldName}
              autoFocus
            />

            <View style={styles.modalBtnRow}>
              <Pressable
                style={styles.modalCancelBtn}
                onPress={() => setShowAddFieldModal(false)}
              >
                <Text style={styles.modalCancelBtnText}>Hủy</Text>
              </Pressable>

              <Pressable
                style={[
                  styles.modalConfirmBtn,
                  (!newFieldName.trim() || isAddingField) && styles.btnDisabled,
                ]}
                onPress={handleCreateCustomField}
                disabled={!newFieldName.trim() || isAddingField}
              >
                {isAddingField ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <Text style={styles.modalConfirmBtnText}>Thêm ngành</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

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
    paddingBottom: 4,
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
  screenTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.3,
  },
  chipsContainer: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  chipsScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  addSectorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  addSectorChipText: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '800',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  chipActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  starBtn: {
    padding: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipText: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
  },
  chipTextActive: {
    color: '#FFFFFF',
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    gap: 8,
  },
  sectionTitleCol: {
    flex: 1,
    marginRight: 8,
  },
  sectionSuperTitle: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionFieldLabel: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 1,
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 0,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  refreshText: {
    color: '#0F172A',
    fontSize: 12,
    fontWeight: '700',
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    paddingTop: 4,
    gap: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardInfo: {
    flex: 1,
    paddingRight: 12,
  },
  termEn: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
  },
  termTw: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '800',
    marginTop: 2,
  },
  termPinyin: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  termVi: {
    color: '#334155',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#0F172A',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addBtnDisabled: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  addBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  addBtnTextDisabled: {
    color: '#475569',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  loadingText: {
    color: '#64748B',
    fontSize: 13,
    marginTop: 10,
    fontWeight: '600',
  },
  emptyText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalInput: {
    height: 42,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 12,
    fontSize: 13,
    color: '#0F172A',
    marginBottom: 14,
  },
  modalBtnRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  modalCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  modalCancelBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748B',
  },
  modalConfirmBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalConfirmBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  btnDisabled: {
    opacity: 0.4,
  },
});
