import { useSettingsStore } from '@/stores/settingsStore';
import { usePreviewStore } from '@/stores/previewStore';
import PreviewPanel from './PreviewPanel';

const PREVIEW_WIDTH = 480;

export default function RightPanel() {
  const viewMode = useSettingsStore((s) => s.viewMode);
  const previewArtifact = usePreviewStore((s) => s.previewArtifact);
  const isExpanded = usePreviewStore((s) => s.isExpanded);

  // Hide panel when not in chat view or when there's no preview
  if (viewMode !== 'chat' || !previewArtifact) {
    return null;
  }

  // The app hides its navigation and chat regions before this width transition
  // begins, so the preview expands into a clean, full-window reading surface.
  const panelWidth = isExpanded ? '100vw' : PREVIEW_WIDTH;

  return (
    <div
      className={`shrink-0 border-l border-[#e8e4dd] bg-[#f5f3ee] h-full flex flex-col overflow-hidden transition-[width,min-width,max-width] duration-300 ease-in-out ${isExpanded ? 'relative z-50' : ''}`}
      style={{
        width: panelWidth,
        minWidth: panelWidth,
        maxWidth: panelWidth,
        transitionDelay: isExpanded ? '120ms' : '0ms',
      }}
    >
      <PreviewPanel />
    </div>
  );
}
