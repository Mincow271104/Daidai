export interface Field {
  key: string;
  label: string;
  /** Tên ngành đưa vào prompt cho AI */
  prompt: string;
}

export const FIELDS: Field[] = [
  { key: 'daily', label: 'Đời sống & Giao tiếp', prompt: 'daily life, lifestyle, travel, food, casual conversation and living' },
  { key: 'it', label: 'Công nghệ thông tin', prompt: 'information technology / software engineering' },
  { key: 'finance', label: 'Tài chính – Ngân hàng', prompt: 'finance and banking' },
  { key: 'medical', label: 'Y tế', prompt: 'medicine and healthcare' },
  { key: 'law', label: 'Luật', prompt: 'law and legal affairs' },
  { key: 'marketing', label: 'Marketing', prompt: 'marketing and advertising' },
  { key: 'mechanical', label: 'Cơ khí – Sản xuất', prompt: 'mechanical engineering and manufacturing' },
  { key: 'electronics', label: 'Điện tử – Bán dẫn', prompt: 'electronics and semiconductor industry' },
  { key: 'logistics', label: 'Logistics – Xuất nhập khẩu', prompt: 'logistics, shipping and import-export' },
  { key: 'hospitality', label: 'Du lịch – Nhà hàng', prompt: 'tourism, hotel and restaurant' },
  { key: 'education', label: 'Giáo dục', prompt: 'education and teaching' },
];

export const DEFAULT_FIELD = 'daily';

export function getField(key: string): Field {
  return FIELDS.find((f) => f.key === key) ?? FIELDS[0];
}
