import { Alert } from 'react-native';
import * as Network from 'expo-network';
import { create } from 'zustand';

interface NetworkStore {
  isConnected: boolean;
  isInternetReachable: boolean;
  hasCheckedOnce: boolean;
  setNetworkStatus: (connected: boolean, reachable: boolean) => void;
}

export const useNetworkStore = create<NetworkStore>((set) => ({
  isConnected: true,
  isInternetReachable: true,
  hasCheckedOnce: false,
  setNetworkStatus: (connected, reachable) =>
    set({
      isConnected: connected,
      isInternetReachable: reachable,
      hasCheckedOnce: true,
    }),
}));

let listenerSubscription: any = null;

/**
 * Kiểm tra trạng thái mạng hiện tại của thiết bị
 */
export async function checkNetworkStatus(): Promise<{ isConnected: boolean; isInternetReachable: boolean }> {
  try {
    const state = await Network.getNetworkStateAsync();
    const connected = state.isConnected ?? true;
    const reachable = state.isInternetReachable ?? connected;
    useNetworkStore.getState().setNetworkStatus(connected, reachable);
    return { isConnected: connected, isInternetReachable: reachable };
  } catch {
    // Fallback ping nhanh tới Google gen_204 nếu hàm native gặp lỗi
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await fetch('https://clients3.google.com/generate_204', {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timer);
      const ok = res.status === 204 || res.status === 200;
      useNetworkStore.getState().setNetworkStatus(ok, ok);
      return { isConnected: ok, isInternetReachable: ok };
    } catch {
      useNetworkStore.getState().setNetworkStatus(false, false);
      return { isConnected: false, isInternetReachable: false };
    }
  }
}

/**
 * Khởi động bộ theo dõi thay đổi mạng liên tục
 */
export function initNetworkListener(): () => void {
  // Kiểm tra ngay khi khởi động
  checkNetworkStatus();

  try {
    if (Network.addNetworkStateListener) {
      listenerSubscription = Network.addNetworkStateListener((state) => {
        const connected = state.isConnected ?? true;
        const reachable = state.isInternetReachable ?? connected;
        useNetworkStore.getState().setNetworkStatus(connected, reachable);
      });
    }
  } catch (err) {
    console.warn('Network listener error:', err);
  }

  // Periodic polling nhẹ nhàng mỗi 15s để bắt sự kiện thay đổi mạng chắc chắn
  const interval = setInterval(() => {
    checkNetworkStatus();
  }, 15000);

  return () => {
    if (listenerSubscription && typeof listenerSubscription.remove === 'function') {
      listenerSubscription.remove();
      listenerSubscription = null;
    }
    clearInterval(interval);
  };
}

/**
 * Kiểm tra nhanh trước khi thực hiện hành động cần Internet
 * Nếu mất mạng: Tự động hiện thông báo Alert và trả về false
 */
export async function ensureOnline(featureName?: string): Promise<boolean> {
  const { isConnected, isInternetReachable } = await checkNetworkStatus();
  if (!isConnected) {
    Alert.alert(
      'Không có kết nối Internet',
      featureName
        ? `Tính năng "${featureName}" cần kết nối mạng để hoạt động. Vui lòng kiểm tra Wi-Fi hoặc 4G/5G của bạn nhé.`
        : 'Vui lòng kiểm tra lại kết nối Wi-Fi hoặc dữ liệu di động (4G/5G) để sử dụng tính năng này.'
    );
    return false;
  }
  return true;
}
