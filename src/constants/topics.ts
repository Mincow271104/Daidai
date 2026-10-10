export interface Topic {
  id?: string;
  key: string;
  label: string;
  icon?: string;
  is_default?: boolean;
}

export type TopicItem = Topic;

export const DEFAULT_TOPICS: Topic[] = [
  { key: 'other', label: 'Khác', is_default: true },
  { key: 'work', label: 'Công sở', is_default: true },
  { key: 'daily', label: 'Đời sống', is_default: true },
  { key: 'food', label: 'Ăn uống', is_default: true },
  { key: 'shopping', label: 'Mua sắm', is_default: true },
  { key: 'travel', label: 'Di chuyển & hỏi đường', is_default: true },
  { key: 'greeting', label: 'Chào hỏi', is_default: true },
  { key: 'feelings', label: 'Cảm xúc', is_default: true },
  { key: 'health', label: 'Sức khỏe', is_default: true },
];

export const TOPICS: Topic[] = DEFAULT_TOPICS;

export const DEFAULT_TOPIC = 'other';

const topicCache: Map<string, Topic> = new Map(
  DEFAULT_TOPICS.map((t) => [t.key.toLowerCase(), t])
);

export function registerTopics(topics: Topic[]): void {
  for (const t of topics) {
    if (t?.key) {
      topicCache.set(t.key.toLowerCase(), t);
    }
  }
}

export function getTopic(key?: string): Topic {
  if (!key) return { key: 'other', label: 'Khác', is_default: true };
  const found = topicCache.get(key.toLowerCase());
  if (found) return found;
  return { key, label: key, is_default: false };
}
