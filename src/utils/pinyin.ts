/**
 * Utility xử lý Pinyin và đồng bộ hóa âm tiết Pinyin với từng chữ Hán
 * Giải quyết triệt để lỗi từ ghép pinyin viết liền (ví dụ: hóngshāo, bùyào, xiāngcài, xièxiè)
 * được phân bổ chính xác 1-1 cho từng chữ Hán:
 *   紅 -> hóng, 燒 -> shāo, 不 -> bù, 要 -> yào, 香 -> xiāng, 菜 -> cài, 謝 -> xiè, 謝 -> xiè
 */

import { cleanChineseText } from './similarity';

// Toàn bộ 418 âm tiết cơ bản trong tiếng Trung phổ thông (Mandarin)
export const MANDARIN_SYLLABLES = new Set([
  'a', 'ai', 'an', 'ang', 'ao',
  'ba', 'bai', 'ban', 'bang', 'bao', 'bei', 'ben', 'beng', 'bi', 'bian', 'biao', 'bie', 'bin', 'bing', 'bo', 'bu',
  'ca', 'cai', 'can', 'cang', 'cao', 'ce', 'cen', 'ceng', 'cha', 'chai', 'chan', 'chang', 'chao', 'che', 'chen', 'cheng',
  'chi', 'chong', 'chou', 'chu', 'chua', 'chuai', 'chuan', 'chuang', 'chui', 'chun', 'chuo', 'ci', 'cong', 'cou', 'cu',
  'cuan', 'cui', 'cun', 'cuo',
  'da', 'dai', 'dan', 'dang', 'dao', 'de', 'dei', 'den', 'deng', 'di', 'dia', 'dian', 'diao', 'die', 'ding', 'diu',
  'dong', 'dou', 'du', 'duan', 'dui', 'dun', 'duo',
  'e', 'ei', 'en', 'eng', 'er',
  'fa', 'fan', 'fang', 'fei', 'fen', 'feng', 'fiao', 'fo', 'fou', 'fu',
  'ga', 'gai', 'gan', 'gang', 'gao', 'ge', 'gei', 'gen', 'geng', 'gong', 'gou', 'gu', 'gua', 'guai', 'guan', 'guang',
  'gui', 'gun', 'guo',
  'ha', 'hai', 'han', 'hang', 'hao', 'he', 'hei', 'hen', 'heng', 'hm', 'hng', 'hong', 'hou', 'hu', 'hua', 'huai',
  'huan', 'huang', 'hui', 'hun', 'huo',
  'ji', 'jia', 'jian', 'jiang', 'jiao', 'jie', 'jin', 'jing', 'jiong', 'jiu', 'ju', 'juan', 'jue', 'jun',
  'ka', 'kai', 'kan', 'kang', 'kao', 'ke', 'kei', 'ken', 'keng', 'kong', 'kou', 'ku', 'kua', 'kuai', 'kuan', 'kuang',
  'kui', 'kun', 'kuo',
  'la', 'lai', 'lan', 'lang', 'lao', 'le', 'lei', 'leng', 'li', 'lia', 'lian', 'liang', 'liao', 'lie', 'lin', 'ling',
  'liu', 'lo', 'long', 'lou', 'lu', 'luan', 'lun', 'luo', 'lv', 'lve',
  'm', 'ma', 'mai', 'man', 'mang', 'mao', 'me', 'mei', 'men', 'meng', 'mi', 'mian', 'miao', 'mie', 'min', 'ming',
  'miu', 'mo', 'mou', 'mu',
  'na', 'nai', 'nan', 'nang', 'nao', 'ne', 'nei', 'nen', 'neng', 'ng', 'ni', 'nia', 'nian', 'niang', 'niao', 'nie',
  'nin', 'ning', 'niu', 'nong', 'nou', 'nu', 'nuan', 'nun', 'nuo', 'nv', 'nve',
  'o', 'ou',
  'pa', 'pai', 'pan', 'pang', 'pao', 'pei', 'pen', 'peng', 'pi', 'pian', 'piao', 'pie', 'pin', 'ping', 'po', 'pou', 'pu',
  'qi', 'qia', 'qian', 'qiang', 'qiao', 'qie', 'qin', 'qing', 'qiong', 'jiu', 'qu', 'quan', 'que', 'qun',
  'ran', 'rang', 'rao', 're', 'ren', 'reng', 'ri', 'rong', 'rou', 'ru', 'ruan', 'rui', 'run', 'ruo',
  'sa', 'sai', 'san', 'sang', 'sao', 'se', 'sei', 'sen', 'seng', 'sha', 'shai', 'shan', 'shang', 'shao', 'she',
  'shei', 'shen', 'sheng', 'shi', 'shou', 'shu', 'shua', 'shuai', 'shuan', 'shuang', 'shui', 'shun', 'shuo', 'si',
  'song', 'sou', 'su', 'suan', 'sui', 'sun', 'suo',
  'ta', 'tai', 'tan', 'tang', 'tao', 'te', 'tei', 'teng', 'ti', 'tian', 'tiao', 'tie', 'ting', 'tong', 'tou', 'tu',
  'tuan', 'tui', 'tun', 'tuo',
  'wa', 'wai', 'wan', 'wang', 'wei', 'wen', 'weng', 'wo', 'wu',
  'xi', 'xia', 'xian', 'xiang', 'xiao', 'xie', 'xin', 'xing', 'xiong', 'xiu', 'xu', 'xuan', 'xue', 'xun',
  'ya', 'yan', 'yang', 'yao', 'ye', 'yi', 'yin', 'ying', 'yo', 'yong', 'you', 'yu', 'yuan', 'yue', 'yun',
  'za', 'zai', 'zan', 'zang', 'zao', 'ze', 'zei', 'zen', 'zeng', 'zha', 'zhai', 'zhan', 'zhang', 'zhao', 'zhe',
  'zhei', 'zhen', 'zheng', 'zhi', 'zhong', 'zhou', 'zhu', 'zhua', 'zhuai', 'zhuan', 'zhuang', 'zhui', 'zhun', 'zhuo',
  'zi', 'zong', 'zou', 'zu', 'zuan', 'zui', 'zun', 'zuo'
]);

