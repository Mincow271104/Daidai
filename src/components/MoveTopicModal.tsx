import React, { useState, useEffect, useCallback } from 'react';
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
import { VocabularyItem } from '../types';
import { Topic, getTopic } from '../constants/topics';
import {
  getUserTopics,
  createUserTopic,
  updateVocabularyTopicAndScope,
} from '../database/repository';

interface MoveTopicModalProps {
  visible: boolean;
  item: VocabularyItem | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function MoveTopicModal({ visible, item, onClose, onSuccess }: MoveTopicModalProps) {
  const [targetScope, setTargetScope] = useState<'communication' | 'domain'>('communication');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');

  // Đồng bộ scope ban đầu theo item đang chọn khi mở modal
  useEffect(() => {
    if (item && visible) {
      setTargetScope((item.scope as 'communication' | 'domain') || 'communication');
      setShowCreateInput(false);
      setNewTopicName('');
    }
  }, [item, visible]);

  // Tải danh sách chủ đề theo tab đích được chọn
  const loadTopicsForScope = useCallback(async (scope: 'communication' | 'domain') => {
    setLoading(true);
    try {
      const list = await getUserTopics(scope);
      setTopics(list);
    } catch (e) {
      console.warn('loadTopicsForScope error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      loadTopicsForScope(targetScope);
    }
  }, [visible, targetScope, loadTopicsForScope]);

  const handleSelectScope = (scope: 'communication' | 'domain') => {
    if (scope === targetScope) return;
    Haptics.selectionAsync();
    setTargetScope(scope);
    setShowCreateInput(false);
  };

  const handleSelectTopic = async (topicKey: string) => {
    if (!item) return;
    setSaving(true);
    try {
      await updateVocabularyTopicAndScope(item.id, topicKey, targetScope);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSuccess();
      onClose();
    } catch (e: any) {
      Alert.alert('Lỗi', e?.message || 'Không thể di chuyển từ vựng');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateAndSelect = async () => {
    const clean = newTopicName.trim();
    if (!clean) return;
    setSaving(true);
    try {
      const created = await createUserTopic(clean, undefined, targetScope);
      setNewTopicName('');
      setShowCreateInput(false);
      await handleSelectTopic(created.key);
    } catch (e: any) {
      Alert.alert('Lỗi', e?.message || 'Không thể tạo chủ đề');
      setSaving(false);
    }
  };

  if (!item) return null;

  const currentTopic = item.topic ? getTopic(item.topic) : null;
  const currentScopeLabel = item.scope === 'domain' ? 'Chuyên ngành' : 'Giao tiếp';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Feather name="folder" size={16} color="#0F172A" />
              <Text style={styles.title}>Di chuyển chủ đề</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Feather name="x" size={16} color="#475569" />
            </Pressable>
          </View>

          {/* Xem trước từ/đoạn đang chuyển */}
          <View style={styles.previewBox}>
            <Text style={styles.previewTw} numberOfLines={1}>
              {item.tw_traditional}
            </Text>
            <Text style={styles.previewSub} numberOfLines={1}>
              {item.vi || item.original_term}
            </Text>
            <View style={styles.currentBadgeRow}>
              <Text style={styles.currentBadgeLabel}>Vị trí hiện tại:</Text>
              <Text style={styles.currentBadgeValue}>
                {currentScopeLabel} • {currentTopic?.label || 'Khác'}
              </Text>
            </View>
          </View>

          {/* Chọn Tab mục tiêu: Giao tiếp | Chuyên ngành */}
          <View style={styles.scopeTabs}>
            <Pressable
              style={[styles.scopeTab, targetScope === 'communication' && styles.scopeTabActive]}
              onPress={() => handleSelectScope('communication')}
            >
              <Feather
                name="message-circle"
                size={14}
                color={targetScope === 'communication' ? '#0F172A' : '#64748B'}
              />
              <Text
                style={[
                  styles.scopeTabText,
                  targetScope === 'communication' && styles.scopeTabTextActive,
                ]}
              >
                Giao tiếp
              </Text>
            </Pressable>

            <Pressable
              style={[styles.scopeTab, targetScope === 'domain' && styles.scopeTabActive]}
              onPress={() => handleSelectScope('domain')}
            >
              <Feather
                name="briefcase"
                size={14}
                color={targetScope === 'domain' ? '#0F172A' : '#64748B'}
              />
              <Text
                style={[
                  styles.scopeTabText,
                  targetScope === 'domain' && styles.scopeTabTextActive,
                ]}
              >
                Chuyên ngành
              </Text>
            </Pressable>
          </View>

          {/* Nút hoặc form Tạo chủ đề mới */}
          {!showCreateInput ? (
            <Pressable
              style={styles.newTopicBtn}
              onPress={() => setShowCreateInput(true)}
            >
              <Feather name="plus" size={14} color="#0F172A" />
              <Text style={styles.newTopicBtnText}>
                Tạo chủ đề mới ({targetScope === 'domain' ? 'Chuyên ngành' : 'Giao tiếp'})
              </Text>
            </Pressable>
          ) : (
            <View style={styles.createInputBox}>
              <TextInput
                style={styles.createInput}
                placeholder="Nhập tên chủ đề mới..."
                placeholderTextColor="#94A3B8"
                value={newTopicName}
                onChangeText={setNewTopicName}
                autoFocus
              />
              <Pressable
                style={[styles.createConfirmBtn, !newTopicName.trim() && styles.btnDisabled]}
                onPress={handleCreateAndSelect}
                disabled={!newTopicName.trim() || saving}
              >
                <Feather name="check" size={14} color="#FFFFFF" />
              </Pressable>
              <Pressable
                style={styles.createCancelBtn}
                onPress={() => {
                  setShowCreateInput(false);
                  setNewTopicName('');
                }}
              >
                <Feather name="x" size={14} color="#64748B" />
              </Pressable>
            </View>
          )}

          {/* Danh sách chủ đề đích để chọn */}
          <Text style={styles.sectionSubtitle}>
            Chọn chủ đề đích ({topics.length}):
          </Text>

          {loading ? (
            <View style={styles.centerLoading}>
              <ActivityIndicator color="#475569" size="small" />
            </View>
          ) : topics.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {targetScope === 'domain'
                  ? 'Chưa có chủ đề chuyên ngành nào. Hãy bấm "Tạo chủ đề mới" ở trên nhé.'
                  : 'Không có chủ đề nào.'}
              </Text>
            </View>
          ) : (
            <ScrollView
              style={styles.topicsList}
              contentContainerStyle={styles.topicsListContent}
              showsVerticalScrollIndicator={false}
            >
              {topics.map((t) => {
                const isCurrent =
                  item.scope === targetScope && (item.topic || 'other') === t.key;

                return (
                  <Pressable
                    key={t.key}
                    style={[styles.topicItem, isCurrent && styles.topicItemCurrent]}
                    onPress={() => handleSelectTopic(t.key)}
                    disabled={saving}
                  >
                    <View style={styles.topicItemLeft}>
                      <View style={styles.topicDot} />
                      <Text style={[styles.topicLabel, isCurrent && styles.topicLabelCurrent]}>
                        {t.label}
                      </Text>
                    </View>

                    {isCurrent ? (
                      <View style={styles.currentTag}>
                        <Text style={styles.currentTagText}>Hiện tại</Text>
                      </View>
                    ) : (
                      <Feather name="chevron-right" size={14} color="#94A3B8" />
                    )}
                  </Pressable>
                );
              })}
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
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  container: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '85%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  closeBtn: {
    padding: 4,
  },
  previewBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
  },
  previewTw: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  previewSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
  currentBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  currentBadgeLabel: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
  },
  currentBadgeValue: {
    fontSize: 11,
    color: '#334155',
    fontWeight: '700',
  },
  scopeTabs: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
  },
  scopeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 7,
    borderRadius: 8,
  },
  scopeTabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  scopeTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  scopeTabTextActive: {
    color: '#0F172A',
    fontWeight: '800',
  },
  newTopicBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    marginBottom: 12,
  },
  newTopicBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  createInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  createInput: {
    flex: 1,
    height: 38,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 10,
    fontSize: 13,
    color: '#0F172A',
  },
  createConfirmBtn: {
    width: 38,
    height: 38,
    backgroundColor: '#0F172A',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createCancelBtn: {
    width: 38,
    height: 38,
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDisabled: {
    opacity: 0.4,
  },
  sectionSubtitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  centerLoading: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  emptyContainer: {
    paddingVertical: 24,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  emptyText: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  topicsList: {
    maxHeight: 220,
  },
  topicsListContent: {
    gap: 6,
    paddingBottom: 4,
  },
  topicItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  topicItemCurrent: {
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
  },
  topicItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  topicDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#64748B',
  },
  topicLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  topicLabelCurrent: {
    color: '#334155',
  },
  currentTag: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  currentTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
});
