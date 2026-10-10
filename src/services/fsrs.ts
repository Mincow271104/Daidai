import { FSRS, generatorParameters, Card, Rating, State } from 'ts-fsrs';
import { FSRSState } from '../types';
import { getFSRSState, updateFSRSState } from '../database/repository';

const params = generatorParameters({ enable_fuzz: true, maximum_interval: 365 });
const fsrs = new FSRS(params);

export function dbStateToCard(state: FSRSState): Card {
  // Đảm bảo không vi phạm FSRS invariant: nếu New (0) thì cả stability và difficulty đều phải = 0
  const isNew = state.state === 0;
  const stability = isNew ? 0 : Math.max(0, state.stability || 0);
  const difficulty = (isNew || stability === 0) ? 0 : Math.max(0, state.difficulty || 0);

  return {
    due: new Date(state.next_review || Date.now()),
    stability,
    difficulty,
    elapsed_days: Math.max(0, state.elapsed_days || 0),
    scheduled_days: Math.max(0, state.scheduled_days || 0),
    reps: Math.max(0, state.reps || 0),
    lapses: Math.max(0, state.lapses || 0),
    state: (state.state || 0) as State,
    last_review: state.last_review ? new Date(state.last_review) : undefined,
  } as Card;
}


export function cardToDbState(vocabId: string, card: Card): FSRSState {
  return {
    vocab_id: vocabId,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review?.getTime(),
    next_review: card.due.getTime(),
  };
}

export async function recordAnswer(
  vocabId: string,
  isCorrect: boolean,
  timeTakenMs?: number
): Promise<{ nextReviewDate: Date; intervalDays: number }> {
  const dbState = await getFSRSState(vocabId);
  if (!dbState) throw new Error(`No FSRS state for vocab: ${vocabId}`);

  const card = dbStateToCard(dbState);
  const now = new Date();

  const rating: Rating = isCorrect
    ? timeTakenMs && timeTakenMs < 5000
      ? Rating.Easy
      : Rating.Good
    : Rating.Again;

  const scheduling = fsrs.repeat(card, now);
  const result = scheduling[rating];
  const updatedCard = result.card;

  const newState = cardToDbState(vocabId, updatedCard);

  // Nếu trả lời sai, câu/từ này lập tức cần ôn tập lại ngay (due ngay bây giờ)
  if (!isCorrect) {
    newState.next_review = Date.now() - 1000;
  }

  await updateFSRSState(newState);

  return {
    nextReviewDate: new Date(newState.next_review),
    intervalDays: isCorrect ? updatedCard.scheduled_days : 0,
  };
}

export function getDaysUntilReview(nextReviewTimestamp: number): number {
  const now = Date.now();
  const diff = nextReviewTimestamp - now;
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}
