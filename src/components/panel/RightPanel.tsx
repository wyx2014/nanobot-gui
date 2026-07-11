import { useSettingsStore } from '@/stores/settingsStore';
import { usePreviewStore } from '@/stores/previewStore';
import PreviewPanel from './PreviewPanel';

const PREVIEW_WIDTH = 420;

export default function RightPanel() {
  const viewMode = useSettingsStore((s) => s.viewMode);
  const previewArtifact = usePreviewStore((s) => s.previewArtifact);

  // Hide panel when not in chat view or when there's no preview
  if (viewMode !== 'chat' || !previewArtifact) {
    return null;
  }

  return (
    <div
      className="shrink-0 border-l border-[#e8e4dd] bg-[#f5f3ee] h-full flex flex-col overflow-hidden transition-all duration-200"
      style={{ width: PREVIEW_WIDTH, minWidth: PREVIEW_WIDTH, maxWidth: PREVIEW_WIDTH }}
    >
      <PreviewPanel />
    </div>
  );
}
