import React, { useEffect, useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList,
  Pressable, TextInput, ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { FlashCard } from '../components/FlashCard';
import {
  toggleFavorite,
  deleteVocabulary,
  getAllVocabulary,
  getTotalStats,
  getUserTopics,
  deleteUserTopic,
} from '../database/repository';
import { Topic, TOPICS } from '../constants/topics';
import { TopicPickerModal } from '../components/TopicPickerModal';
import { MoveTopicModal } from '../components/MoveTopicModal';
import { ApiKeySettingsModal } from '../components/ApiKeySettingsModal';
import { VocabularyItem } from '../types';
import { useScrollLockStore } from '../store/scrollLockStore';

export function VocabScreen() {
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [movingItem, setMovingItem] = useState<VocabularyItem | null>(null);
  const isScrollLocked = useScrollLockStore((s) => s.isScrollLocked);
  const isFocused = useIsFocused();
  // Tab mặc định: 'communication'
  const [activeTab, setActiveTab] = useState<'communication' | 'domain'>('communication');
  const [selectedTopic, setSelectedTopic] = useState<string>('all');
  const [topics, setTopics] = useState<Topic[]>(TOPICS);
  const [showTopicManageModal, setShowTopicManageModal] = useState<boolean>(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'mastered' | 'due' | 'favorites'>('all');
  const [items, setItems] = useState<VocabularyItem[]>([]);
  const [stats, setStats] = useState({ total: 0, mastered: 0, due: 0 });
  const [isLoading, setIsLoading] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const vocabList = await getAllVocabulary(activeTab);
      const vocabStats = await getTotalStats(activeTab);
      const userTopics = await getUserTopics(activeTab);
      setItems(vocabList);
      setStats(vocabStats);
      setTopics(userTopics);
    } catch (e) {
      console.warn('loadData error:', e);
    } finally {
      setIsLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    if (isFocused) {
      loadData();
    }
  }, [isFocused, loadData]);

  const handleTabChange = (tab: 'communication' | 'domain') => {
    if (tab === activeTab) return;
    Haptics.selectionAsync();
    setActiveTab(tab);
    setSelectedTopic('all');
    setFilter('all');
  };

  const filtered = items.filter((item) => {
    // 1. Lọc theo topic (áp dụng cho cả Giao tiếp và Chuyên ngành)
    if (selectedTopic !== 'all') {
      const itemTopic = item.topic || 'other';
      if (itemTopic !== selectedTopic) return false;
    }

    // 2. Lọc theo trạng thái
    if (filter === 'mastered' && item.status !== 'mastered') return false;
    if (filter === 'due' && item.status !== 'review') return false;
    if (filter === 'favorites' && item.is_favorite !== 1) return false;

    // 3. Tìm kiếm
    const q = search.trim().toLowerCase();
    if (!q) return true;

    const normalize = (str: string) =>
      str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const qNorm = normalize(q);

    return (
      item.original_term.toLowerCase().includes(q) ||
      item.tw_traditional.toLowerCase().includes(q) ||
      (item.pinyin && item.pinyin.toLowerCase().includes(q)) ||
      (item.vi && (item.vi.toLowerCase().includes(q) || normalize(item.vi).includes(qNorm)))
    );
  });

  const handleToggleFavorite = useCallback(async (id: string) => {
    await toggleFavorite(id);
    await loadData();
    Haptics.selectionAsync();
  }, [loadData]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteVocabulary(id);
    await loadData();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [loadData]);

  const renderItem = useCallback(({ item }: { item: VocabularyItem }) => (
    <View style={styles.itemWrapper}>
      <FlashCard
        item={item}
        onItemUpdated={loadData}
        footer={
          <View style={styles.cardFooter}>
            <View style={styles.statusIndicator}>
              <View
                style={[
                  styles.statusDot,
                  item.status === 'mastered' ? styles.dotMastered : styles.dotDue,
                ]}
              />
              <Text style={styles.statusText}>
                {item.status === 'mastered' ? 'Đã thành thạo' : 'Cần ôn tập'}
              </Text>
            </View>

            <View style={styles.actionsRow}>
              <Pressable
                style={styles.iconBtn}
                onPress={() => {
                  Haptics.selectionAsync();
                  setMovingItem(item);
                }}
                hitSlop={8}
              >
                <Feather name="folder" size={16} color="#475569" />
              </Pressable>

              <Pressable
                style={[styles.iconBtn, item.is_favorite === 1 && styles.iconBtnFavorited]}
                onPress={() => handleToggleFavorite(item.id)}
                hitSlop={8}
              >
                <Feather
                  name="bookmark"
                  size={16}
                  color={item.is_favorite === 1 ? '#475569' : '#94A3B8'}
                />
              </Pressable>
              <Pressable
                style={styles.iconBtn}
                onPress={() => handleDelete(item.id)}
                hitSlop={8}
              >
                <Feather name="trash-2" size={16} color="#94A3B8" />
              </Pressable>
            </View>
          </View>
        }
      />
    </View>
  ), [handleToggleFavorite, handleDelete, loadData]);

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header màn hình chuẩn hóa */}
      <View style={styles.screenHeader}>
        <View style={styles.screenHeaderLeft}>
          <Text style={styles.screenTitle}>Kho từ vựng</Text>
        </View>
        <View style={styles.headerRightActions}>
          <View style={styles.totalBadge}>
            <Text style={styles.totalBadgeText}>{stats.total} từ</Text>
          </View>
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
      </View>

      {/* Thanh chuyển 2 Tab trên cùng: Communication vs Chuyên ngành */}
      <View style={styles.topTabsContainer}>
        <Pressable
          style={[styles.topTab, activeTab === 'communication' && styles.topTabActive]}
          onPress={() => handleTabChange('communication')}
        >
          <Feather
            name="message-circle"
            size={16}
            color={activeTab === 'communication' ? '#6366F1' : '#64748B'}
          />
          <Text style={[styles.topTabText, activeTab === 'communication' && styles.topTabTextActive]}>
            Giao tiếp
          </Text>
        </Pressable>

        <Pressable
          style={[styles.topTab, activeTab === 'domain' && styles.topTabActive]}
          onPress={() => handleTabChange('domain')}
        >
          <Feather
            name="briefcase"
            size={16}
            color={activeTab === 'domain' ? '#6366F1' : '#64748B'}
          />
          <Text style={[styles.topTabText, activeTab === 'domain' && styles.topTabTextActive]}>
            Chuyên ngành
          </Text>
        </Pressable>
      </View>

      {/* Thống kê theo tab hiện tại */}
      <View style={styles.statsRow}>
        <Pressable
          style={[styles.statBox, filter === 'all' && styles.statBoxActive]}
          onPress={() => setFilter('all')}
        >
          <Text style={styles.statNumber}>{stats.total}</Text>
          <Text style={styles.statLabel}>Tất cả</Text>
        </Pressable>
        <Pressable
          style={[styles.statBox, filter === 'mastered' && styles.statBoxActive]}
          onPress={() => setFilter('mastered')}
        >
          <Text style={[styles.statNumber, { color: '#059669' }]}>{stats.mastered}</Text>
          <Text style={styles.statLabel}>Đã thuộc</Text>
        </Pressable>
        <Pressable
          style={[styles.statBox, filter === 'due' && styles.statBoxActive]}
          onPress={() => setFilter('due')}
        >
          <Text style={[styles.statNumber, { color: '#D97706' }]}>{stats.due}</Text>
          <Text style={styles.statLabel}>Cần ôn</Text>
        </Pressable>
      </View>

      {/* Hàng chip chủ đề cuộn ngang cho cả Giao tiếp và Chuyên ngành */}
      <View style={styles.topicsRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.topicsScroll}
        >
          {/* Nút Tạo chủ đề */}
          <Pressable
            style={styles.createTopicChip}
            onPress={() => {
              Haptics.selectionAsync();
              setShowTopicManageModal(true);
            }}
          >
            <Feather name="plus" size={13} color="#4F46E5" />
            <Text style={styles.createTopicChipText}>Tạo chủ đề</Text>
          </Pressable>

          {/* Chip Tất cả chủ đề */}
          <Pressable
            style={[styles.topicChip, selectedTopic === 'all' && styles.topicChipActive]}
            onPress={() => {
              setSelectedTopic('all');
              Haptics.selectionAsync();
            }}
          >
            <Text style={[styles.topicChipText, selectedTopic === 'all' && styles.topicChipTextActive]}>
              Tất cả ({items.length})
            </Text>
          </Pressable>

          {/* Danh sách các chủ đề (tự tạo + mặc định) */}
          {topics.map((top) => {
            const isActive = selectedTopic === top.key;
            const count = items.filter((it) => (it.topic || 'other') === top.key).length;
            return (
              <Pressable
                key={top.key}
                style={[
                  styles.topicChip,
                  isActive && styles.topicChipActive,
                  !top.is_default && styles.topicChipCustom,
                ]}
                onPress={() => {
                  setSelectedTopic(top.key);
                  Haptics.selectionAsync();
                }}
                onLongPress={() => {
                  if (!top.is_default) {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                    Alert.alert(
                      'Xóa chủ đề',
                      `Bạn có muốn xóa chủ đề "${top.label}" không? Các từ thuộc chủ đề này sẽ được chuyển về "Khác".`,
                      [
                        { text: 'Hủy', style: 'cancel' },
                        {
                          text: 'Xóa',
                          style: 'destructive',
                          onPress: async () => {
                            await deleteUserTopic(top.key);
                            if (selectedTopic === top.key) setSelectedTopic('all');
                            await loadData();
                          },
                        },
                      ]
                    );
                  }
                }}
              >
                {!top.is_default && (
                  <View style={[styles.customDot, isActive && styles.customDotActive]} />
                )}
                <Text style={[styles.topicChipText, isActive && styles.topicChipTextActive]}>
                  {top.label} {count > 0 ? `(${count})` : ''}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Ô tìm kiếm đơn sắc */}
      <View style={styles.searchContainer}>
        <Feather name="search" size={16} color="#94A3B8" style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder={activeTab === 'communication' ? 'Tìm kiếm câu giao tiếp...' : 'Tìm kiếm thuật ngữ...'}
          placeholderTextColor="#94A3B8"
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')}>
            <Feather name="x" size={16} color="#94A3B8" />
          </Pressable>
        )}
      </View>

      {/* Danh sách */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#6366F1" size="large" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>
            {search
              ? 'Không tìm thấy kết quả phù hợp'
              : activeTab === 'communication'
              ? 'Chưa có câu giao tiếp nào trong mục này'
              : 'Chưa có thuật ngữ chuyên ngành nào trong mục này'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          scrollEnabled={!isScrollLocked}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
        />
      )}

      {/* Modal Quản lý và Tạo chủ đề mới */}
      <TopicPickerModal
        visible={showTopicManageModal}
        selectedTopicKey={selectedTopic}
        scope={activeTab}
        onSelectTopic={(key) => {
          setSelectedTopic(key);
          loadData();
        }}
        onClose={() => {
          setShowTopicManageModal(false);
          loadData();
        }}
        title={`Quản lý & Tạo chủ đề (${activeTab === 'domain' ? 'Chuyên ngành' : 'Giao tiếp'})`}
      />

      {/* Modal Di chuyển từ vựng giữa các chủ đề & tab */}
      <MoveTopicModal
        visible={!!movingItem}
        item={movingItem}
        onClose={() => setMovingItem(null)}
        onSuccess={() => loadData()}
      />

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
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  screenHeaderLeft: {
    flex: 1,
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
  totalBadge: {
    backgroundColor: '#EEF2FF',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  totalBadgeText: {
    color: '#4F46E5',
    fontSize: 12,
    fontWeight: '700',
  },
  topTabsContainer: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 3,
  },
  topTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 9,
  },
  topTabActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 2,
  },
  topTabText: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '700',
  },
  topTabTextActive: {
    color: '#6366F1',
    fontWeight: '800',
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 4,
    gap: 8,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statBoxActive: {
    borderColor: '#6366F1',
    backgroundColor: '#EEF2FF',
  },
  statNumber: { color: '#0F172A', fontSize: 18, fontWeight: '800' },
  statLabel: { color: '#64748B', fontSize: 11, marginTop: 2, textAlign: 'center', fontWeight: '600' },
  topicsRow: {
    paddingVertical: 4,
  },
  topicsScroll: {
    paddingHorizontal: 16,
    gap: 6,
  },
  createTopicChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: '#EEF2FF',
    borderWidth: 1,
    borderColor: '#C7D2FE',
  },
  createTopicChipText: {
    color: '#4F46E5',
    fontSize: 12,
    fontWeight: '800',
  },
  topicChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  topicChipActive: {
    backgroundColor: '#6366F1',
    borderColor: '#6366F1',
  },
  topicChipCustom: {
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
  },
  customDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#64748B',
  },
  customDotActive: {
    backgroundColor: '#FFFFFF',
  },
  topicChipText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
  },
  topicChipTextActive: {
    color: '#FFFFFF',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  searchInput: { flex: 1, color: '#0F172A', fontSize: 13, paddingVertical: 8, fontWeight: '500' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  emptyText: { color: '#64748B', fontSize: 14, textAlign: 'center', fontWeight: '500', lineHeight: 22 },
  list: { paddingBottom: 24 },
  itemWrapper: { marginBottom: 2 },
  cardFooter: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotMastered: {
    backgroundColor: '#10B981',
  },
  dotDue: {
    backgroundColor: '#F59E0B',
  },
  statusText: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBtn: {
    padding: 6,
    borderRadius: 8,
  },
  iconBtnFavorited: {
    backgroundColor: '#FEF3C7',
  },
});
