import { create } from 'zustand';

interface PreviewState {
  // Currently previewed file path
  previewFilePath: string | null;
  // Open file preview in right panel
  openPreview: (filePath: string) => void;
  // Close preview
  closePreview: () => void;
}

export const usePreviewStore = create<PreviewState>((set) => ({
  previewFilePath: null,

  openPreview: (filePath) => {
    set({ previewFilePath: filePath });
  },

  closePreview: () => {
    set({ previewFilePath: null });
  },
}));
