import { useEffect, useRef, type CSSProperties } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { usePreviewStore } from '@/stores/previewStore';
import { useChatStore } from '@/stores/chatStore';
import PreviewPanel from './PreviewPanel';
import ConversationWorkbench from './ConversationWorkbench';

// Match OpenWorker's two rail modes: a compact inspector and a wide reading
// surface that leaves the conversation visible beside the artifact.
const PREVIEW_WIDTH = 'min(62vw, 960px)';
const WORKBENCH_WIDTH = 332;

export default function RightPanel() {
  const viewMode = useSettingsStore((s) => s.viewMode);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const previewArtifact = usePreviewStore((s) => s.previewArtifact);
  const isExpanded = usePreviewStore((s) => s.isExpanded);
  const closePreview = usePreviewStore((s) => s.closePreview);
  const previousConversationId = useRef(activeConversationId);

  useEffect(() => {
    if (
      previousConversationId.current
      && previousConversationId.current !== activeConversationId
      && previewArtifact
    ) {
      closePreview();
    }
    previousConversationId.current = activeConversationId;
  }, [activeConversationId, closePreview, previewArtifact]);

  // The workbench belongs to an existing chat session, not the welcome screen.
  if (viewMode !== 'chat' || !activeConversationId) {
    return null;
  }

  // A normal artifact preview temporarily reclaims the left-nav width while
  // keeping chat visible; explicit full-screen expansion also hides chat.
  const panelWidth = isExpanded
    ? '100vw'
    : previewArtifact
      ? PREVIEW_WIDTH
      : WORKBENCH_WIDTH;
  const widthValue = typeof panelWidth === 'number' ? `${panelWidth}px` : panelWidth;
  const panelStyle = {
    '--conversation-panel-width': widthValue,
    width: 'var(--conversation-panel-width)',
    minWidth: 'var(--conversation-panel-width)',
    maxWidth: 'var(--conversation-panel-width)',
    transitionDelay: isExpanded ? '120ms' : '0ms',
  } as CSSProperties;

  return (
    <div
      className={`shrink-0 border-l border-[#e8e4dd] bg-[#f5f3ee] h-full flex flex-col overflow-hidden transition-[width,min-width,max-width] duration-300 ease-in-out ${isExpanded ? 'relative z-50' : ''}`}
      style={panelStyle}
    >
      {previewArtifact ? <PreviewPanel /> : <ConversationWorkbench />}
    </div>
  );
}
