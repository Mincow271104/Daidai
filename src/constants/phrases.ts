import { MascotState } from '../types';

const PHRASES: Record<MascotState, string[]> = {
  idle: [
    'Sư phụ ơi, hôm nay có từ mới nào không?',
    'DaiDai ngồi chờ từ sáng rồi đó.',
    'Nói một câu tiếng Anh đi, DaiDai ghi lại.',
  ],
  listening: ['DaiDai đang nghe...', 'Sư phụ cứ nói, DaiDai ghi nhớ.'],
  processing: ['Đợi DaiDai tra từ điển chút...', 'Não DaiDai đang chạy hết công suất...'],
  eureka: ['Sư phụ giỏi quá!', 'Đúng rồi! DaiDai hiểu rồi.', 'Tuyệt vời, thêm một từ nữa!'],
  confused: ['Hmm, chữ này khó quá...', 'Sai rồi, mình học lại nhé.'],
  sleeping: ['Zzz... không có gì cần ôn rồi.', 'DaiDai đi ngủ đây.'],
  teaching: ['DaiDai nghe sư phụ giảng đây.', 'Chọn đáp án đúng giúp DaiDai nhé.'],
};

export function getRandomPhrase(state: MascotState): string {
  const list = PHRASES[state];
  return list[Math.floor(Math.random() * list.length)];
}
