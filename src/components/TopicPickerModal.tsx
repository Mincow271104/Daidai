import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Topic, getTopic } from '../constants/topics';
import { getUserTopics, createUserTopic, deleteUserTopic } from '../database/repository';

interface TopicPickerModalProps {
  visible: boolean;
  selectedTopicKey: string;
  onSelectTopic: (topicKey: string) => void;
  onClose: () => void;
  aiSuggestedTopicKey?: string;
  title?: string;
}

export function TopicPickerModal({
  visible,
  selectedTopicKey,
  onSelectTopic,
  onClose,
  aiSuggestedTopicKey,
  title = 'Chọn chủ đề lưu kho',
}: TopicPickerModalProps) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadTopicsList = async () => {
    setIsLoading(true);
    try {
      const list = await getUserTopics();
      setTopics(list);
    } catch (e) {
      console.warn('loadTopicsList error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (visible) {
      loadTopicsList();
      setNewLabel('');
    }
  }, [visible]);

  const handleSelect = (key: string) => {
    Haptics.selectionAsync();
    onSelectTopic(key);
    onClose();
  };

  const handleCreateNewTopic = async () => {
    const trimmed = newLabel.trim();
    if (!trimmed) {
      Alert.alert('Thông báo', 'Vui lòng nhập tên chủ đề');
      return;
    }
    setIsSubmitting(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const created = await createUserTopic(trimmed);
      setNewLabel('');
      await loadTopicsList();
      onSelectTopic(created.key);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (err: any) {
      Alert.alert('Lỗi', err?.message || 'Không thể tạo chủ đề');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCustomTopic = (topic: Topic) => {
    Alert.alert(
      'Xóa chủ đề',
      `Bạn có chắc muốn xóa chủ đề "${topic.label}"? Các từ vựng thuộc chủ đề này sẽ được tự động chuyển về chủ đề "Khác".`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa',
          style: 'destructive',
          onPress: async () => {
            try {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              await deleteUserTopic(topic.key);
              if (selectedTopicKey === topic.key) {
                onSelectTopic('other');
              }
              await loadTopicsList();
            } catch (err: any) {
              Alert.alert('Lỗi', err?.message || 'Không thể xóa chủ đề');
            }
          },
        },
      ]
    );
  };

  if (!visible) return null;

  const userCustomTopics = topics.filter((t) => !t.is_default);
  const defaultTopics = topics.filter((t) => t.is_default);
  const aiTopicInfo = aiSuggestedTopicKey ? getTopic(aiSuggestedTopicKey) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalRoot}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />

        <View style={styles.sheetContainer}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Feather name="folder" size={18} color="#6366F1" />
              <Text style={styles.headerTitle}>{title}</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Feather name="x" size={20} color="#94A3B8" />
            </Pressable>
          </View>

          {/* Banner gợi ý AI nếu có */}
          {aiTopicInfo && aiTopicInfo.key !== 'other' && (
            <Pressable
              style={[
                styles.aiBanner,
                selectedTopicKey === aiTopicInfo.key && styles.aiBannerSelected,
              ]}
              onPress={() => handleSelect(aiTopicInfo.key)}
            >
              <View style={styles.aiBannerLeft}>
                <Feather name="zap" size={14} color="#6366F1" />
                <Text style={styles.aiBannerLabel}>AI tự động gợi ý:</Text>
                <Text style={styles.aiBannerValue}>{aiTopicInfo.label}</Text>
              </View>
              {selectedTopicKey === aiTopicInfo.key ? (
                <Feather name="check" size={16} color="#6366F1" />
              ) : (
                <Text style={styles.aiBannerPickHint}>Chọn</Text>
              )}
            </Pressable>
          )}

          {/* Ô nhập tạo nhanh chủ đề mới */}
          <View style={styles.createBox}>
            <TextInput
              style={styles.createInput}
              value={newLabel}
              onChangeText={setNewLabel}
              placeholder="Tạo chủ đề mới (vd: Ký túc xá, Gia công...)"
              placeholderTextColor="#94A3B8"
              maxLength={30}
            />
            <Pressable
              style={[
                styles.createBtn,
                (!newLabel.trim() || isSubmitting) && styles.createBtnDisabled,
              ]}
              onPress={handleCreateNewTopic}
              disabled={!newLabel.trim() || isSubmitting}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Feather name="plus" size={14} color="#FFFFFF" />
                  <Text style={styles.createBtnText}>Thêm</Text>
                </>
              )}
            </Pressable>
          </View>

          {/* Danh sách chủ đề */}
          {isLoading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color="#6366F1" size="small" />
              <Text style={styles.loadingText}>Đang tải danh sách chủ đề...</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={true}
            >
              {/* Mục Chủ đề người dùng tự tạo */}
              {userCustomTopics.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionHeader}>Chủ đề tự tạo của bạn</Text>
                  {userCustomTopics.map((topic) => {
                    const isSelected = selectedTopicKey === topic.key;
                    const isAiSuggested = aiSuggestedTopicKey === topic.key;
                    return (
                      <Pressable
                        key={topic.key}
                        style={[styles.topicItem, isSelected && styles.topicItemSelected]}
                        onPress={() => handleSelect(topic.key)}
                      >
                        <View style={styles.topicItemLeft}>
                          <View
                            style={[
                              styles.radioCircle,
                              isSelected && styles.radioCircleSelected,
                            ]}
                          >
                            {isSelected && <View style={styles.radioDot} />}
                          </View>
                          <Text
                            style={[
                              styles.topicItemText,
                              isSelected && styles.topicItemTextSelected,
                            ]}
                          >
                            {topic.label}
                          </Text>
                          <View style={styles.customBadge}>
                            <Text style={styles.customBadgeText}>Tự tạo</Text>
                          </View>
                          {isAiSuggested && (
                            <View style={styles.aiTagBadge}>
                              <Feather name="zap" size={10} color="#6366F1" />
                              <Text style={styles.aiTagBadgeText}>AI gợi ý</Text>
                            </View>
                          )}
                        </View>

                        <Pressable
                          style={styles.deleteTopicBtn}
                          onPress={() => handleDeleteCustomTopic(topic)}
                          hitSlop={8}
                        >
                          <Feather name="trash-2" size={14} color="#EF4444" />
                        </Pressable>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Mục Chủ đề mặc định */}
              <View style={styles.section}>
                <Text style={styles.sectionHeader}>Chủ đề cơ bản</Text>
                {defaultTopics.map((topic) => {
                  const isSelected = selectedTopicKey === topic.key;
                  const isAiSuggested = aiSuggestedTopicKey === topic.key;
                  return (
                    <Pressable
                      key={topic.key}
                      style={[styles.topicItem, isSelected && styles.topicItemSelected]}
                      onPress={() => handleSelect(topic.key)}
                    >
                      <View style={styles.topicItemLeft}>
                        <View
                          style={[
                            styles.radioCircle,
                            isSelected && styles.radioCircleSelected,
                          ]}
                        >
                          {isSelected && <View style={styles.radioDot} />}
                        </View>
                        <Text
                          style={[
                            styles.topicItemText,
                            isSelected && styles.topicItemTextSelected,
                          ]}
                        >
                          {topic.label}
                        </Text>
                        {topic.key === 'other' && (
                          <View style={styles.defaultBadge}>
                            <Text style={styles.defaultBadgeText}>Mặc định</Text>
                          </View>
                        )}
                        {isAiSuggested && (
                          <View style={styles.aiTagBadge}>
                            <Feather name="zap" size={10} color="#6366F1" />
                            <Text style={styles.aiTagBadgeText}>AI gợi ý</Text>
                          </View>
                        )}
                      </View>

                      {isSelected && (
                        <Feather name="check" size={16} color="#6366F1" />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  sheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 20,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  closeBtn: {
    padding: 4,
  },
  aiBanner: {
    marginHorizontal: 16,
    marginTop: 10,
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  aiBannerSelected: {
    borderColor: '#6366F1',
    backgroundColor: '#E0E7FF',
  },
  aiBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  aiBannerLabel: {
    color: '#6366F1',
    fontSize: 12,
    fontWeight: '600',
  },
  aiBannerValue: {
    color: '#1E1B4B',
    fontSize: 13,
    fontWeight: '800',
  },
  aiBannerPickHint: {
    color: '#4F46E5',
    fontSize: 12,
    fontWeight: '700',
  },
  createBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
    gap: 8,
  },
  createInput: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: '#0F172A',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#6366F1',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 4,
  },
  createBtnDisabled: {
    opacity: 0.5,
  },
  createBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  loadingBox: {
    paddingVertical: 32,
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#64748B',
    fontSize: 13,
  },
  scroll: {
    maxHeight: 380,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  section: {
    marginBottom: 14,
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    paddingLeft: 4,
  },
  topicItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  topicItemSelected: {
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
  },
  topicItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  radioCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioCircleSelected: {
    borderColor: '#6366F1',
  },
  radioDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#6366F1',
  },
  topicItemText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  topicItemTextSelected: {
    color: '#1E1B4B',
    fontWeight: '700',
  },
  customBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  customBadgeText: {
    color: '#B45309',
    fontSize: 10,
    fontWeight: '700',
  },
  defaultBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  defaultBadgeText: {
    color: '#64748B',
    fontSize: 10,
    fontWeight: '600',
  },
  aiTagBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  aiTagBadgeText: {
    color: '#4F46E5',
    fontSize: 10,
    fontWeight: '700',
  },
  deleteTopicBtn: {
    padding: 6,
  },
});
