import React, { useRef, useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  LayoutRectangle,
  StyleProp,
  TextStyle,
  ViewStyle,
  Pressable,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { speakChinese } from '../utils/speak';
import { useScrollLockStore } from '../store/scrollLockStore';

interface ClickableSentenceProps {
  sentence: string;
  chunks?: string[];
  onPressWord: (word: string, fullSentence: string) => void;
  textStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  highlightColor?: string;
  enableFloatingPill?: boolean;
  onScrollLock?: (locked: boolean) => void;
}

export function ClickableSentence({
  sentence,
  chunks,
  onPressWord,
  textStyle,
  containerStyle,
  highlightColor = '#6366F1',
  enableFloatingPill = true,
  onScrollLock,
}: ClickableSentenceProps) {
  const chars = useMemo(() => Array.from(sentence), [sentence]);
  const layouts = useRef<Record<number, LayoutRectangle>>({});
  const containerWidthRef = useRef<number>(360);
  const dragStartRef = useRef<number>(-1);
  const dragEndRef = useRef<number>(-1);
  const isDraggingRef = useRef<boolean>(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoldActiveRef = useRef<boolean>(false);
  const hasMovedRef = useRef<boolean>(false);

  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);
  const [floatingPill, setFloatingPill] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);
  const pillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setGlobalScrollLock = useCallback(
    (locked: boolean) => {
      onScrollLock?.(locked);
      useScrollLockStore.getState().setScrollLocked(locked);
    },
    [onScrollLock]
  );

  // Xóa timer pill và nhả khóa cuộn khi unmount
  useEffect(() => {
    return () => {
      if (pillTimerRef.current) clearTimeout(pillTimerRef.current);
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      setGlobalScrollLock(false);
    };
  }, [setGlobalScrollLock]);

interface WordEntry {
  word: string;
  start: number;
  end: number;
}

  // Xây dựng bản đồ index ký tự -> từ vựng đơn/ghép kèm vị trí start/end chính xác
  const charToWordMap = useMemo(() => {
    const map: Record<number, WordEntry> = {};
    if (!sentence) return map;

    // 1. Chỉ nhận chunks ngắn (tối đa 4 ký tự) để tránh nuốt trọn cả câu/mệnh đề
    if (chunks && chunks.length > 0) {
      let searchStart = 0;
      for (const chunk of chunks) {
        const chunkStr = chunk.trim();
        if (!chunkStr || Array.from(chunkStr).length > 4) continue;
        const pos = sentence.indexOf(chunkStr, searchStart);
        if (pos !== -1) {
          const charLen = Array.from(chunkStr).length;
          const entry: WordEntry = {
            word: chunkStr,
            start: pos,
            end: pos + charLen - 1,
          };
          for (let k = 0; k < charLen; k++) {
            map[pos + k] = entry;
          }
          searchStart = pos + charLen;
        }
      }
    }

    // 2. Dùng Intl.Segmenter tiếng Trung Phồn thể Đài Loan để tách từ ghép thực tế (2-4 chữ)
    try {
      if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
        const segmenter = new (Intl as any).Segmenter('zh-TW', { granularity: 'word' });
        let currentPos = 0;
        for (const seg of segmenter.segment(sentence)) {
          const word = seg.segment;
          const wordLen = Array.from(word).length;
          // Chỉ lưu từ nếu độ dài hợp lý (từ ghép 2-4 ký tự) và là từ thực tế
          if (wordLen >= 2 && wordLen <= 4 && seg.isWordLike) {
            const entry: WordEntry = {
              word,
              start: currentPos,
              end: currentPos + wordLen - 1,
            };
            for (let k = 0; k < wordLen; k++) {
              if (!map[currentPos + k]) {
                map[currentPos + k] = entry;
              }
            }
          }
          currentPos += wordLen;
        }
      }
    } catch {
      // fallback
    }

    // 3. Quét các từ tiếng Anh / tiếng Việt (Ký tự Latinh & số)
    const latinWordRegex = /[\p{L}\p{N}'-]+/gu;
    let match: RegExpExecArray | null;
    while ((match = latinWordRegex.exec(sentence)) !== null) {
      const word = match[0];
      const matchIndex = match.index;
      const wordCharCount = Array.from(word).length;
      const entry: WordEntry = {
        word,
        start: matchIndex,
        end: matchIndex + wordCharCount - 1,
      };
      for (let k = 0; k < wordCharCount; k++) {
        if (!map[matchIndex + k]) {
          map[matchIndex + k] = entry;
        }
      }
    }

    return map;
  }, [sentence, chunks]);

  // Tìm index ký tự nằm dưới tọa độ ngón tay (x, y) theo dòng và vị trí thực tế
  const findCharIndex = useCallback(
    (x: number, y: number): number => {
      if (chars.length === 0) return -1;

      const lines: { y: number; height: number; chars: { idx: number; layout: LayoutRectangle }[] }[] = [];

      for (let i = 0; i < chars.length; i++) {
        const layout = layouts.current[i];
        if (!layout) continue;

        let line = lines.find((l) => Math.abs(l.y - layout.y) < 8);
        if (!line) {
          line = { y: layout.y, height: layout.height, chars: [] };
          lines.push(line);
        }
        line.chars.push({ idx: i, layout });
      }

      if (lines.length === 0) return -1;

      lines.sort((a, b) => a.y - b.y);

      let bestLine = lines[0];
      let minLineDist = Infinity;
      for (const line of lines) {
        const lineCenterY = line.y + line.height / 2;
        const dist = Math.abs(y - lineCenterY);
        if (dist < minLineDist) {
          minLineDist = dist;
          bestLine = line;
        }
      }

      bestLine.chars.sort((a, b) => a.layout.x - b.layout.x);

      for (const item of bestLine.chars) {
        if (x >= item.layout.x && x <= item.layout.x + item.layout.width) {
          return item.idx;
        }
      }

      if (x < bestLine.chars[0].layout.x) {
        return bestLine.chars[0].idx;
      }
      const last = bestLine.chars[bestLine.chars.length - 1];
      if (x > last.layout.x + last.layout.width) {
        return last.idx;
      }

      let closestIdx = bestLine.chars[0].idx;
      let minXDist = Infinity;
      for (const item of bestLine.chars) {
        const centerX = item.layout.x + item.layout.width / 2;
        const dist = Math.abs(x - centerX);
        if (dist < minXDist) {
          minXDist = dist;
          closestIdx = item.idx;
        }
      }

      return closestIdx;
    },
    [chars.length]
  );

  // TÔN TRỌNG CHÍNH XÁC ĐOẠN NGƯỜI DÙNG KÉO - Chỉ loại bỏ dấu câu đơn độc ở 2 đầu
  const sanitizeSelectionRange = useCallback(
    (startIdx: number, endIdx: number) => {
      let minIdx = Math.min(startIdx, endIdx);
      let maxIdx = Math.max(startIdx, endIdx);

      // Loại bỏ các dấu câu đơn độc ở 2 đầu (nếu lỡ quẹt dính)
      const punctuationChars = new Set([
        ' ', '，', '。', '！', '？', '、', ',', '.', '!', '?', ':', ';', '”', '“', '"', "'", '（', '）', '(', ')',
      ]);
      while (minIdx <= maxIdx && punctuationChars.has(chars[minIdx])) {
        minIdx++;
      }
      while (maxIdx >= minIdx && punctuationChars.has(chars[maxIdx])) {
        maxIdx--;
      }

      if (minIdx > maxIdx) return null;
      return { start: minIdx, end: maxIdx };
    },
    [chars]
  );

  const resetFloatingPill = useCallback(() => {
    if (pillTimerRef.current) clearTimeout(pillTimerRef.current);
    setGlobalScrollLock(false);
    setFloatingPill(null);
    setSelectionRange(null);
  }, [setGlobalScrollLock]);

  const handlePillSpeak = useCallback(() => {
    if (!floatingPill) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    speakChinese(floatingPill.text);
  }, [floatingPill]);

  const handlePillExplain = useCallback(() => {
    if (!floatingPill) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const selectedText = floatingPill.text;
    resetFloatingPill();
    onPressWord(selectedText, sentence);
  }, [floatingPill, onPressWord, resetFloatingPill, sentence]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,

        onMoveShouldSetPanResponder: (_, gestureState) => {
          // Khi đã nhấn giữ hoặc đang chọn chữ -> luôn xử lý di chuyển
          if (isHoldActiveRef.current || isDraggingRef.current) return true;
          // Kéo ngang rõ ràng
          return Math.abs(gestureState.dx) > 5;
        },

        // Không bao giờ nhường quyền cho ScrollView khi đang nhấn giữ hoặc đang kéo chọn chữ
        onPanResponderTerminationRequest: () => {
          return !(isHoldActiveRef.current || isDraggingRef.current);
        },

        onPanResponderGrant: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          const hitIdx = findCharIndex(locationX, locationY);
          if (hitIdx !== -1) {
            dragStartRef.current = hitIdx;
            dragEndRef.current = hitIdx;
            isDraggingRef.current = false;
            isHoldActiveRef.current = false;
            hasMovedRef.current = false;
            setSelectionRange({ start: hitIdx, end: hitIdx });
            if (floatingPill) {
              setFloatingPill(null);
            }

            // KHI NHẤN GIỮ VÀO TỪ (Long-press ~180ms):
            if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
            holdTimerRef.current = setTimeout(() => {
              isHoldActiveRef.current = true;
              isDraggingRef.current = true;
              // 1. TẮT CHỨC NĂNG CUỘN MÀN HÌNH ĐỂ KÉO CHỮ THOẢI MÁI
              setGlobalScrollLock(true);
              // 2. Rung phản hồi để người dùng biết đã kích hoạt chế độ chọn chữ
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

              // 3. Highlight từ đang nhấn giữ (Dùng chính xác phạm vi từ, KHÔNG search indexOf)
              const entry = charToWordMap[hitIdx];
              const wordStart = entry ? entry.start : hitIdx;
              const wordEnd = entry ? entry.end : hitIdx;
              dragStartRef.current = wordStart;
              dragEndRef.current = wordEnd;
              setSelectionRange({
                start: wordStart,
                end: wordEnd,
              });
            }, 180);
          } else {
            dragStartRef.current = -1;
            dragEndRef.current = -1;
            setSelectionRange(null);
          }
        },

        onPanResponderMove: (evt, gestureState) => {
          if (dragStartRef.current === -1) return;

          const moveDist = Math.hypot(gestureState.dx, gestureState.dy);

          // Nếu chưa kích hoạt nhấn giữ mà người dùng đã di chuyển ngón tay
          if (!isHoldActiveRef.current && !isDraggingRef.current) {
            // Vuốt dọc nhanh để cuộn trang bình thường mà không nhấn giữ
            if (Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.5 && moveDist > 10) {
              if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
              dragStartRef.current = -1;
              setSelectionRange(null);
              return;
            }

            // Kéo ngang hoặc kéo sau khi chạm
            if (Math.abs(gestureState.dx) > 6 || moveDist > 12) {
              if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
              isHoldActiveRef.current = true;
              isDraggingRef.current = true;
              setGlobalScrollLock(true);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
          }

          // Khi đã ở chế độ chọn chữ (đã khóa cuộn màn hình):
          // Cho phép kéo tự do theo mọi hướng (kể cả kéo dọc từ dòng trên xuống dòng dưới)
          if (isHoldActiveRef.current || isDraggingRef.current) {
            setGlobalScrollLock(true);
            hasMovedRef.current = true;

            const { locationX, locationY } = evt.nativeEvent;
            const currentIdx = findCharIndex(locationX, locationY);
            if (currentIdx !== -1 && currentIdx !== dragEndRef.current) {
              dragEndRef.current = currentIdx;
              setSelectionRange({
                start: Math.min(dragStartRef.current, currentIdx),
                end: Math.max(dragStartRef.current, currentIdx),
              });
              Haptics.selectionAsync();
            }
          }
        },

        onPanResponderRelease: () => {
          if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
          // LUÔN MỞ LẠI CUỘN MÀN HÌNH KHI THẢ TAY
          setGlobalScrollLock(false);

          if (dragStartRef.current === -1) return;

          const wasDragging = (isHoldActiveRef.current || isDraggingRef.current) && hasMovedRef.current;

          if (wasDragging && dragEndRef.current !== -1 && dragStartRef.current !== dragEndRef.current) {
            // Người dùng nắm kéo chọn 1 khoảng từ A -> B (kể cả từ dòng trên xuống dòng dưới)
            const range = sanitizeSelectionRange(dragStartRef.current, dragEndRef.current);
            if (range) {
              const selectedText = chars.slice(range.start, range.end + 1).join('').trim();
              if (selectedText) {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setSelectionRange(range);

                if (enableFloatingPill) {
                  // Căn chỉnh vị trí Floating Action Pill: căn giữa cụm chọn và ép chặt trong màn hình
                  const startL = layouts.current[range.start];
                  const endL = layouts.current[range.end];
                  const containerW = containerWidthRef.current || 340;
                  const pillWidth = 175;

                  const selLeft = startL ? startL.x : 10;
                  const selRight = endL ? endL.x + endL.width : selLeft + 40;
                  const centerX = (selLeft + selRight) / 2;

                  // Đảm bảo pill luôn nằm trọn vẹn trong màn hình, không bị cut off ở mép phải
                  const pillX = Math.max(8, Math.min(centerX - pillWidth / 2, containerW - pillWidth - 8));
                  const pillY = startL ? Math.max(-42, startL.y - 38) : -38;

                  setFloatingPill({
                    text: selectedText,
                    x: pillX,
                    y: pillY,
                  });

                  if (pillTimerRef.current) clearTimeout(pillTimerRef.current);
                  pillTimerRef.current = setTimeout(() => {
                    resetFloatingPill();
                  }, 6000);
                } else {
                  onPressWord(selectedText, sentence);
                  setTimeout(() => {
                    setSelectionRange(null);
                  }, 350);
                }
              }
            }
          } else {
            // Người dùng chỉ chạm 1 lần vào từ/chữ đó (hoặc nhấn giữ tại chỗ rồi thả ra)
            const idx = dragStartRef.current;
            if (idx >= 0 && idx < chars.length) {
              const entry = charToWordMap[idx];
              const targetWord = entry ? entry.word : chars[idx];
              const trimmed = targetWord?.trim();
              if (trimmed && !/^[\s，。！？、,.\?!:;]+$/.test(trimmed)) {
                const wordStart = entry ? entry.start : idx;
                const wordEnd = entry ? entry.end : idx;
                setSelectionRange({
                  start: wordStart,
                  end: wordEnd,
                });
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                onPressWord(trimmed, sentence);
              }
            }

            // Với 1 chạm nhanh: Xóa highlight sau 350ms
            setTimeout(() => {
              setSelectionRange(null);
              dragStartRef.current = -1;
              dragEndRef.current = -1;
              isDraggingRef.current = false;
              isHoldActiveRef.current = false;
              hasMovedRef.current = false;
            }, 350);
          }
        },

        onPanResponderTerminate: () => {
          if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
          setGlobalScrollLock(false);
          setSelectionRange(null);
          dragStartRef.current = -1;
          dragEndRef.current = -1;
          isDraggingRef.current = false;
          isHoldActiveRef.current = false;
          hasMovedRef.current = false;
        },
      }),
    [
      chars,
      findCharIndex,
      sanitizeSelectionRange,
      enableFloatingPill,
      onPressWord,
      sentence,
      charToWordMap,
      floatingPill,
      resetFloatingPill,
      setGlobalScrollLock,
    ]
  );

  return (
    <View
      style={[styles.container, containerStyle]}
      onLayout={(e) => {
        containerWidthRef.current = e.nativeEvent.layout.width;
      }}
    >
      {/* Floating Action Pill khi kéo chọn đoạn văn bản */}
      {floatingPill && (
        <View
          style={[
            styles.floatingPill,
            {
              top: floatingPill.y,
              left: floatingPill.x,
            },
          ]}
        >
          <Pressable style={styles.pillBtn} onPress={handlePillSpeak} hitSlop={6}>
            <Feather name="volume-2" size={13} color="#FFFFFF" />
            <Text style={styles.pillBtnText}>Nghe</Text>
          </Pressable>

          <View style={styles.pillDivider} />

          <Pressable style={styles.pillBtn} onPress={handlePillExplain} hitSlop={6}>
            <Feather name="search" size={13} color="#FFFFFF" />
            <Text style={styles.pillBtnText}>Tra nghĩa</Text>
          </Pressable>

          <View style={styles.pillDivider} />

          <Pressable style={styles.pillCloseBtn} onPress={resetFloatingPill} hitSlop={8}>
            <Feather name="x" size={13} color="#94A3B8" />
          </Pressable>
        </View>
      )}

      <View style={styles.sentenceWrap}>
        {chars.map((ch, idx) => {
          const isSpace = ch === ' ';
          const isSelected =
            selectionRange &&
            idx >= Math.min(selectionRange.start, selectionRange.end) &&
            idx <= Math.max(selectionRange.start, selectionRange.end);

          if (isSpace) {
            return (
              <View
                key={idx}
                pointerEvents="none"
                style={styles.spaceBox}
                onLayout={(e) => {
                  layouts.current[idx] = e.nativeEvent.layout;
                }}
              >
                <Text style={styles.spaceText}> </Text>
              </View>
            );
          }

          return (
            <View
              key={idx}
              pointerEvents="none"
              style={[
                styles.charBox,
                isSelected && { backgroundColor: highlightColor },
              ]}
              onLayout={(e) => {
                layouts.current[idx] = e.nativeEvent.layout;
              }}
            >
              <Text
                style={[
                  styles.charText,
                  textStyle,
                  isSelected && styles.charTextSelected,
                ]}
              >
                {ch}
              </Text>
            </View>
          );
        })}

        {/* Lớp cảm ứng trong suốt bao phủ toàn bộ khối văn bản đón nhận chính xác tọa độ x, y */}
        <View
          collapsable={false}
          style={styles.touchOverlay}
          {...panResponder.panHandlers}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    position: 'relative',
  },
  floatingPill: {
    position: 'absolute',
    zIndex: 999,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 20,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#334155',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 8,
  },
  pillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  pillBtnText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
  },
  pillDivider: {
    width: 1,
    height: 12,
    backgroundColor: '#334155',
    marginHorizontal: 2,
  },
  pillCloseBtn: {
    paddingHorizontal: 3,
    paddingVertical: 2,
  },
  sentenceWrap: {
    position: 'relative',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingVertical: 2,
  },
  touchOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.001)',
    zIndex: 10,
  },
  charBox: {
    paddingHorizontal: 0,
    paddingVertical: 1,
    marginHorizontal: 0,
    borderRadius: 3,
  },
  charText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0,
  },
  charTextSelected: {
    color: '#FFFFFF',
  },
  spaceBox: {
    width: 6,
    justifyContent: 'center',
  },
  spaceText: {
    fontSize: 20,
  },
});