// Bảng ánh xạ nguyên âm có dấu thanh sang chữ cái thường không dấu
const PINYIN_TONE_MAP: Record<string, string> = {
  'ā': 'a', 'á': 'a', 'ǎ': 'a', 'à': 'a',
  'ē': 'e', 'é': 'e', 'ě': 'e', 'è': 'e',
  'ī': 'i', 'í': 'i', 'ǐ': 'i', 'ì': 'i',
  'ō': 'o', 'ó': 'o', 'ǒ': 'o', 'ò': 'o',
  'ū': 'u', 'ú': 'u', 'ǔ': 'u', 'ù': 'u',
  'ǖ': 'v', 'ǘ': 'v', 'ǚ': 'v', 'ǜ': 'v', 'ü': 'v',
};

/** Loại bỏ thanh điệu trong pinyin để so khớp ngữ âm */
export function stripPinyinTone(str: string): string {
  return str
    .split('')
    .map((c) => PINYIN_TONE_MAP[c.toLowerCase()] || c.toLowerCase())
    .join('');
}

/**
 * Tách một từ pinyin (có thể là từ ghép gồm nhiều âm tiết) thành các âm tiết riêng rẽ
 * Giữ nguyên dấu thanh điệu và viết hoa viết thường ban đầu
 */
export function segmentPinyinWord(word: string): string[] {
  if (!word) return [];
  const normWord = word.normalize('NFC');
  // Lọc bỏ dấu câu và ký hiệu ở đầu hoặc cuối từ (dấu phẩy, chấm, hỏi, than...)
  const clean = normWord.replace(
    /^[^a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]+|[^a-zA-Z\u00C0-\u024F\u1EA0-\u1EF9]+$/g,
    ''
  );
  if (!clean) return [];

  // Nếu từ chứa dấu nháy âm tiết (ví dụ: zài'jiàn, xī'ān)
  if (/['’]/.test(clean)) {
    const parts = clean.split(/['’]+/);
    const res: string[] = [];
    for (const p of parts) {
      if (p) res.push(...segmentPinyinWord(p));
    }
    return res;
  }

  const base = stripPinyinTone(clean);
  const n = base.length;

  // DFS tìm phân rã hợp lệ sao cho mọi thành phần đều là âm tiết tiếng Trung hợp lệ
  function dfs(start: number): string[] | null {
    if (start >= n) return [];
    // Độ dài âm tiết pinyin tối đa là 6 (chuang, shuang...)
    for (let len = Math.min(6, n - start); len >= 1; len--) {
      const sub = base.slice(start, start + len);
      if (MANDARIN_SYLLABLES.has(sub)) {
        if (start + len === n) {
          return [clean.slice(start, start + len)];
        }
        const rest = dfs(start + len);
        if (rest !== null) {
          return [clean.slice(start, start + len), ...rest];
        }
      }
    }
    return null;
  }

  const result = dfs(0);
  return result || [clean];
}

/**
 * Tách một chuỗi pinyin hoàn chỉnh thành mảng các âm tiết đơn lẻ (1 âm tiết cho 1 chữ Hán)
 * Tự động phân rã các từ ghép viết dính như "hóngshāo" -> ["hóng", "shāo"]
 */
export function splitPinyinIntoSyllables(pinyinText?: string): string[] {
  if (!pinyinText) return [];
  const tokens = pinyinText.trim().split(/\s+/).filter(Boolean);
  const syllables: string[] = [];
  for (const token of tokens) {
    const segs = segmentPinyinWord(token);
    syllables.push(...segs);
  }
  return syllables;
}

export interface AlignedChineseTile {
  char: string;
  pinyin: string;
}

/**
 * Đồng bộ hóa chuỗi chữ Hán với chuỗi Pinyin
 * Trả về mảng từng chữ Hán kèm theo đúng âm tiết Pinyin tương ứng
 */
export function alignPinyinWithChinese(
  targetSentence: string,
  targetPinyin?: string
): AlignedChineseTile[] {
  const cleaned = cleanChineseText(targetSentence);
  if (!cleaned) return [];

  const chars = cleaned.split('');
  const syllables = splitPinyinIntoSyllables(targetPinyin);

  return chars.map((char, i) => ({
    char,
    pinyin: syllables[i] || '',
  }));
}
