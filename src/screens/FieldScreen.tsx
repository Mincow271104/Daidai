import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, FlatList, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { useFieldStore } from '../store/fieldStore';
import { useVocabularyStore } from '../store/vocabularyStore';
import { FIELDS, getField } from '../constants/fields';
import { suggestTerms } from '../services/api';
import { insertVocabulary, termExists } from '../database/repository';
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

  useEffect(() => {
    loadFieldStore();
  }, []);

  const loadSuggestions = useCallback(async (fieldKey: string) => {
    const online = await ensureOnline('Gợi ý thuật ngữ');
    if (!online) return;
    setLoading(true);
    try {
      const existing = vocabulary.map((v) => v.original_term);
      const res = await suggestTerms(fieldKey, existing, 8);
      setSuggestions(res);
    } catch (e: any) {
      Alert.alert('Thông báo', e.message || 'Không thể tải từ gợi ý');
    } finally {
      setLoading(false);
    }
  }, [vocabulary]);

  // Tải gợi ý khi đổi ngành
  useEffect(() => {
    if (field) {
      loadSuggestions(field);
    }
  }, [field]);

  const handleSelectField = async (key: string) => {
    if (key === field) return;
    Haptics.selectionAsync();
    await setField(key);
  };

  const handleAddTerm = async (term: AITerm) => {
    try {
      const exists = await termExists(term.original_term);
      if (exists) {
        setAddedTerms((prev) => new Set(prev).add(term.original_term.toLowerCase()));
        return;
      }

      await insertVocabulary({
        original_term: term.original_term,
        tw_term: term.tw_traditional,
        tw_traditional: term.tw_traditional,
        pinyin: term.pinyin,
        vi: term.vi,
        category: field,
        context_sentence: `Thuật ngữ chuyên ngành ${getField(field).label}`,
        source: 'suggestion',
        scope: 'domain',
        kind: 'term',
        topic: 'work',
      });

      setAddedTerms((prev) => new Set(prev).add(term.original_term.toLowerCase()));
      await loadVocabulary();
      await loadStats();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert('Lỗi', e.message || 'Không thể thêm từ');
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

      {/* Danh sách ngành nghề cuộn ngang */}
      <View style={styles.chipsContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsScroll}
        >
          {FIELDS.map((f) => {
            const active = f.key === field;
            return (
              <Pressable
                key={f.key}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => handleSelectField(f.key)}
              >
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
            {getField(field).label}
          </Text>
        </View>
        <Pressable
          style={styles.refreshBtn}
          onPress={() => loadSuggestions(field)}
          disabled={loading}
          hitSlop={6}
        >
          <Feather name="refresh-cw" size={13} color="#6366F1" />
          <Text style={styles.refreshText}>Lấy từ khác</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#6366F1" size="large" />
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
                    size={16}
                    color={added ? '#059669' : '#FFFFFF'}
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
  screenSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
  chipsContainer: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  chipsScroll: {
    paddingHorizontal: 20,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  chipActive: {
    backgroundColor: '#6366F1',
    borderColor: '#6366F1',
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
    paddingHorizontal: 20,
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
    gap: 4,
    flexShrink: 0,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#EEF2FF',
  },
  refreshText: {
    color: '#6366F1',
    fontSize: 12,
    fontWeight: '700',
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    paddingTop: 4,
    gap: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
  },
  cardInfo: {
    flex: 1,
    paddingRight: 12,
  },
  termEn: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '700',
  },
  termTw: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '800',
    marginTop: 2,
  },
  termPinyin: {
    color: '#6366F1',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  termVi: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#6366F1',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  addBtnDisabled: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  addBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  addBtnTextDisabled: {
    color: '#059669',
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
});
