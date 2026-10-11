import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNetworkStore } from '../services/network';

export function OfflineNotice() {
  const { isConnected, isInternetReachable, hasCheckedOnce } = useNetworkStore();
  const isOffline = hasCheckedOnce && (!isConnected || !isInternetReachable);
  const [showRestored, setShowRestored] = useState(false);
  const prevOfflineRef = useRef(false);

  useEffect(() => {
    // Nếu chuyển từ offline sang online thì hiện thông báo đã kết nối lại trong 2.5s
    if (prevOfflineRef.current && !isOffline) {
      setShowRestored(true);
      const timer = setTimeout(() => {
        setShowRestored(false);
      }, 2500);
      return () => clearTimeout(timer);
    }
    prevOfflineRef.current = isOffline;
  }, [isOffline]);

  if (!isOffline && !showRestored) {
    return null;
  }

  return (
    <View style={[styles.container, showRestored ? styles.restoredContainer : styles.offlineContainer]}>
      <Feather
        name={showRestored ? 'wifi' : 'wifi-off'}
        size={13}
        color={showRestored ? '#047857' : '#B91C1C'}
      />
      <Text style={[styles.text, showRestored ? styles.restoredText : styles.offlineText]}>
        {showRestored
          ? 'Đã kết nối lại Internet'
          : 'Không có kết nối Internet (chỉ dùng được tính năng offline)'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    paddingHorizontal: 16,
    gap: 6,
    borderBottomWidth: 1,
  },
  offlineContainer: {
    backgroundColor: '#FEF2F2',
    borderBottomColor: '#FECACA',
  },
  restoredContainer: {
    backgroundColor: '#ECFDF5',
    borderBottomColor: '#A7F3D0',
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
  },
  offlineText: {
    color: '#991B1B',
  },
  restoredText: {
    color: '#065F46',
  },
});
