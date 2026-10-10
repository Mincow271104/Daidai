import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { FIELDS, Field } from '../constants/fields';
import { useFieldStore } from '../store/fieldStore';

interface FieldPickerModalProps {
  visible: boolean;
  onClose: () => void;
}

const FIELD_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  daily: 'smile',
  it: 'cpu',
  finance: 'dollar-sign',
  medical: 'activity',
  law: 'book',
  marketing: 'trending-up',
  mechanical: 'settings',
  electronics: 'zap',
  logistics: 'truck',
  hospitality: 'coffee',
  education: 'award',
};

export function FieldPickerModal({ visible, onClose }: FieldPickerModalProps) {
  const currentField = useFieldStore((s) => s.field);
  const setField = useFieldStore((s) => s.setField);

  const handleSelect = async (fieldKey: string) => {
    Haptics.selectionAsync();
    await setField(fieldKey);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheetContainer}>
          <View style={styles.indicator} />

          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <Feather name="briefcase" size={18} color="#6366F1" />
              <Text style={styles.headerTitle}>Chọn lĩnh vực chuyên ngành</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Feather name="x" size={18} color="#64748B" />
            </Pressable>
          </View>

          <Text style={styles.subtitle}>
            App sẽ ưu tiên trích xuất và lưu thuật ngữ chuyên môn đúng với ngành này:
          </Text>

          <ScrollView style={styles.listScroll} showsVerticalScrollIndicator={false}>
            {FIELDS.map((item: Field) => {
              const isSelected = item.key === currentField;
              const iconName = FIELD_ICONS[item.key] ?? 'tag';

              return (
                <Pressable
                  key={item.key}
                  style={[styles.itemCard, isSelected && styles.itemCardSelected]}
                  onPress={() => handleSelect(item.key)}
                >
                  <View style={[styles.iconWrap, isSelected && styles.iconWrapSelected]}>
                    <Feather
                      name={iconName}
                      size={18}
                      color={isSelected ? '#6366F1' : '#64748B'}
                    />
                  </View>
                  <View style={styles.itemContent}>
                    <Text style={[styles.itemLabel, isSelected && styles.itemLabelSelected]}>
                      {item.label}
                    </Text>
                  </View>
                  {isSelected ? (
                    <View style={styles.checkWrap}>
                      <Feather name="check" size={16} color="#6366F1" />
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
            <View style={{ height: 20 }} />
          </ScrollView>
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
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 20,
    maxHeight: '75%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 20,
  },
  indicator: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E2E8F0',
    alignSelf: 'center',
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0F172A',
  },
  closeBtn: {
    padding: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 14,
    lineHeight: 18,
  },
  listScroll: {
    flexGrow: 0,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: '#F1F5F9',
  },
  itemCardSelected: {
    backgroundColor: '#EEF2FF',
    borderColor: '#6366F1',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  iconWrapSelected: {
    backgroundColor: '#E0E7FF',
  },
  itemContent: {
    flex: 1,
  },
  itemLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#334155',
  },
  itemLabelSelected: {
    color: '#4338CA',
    fontWeight: '700',
  },
  checkWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#E0E7FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
