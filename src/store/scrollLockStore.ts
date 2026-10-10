import { create } from 'zustand';

interface ScrollLockStore {
  isScrollLocked: boolean;
  setScrollLocked: (locked: boolean) => void;
}

export const useScrollLockStore = create<ScrollLockStore>((set) => ({
  isScrollLocked: false,
  setScrollLocked: (locked: boolean) => set({ isScrollLocked: locked }),
}));
