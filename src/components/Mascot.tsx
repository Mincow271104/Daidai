import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Image } from 'react-native';
import { MascotState } from '../types';

interface MascotProps {
  state: MascotState;
  message?: string;
  size?: number;
}

export function Mascot({ state, message, size = 130 }: MascotProps) {
  const bounceAnim = useRef(new Animated.Value(0)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    bounceAnim.stopAnimation();
    shakeAnim.stopAnimation();
    rotateAnim.stopAnimation();
    bounceAnim.setValue(0);
    shakeAnim.setValue(0);
    rotateAnim.setValue(0);

    let anim: Animated.CompositeAnimation | null = null;
    const t = (v: Animated.Value, to: number, d: number, easing?: any) =>
      Animated.timing(v, { toValue: to, duration: d, easing, useNativeDriver: true });

    if (state === 'idle' || state === 'teaching' || state === 'listening') {
      anim = Animated.loop(
        Animated.sequence([
          t(bounceAnim, -8, 900, Easing.inOut(Easing.sin)),
          t(bounceAnim, 0, 900, Easing.inOut(Easing.sin)),
        ])
      );
    } else if (state === 'processing') {
      anim = Animated.loop(
        Animated.sequence([
          t(shakeAnim, 5, 70), t(shakeAnim, -5, 70), t(shakeAnim, 3, 70), t(shakeAnim, 0, 70),
          Animated.delay(400),
        ])
      );
    } else if (state === 'eureka') {
      anim = Animated.loop(
        Animated.sequence([
          t(bounceAnim, -16, 250, Easing.out(Easing.quad)),
          t(bounceAnim, 0, 250, Easing.in(Easing.quad)),
          Animated.delay(150),
        ])
      );
    } else if (state === 'confused') {
      anim = Animated.loop(
        Animated.sequence([t(rotateAnim, 1, 150), t(rotateAnim, -1, 150), t(rotateAnim, 0, 150), Animated.delay(800)])
      );
    }
    anim?.start();
    return () => anim?.stop();
  }, [state]);

  const spin = rotateAnim.interpolate({ inputRange: [-1, 1], outputRange: ['-8deg', '8deg'] });

  return (
    <View style={styles.container}>
      <Animated.View
        style={{
          width: size,
          height: size,
          transform: [{ translateY: bounceAnim }, { translateX: shakeAnim }, { rotate: spin }],
        }}
      >
        <Image
          source={require('../../assets/daidai.png')}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          resizeMode="cover"
        />
      </Animated.View>

      {message ? (
        <View style={styles.bubbleContainer}>
          <View style={styles.bubbleArrow} />
          <View style={styles.bubble}>
            <Text style={styles.bubbleText}>{message}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: 4 },
  bubbleContainer: { marginTop: 8, maxWidth: 320, alignItems: 'center' },
  bubbleArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderBottomWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: '#E2E8F0',
    marginBottom: -1,
  },
  bubble: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  bubbleText: { color: '#1E293B', fontSize: 14, fontWeight: '600', textAlign: 'center', lineHeight: 21 },
});
