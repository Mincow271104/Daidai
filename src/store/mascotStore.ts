import { create } from 'zustand';
import { MascotState } from '../types';

interface MascotStore {
  state: MascotState;
  message: string;
  setState: (state: MascotState, message?: string) => void;
  setMessage: (message: string) => void;
  reset: () => void;
}

export const useMascotStore = create<MascotStore>((set) => ({
  state: 'idle',
  message: '',
  setState: (state, message) => set({ state, message: message ?? '' }),
  setMessage: (message) => set({ message }),
  reset: () => set({ state: 'idle', message: '' }),
}));
