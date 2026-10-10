import { create } from 'zustand';
import { VocabularyItem, AIAnalysisResult } from '../types';
import { getAllVocabulary, getDueVocabulary, getTotalStats } from '../database/repository';

interface VocabStats {
  total: number;
  mastered: number;
  due: number;
}

interface VocabularyStore {
  vocabulary: VocabularyItem[];
  dueVocabulary: VocabularyItem[];
  stats: VocabStats;
  lastAnalysis: AIAnalysisResult | null;
  isLoading: boolean;
  error: string | null;

  loadVocabulary: () => Promise<void>;
  loadDueVocabulary: () => Promise<void>;
  loadStats: () => Promise<void>;
  setLastAnalysis: (result: AIAnalysisResult | null) => void;
  setError: (error: string | null) => void;
}

export const useVocabularyStore = create<VocabularyStore>((set) => ({
  vocabulary: [],
  dueVocabulary: [],
  stats: { total: 0, mastered: 0, due: 0 },
  lastAnalysis: null,
  isLoading: false,
  error: null,

  loadVocabulary: async () => {
    set({ isLoading: true, error: null });
    try {
      const items = await getAllVocabulary();
      set({ vocabulary: items, isLoading: false });
    } catch (e: any) {
      set({ error: e.message, isLoading: false });
    }
  },

  loadDueVocabulary: async () => {
    try {
      const items = await getDueVocabulary(10);
      set({ dueVocabulary: items });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  loadStats: async () => {
    try {
      const stats = await getTotalStats();
      set({ stats });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  setLastAnalysis: (result) => set({ lastAnalysis: result }),
  setError: (error) => set({ error }),
}));
