/** Trộn mảng (Fisher–Yates) – thay AI làm việc xáo trộn đáp án để tiết kiệm token */
export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Ghép 1 đáp án đúng + các đáp án sai, trộn ngẫu nhiên, trả về vị trí đáp án đúng */
export function buildOptions(answer: string, wrong: string[]): { options: string[]; correct_index: number } {
  const uniqueWrong = Array.from(new Set(wrong.filter((w) => w && w !== answer))).slice(0, 3);
  const options = shuffle([answer, ...uniqueWrong]);
  return { options, correct_index: options.indexOf(answer) };
}

export interface OptionWithPinyin {
  text: string;
  pinyin?: string;
  vi?: string;
}

export interface OptionWithMeta {
  text: string;
  pinyin?: string;
  vi?: string;
}

/** Ghép 1 đáp án đúng + các đáp án sai kèm Pinyin và Vi, trộn ngẫu nhiên */
export function buildOptionsWithMeta(
  answer: OptionWithMeta,
  wrong: OptionWithMeta[]
): {
  options: string[];
  options_pinyin: string[];
  options_vi: string[];
  correct_index: number;
} {
  const seen = new Set<string>([answer.text]);
  const validWrong: OptionWithMeta[] = [];
  for (const w of wrong) {
    if (w.text && !seen.has(w.text)) {
      seen.add(w.text);
      validWrong.push(w);
      if (validWrong.length >= 3) break;
    }
  }
  const all = shuffle([answer, ...validWrong]);
  return {
    options: all.map((o) => o.text),
    options_pinyin: all.map((o) => o.pinyin || ''),
    options_vi: all.map((o) => o.vi || ''),
    correct_index: all.findIndex((o) => o.text === answer.text),
  };
}

/** Ghép 1 đáp án đúng + các đáp án sai kèm Pinyin (tương thích ngược) */
export function buildOptionsWithPinyin(
  answer: OptionWithPinyin,
  wrong: OptionWithPinyin[]
): { options: string[]; options_pinyin: string[]; options_vi: string[]; correct_index: number } {
  return buildOptionsWithMeta(answer, wrong);
}
