import { create } from 'zustand';

export type OfficeGuideStep = 'welcome' | 'category' | 'task' | 'workspace' | 'skills' | 'compose';

interface OfficeGuideState {
  step: OfficeGuideStep | null;
  error: string | null;
  open: () => void;
  close: () => void;
  advance: (from: OfficeGuideStep, to: OfficeGuideStep) => void;
  preparationFailed: (message: string | null) => void;
}

// The installation guide owns first-run persistence. Replaying this tour only
// changes ephemeral UI state and never resets installation/profile settings.
export const useOfficeGuideStore = create<OfficeGuideState>((set) => ({
  step: null,
  error: null,
  open: () => set({ step: 'welcome', error: null }),
  close: () => set({ step: null, error: null }),
  advance: (from, to) => set((state) => state.step === from ? { step: to, error: null } : state),
  preparationFailed: (error) => set((state) => state.step === 'task' ? { error } : state),
}));
