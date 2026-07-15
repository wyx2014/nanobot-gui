import { create } from 'zustand';
import { artifactFromPath, type ArtifactRef } from '@/core/artifacts';

interface PreviewState {
  previewArtifact: ArtifactRef | null;
  isExpanded: boolean;
  openArtifact: (artifact: ArtifactRef) => void;
  /** Backward-compatible local path entry point. */
  openPreview: (filePath: string) => void;
  toggleExpanded: () => void;
  closePreview: () => void;
}

export const usePreviewStore = create<PreviewState>((set) => ({
  previewArtifact: null,
  isExpanded: false,

  openArtifact: (artifact) => {
    set({ previewArtifact: artifact });
  },

  openPreview: (filePath) => {
    set({ previewArtifact: artifactFromPath(filePath) });
  },

  toggleExpanded: () => {
    set((state) => ({ isExpanded: !state.isExpanded }));
  },

  closePreview: () => {
    set({ previewArtifact: null, isExpanded: false });
  },
}));
