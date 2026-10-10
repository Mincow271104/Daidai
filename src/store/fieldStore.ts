import { create } from 'zustand';
import { getSetting, setSetting } from '../database/repository';
import { DEFAULT_FIELD } from '../constants/fields';

interface FieldStore {
  field: string;
  loaded: boolean;
  load: () => Promise<void>;
  setField: (key: string) => Promise<void>;
}

export const useFieldStore = create<FieldStore>((set) => ({
  field: DEFAULT_FIELD,
  loaded: false,
  load: async () => {
    try {
      const saved = await getSetting('field');
      set({ field: saved ?? DEFAULT_FIELD, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  setField: async (key) => {
    set({ field: key });
    await setSetting('field', key);
  },
}));
