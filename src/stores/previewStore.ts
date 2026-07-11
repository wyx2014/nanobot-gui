import { create } from 'zustand';
import { artifactFromPath, type ArtifactRef } from '@/core/artifacts';

interface PreviewState {
  previewArtifact: ArtifactRef | null;
  openArtifact: (artifact: ArtifactRef) => void;
  /** Backward-compatible local path entry point. */
  openPreview: (filePath: string) => void;
  closePreview: () => void;
}

export const usePreviewStore = create<PreviewState>((set) => ({
  previewArtifact: null,

  openArtifact: (artifact) => {
    set({ previewArtifact: artifact });
  },

  openPreview: (filePath) => {
    set({ previewArtifact: artifactFromPath(filePath) });
  },

  closePreview: () => {
    set({ previewArtifact: null });
  },
}));
