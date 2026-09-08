import { create } from 'zustand';

interface RevisionSelection {
  chatId: string;
  runId: string;
  roleId: string;
  mode: 'supplement' | 'retry';
}

// Both the transcript and workbench open the dialog owned by ChatView.
export const useExpertTeamRevisionStore = create<{
  selection: RevisionSelection | null;
  setSelection: (selection: RevisionSelection | null) => void;
}>((set) => ({
  selection: null,
  setSelection: (selection) => set({ selection }),
}));
