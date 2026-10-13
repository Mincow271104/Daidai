import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, StyleSheet, Platform, LogBox, ActivityIndicator } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Feather } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initDatabase } from './src/database/schema';
import { requestNotificationPermission, syncAllSmartNotifications } from './src/services/notifications';
import { initNetworkListener } from './src/services/network';
import { OfflineNotice } from './src/components/OfflineNotice';
import { HomeScreen } from './src/screens/HomeScreen';
import { ConversationScreen } from './src/screens/ConversationScreen';
import { QuestScreen } from './src/screens/QuestScreen';
import { FieldScreen } from './src/screens/FieldScreen';
import { VocabScreen } from './src/screens/VocabScreen';
import { AiChatScreen } from './src/screens/AiChatScreen';

// Ẩn các cảnh báo môi trường thử nghiệm Expo Go không ảnh hưởng tính năng
LogBox.ignoreLogs([
  'expo-notifications:',
  '`expo-notifications` functionality is not fully supported in Expo Go',
  'SafeAreaView has been deprecated',
  'Method readAsStringAsync imported from "expo-file-system" is deprecated',
]);

const Tab = createBottomTabNavigator();

// Theme sáng, tươi tắn, phong cách hoạt hình (Cartoon Pastel)
const NAV_THEME = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: '#FFFDF9',
    card: '#FFFFFF',
    border: '#F1F5F9',
    primary: '#6366F1',
    text: '#0F172A',
  },
};

export default function App() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    async function setup() {
      try {
        await initDatabase();
        await requestNotificationPermission();
        await syncAllSmartNotifications();
      } catch (err) {
        console.error('Setup error:', err);
      } finally {
        setIsReady(true);
      }
    }
    setup();

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as any;
      if (data?.type === 'evening_quest' || data?.type === 'streak_saver') {
        console.log('Navigate to Quest from notification');
      }
    });

    const unsubNetwork = initNetworkListener();

    return () => {
      sub.remove();
      unsubNetwork();
    };
  }, []);

  if (!isReady) {
    return (
      <View style={styles.loadingContainer}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color="#6366F1" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <OfflineNotice />
      <NavigationContainer theme={NAV_THEME}>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarStyle: {
              backgroundColor: '#FFFFFF',
              borderTopColor: '#F1F5F9',
              borderTopWidth: 2,
              height: Platform.OS === 'ios' ? 86 : 66,
              paddingBottom: Platform.OS === 'ios' ? 24 : 8,
              paddingTop: 6,
              shadowColor: '#0F172A',
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.05,
              shadowRadius: 12,
              elevation: 8,
            },
            tabBarActiveTintColor: '#6366F1',
            tabBarInactiveTintColor: '#94A3B8',
            tabBarLabelStyle: {
              fontSize: 11,
              fontWeight: '700',
              marginTop: 2,
            },
          }}
        >
          <Tab.Screen
            name="Conversation"
            component={ConversationScreen}
            options={{
              tabBarLabel: 'Hội thoại',
              tabBarIcon: ({ color, focused }) => (
                <View style={[styles.tabIconWrap, focused && styles.tabIconWrapActive]}>
                  <Feather name="message-circle" size={19} color={color} />
                </View>
              ),
            }}
          />

          <Tab.Screen
            name="AiChat"
            component={AiChatScreen}
            options={{
              tabBarLabel: 'Trợ lý AI',
              tabBarIcon: ({ color, focused }) => (
                <View style={[styles.tabIconWrap, focused && styles.tabIconWrapActive]}>
                  <Feather name="message-square" size={19} color={color} />
                </View>
              ),
            }}
          />

          <Tab.Screen
            name="Home"
            component={HomeScreen}
            options={{
              tabBarLabel: 'Học tập',
              tabBarIcon: ({ color, focused }) => (
                <View style={[styles.tabIconWrap, focused && styles.tabIconWrapActive]}>
                  <Feather name="mic" size={19} color={color} />
                </View>
              ),
            }}
          />

          <Tab.Screen
            name="Vocab"
            component={VocabScreen}
            options={{
              tabBarLabel: 'Kho từ',
              tabBarIcon: ({ color, focused }) => (
                <View style={[styles.tabIconWrap, focused && styles.tabIconWrapActive]}>
                  <Feather name="book-open" size={19} color={color} />
                </View>
              ),
            }}
          />

          <Tab.Screen
            name="Quests"
            component={QuestScreen}
            options={{
              tabBarLabel: 'Bài tập',
              tabBarIcon: ({ color, focused }) => (
                <View style={[styles.tabIconWrap, focused && styles.tabIconWrapActive]}>
                  <Feather name="award" size={19} color={color} />
                </View>
              ),
            }}
          />

          <Tab.Screen
            name="Field"
            component={FieldScreen}
            options={{
              tabBarLabel: 'Ngành nghề',
              tabBarIcon: ({ color, focused }) => (
                <View style={[styles.tabIconWrap, focused && styles.tabIconWrapActive]}>
                  <Feather name="briefcase" size={19} color={color} />
                </View>
              ),
            }}
          />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#FFFDF9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconWrapActive: {
    backgroundColor: '#EEF2FF',
  },
});
