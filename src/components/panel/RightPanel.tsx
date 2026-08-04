import { useEffect, useRef, type CSSProperties } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { usePreviewStore } from '@/stores/previewStore';
import { useChatStore } from '@/stores/chatStore';
import { useBrowserStore } from '@/stores/browserStore';
import PreviewPanel from './PreviewPanel';
import ConversationWorkbench from './ConversationWorkbench';
import BrowserPanel from './BrowserPanel';

// Match OpenWorker's two rail modes: a compact inspector and a wide reading
// surface that leaves the conversation visible beside the artifact.
const PREVIEW_WIDTH = 'min(62vw, 960px)';
const BROWSER_WIDTH = 'min(42vw, 560px)';
const PINNED_SUMMARY_WIDTH = 320;
const PINNED_SUMMARY_GAP = 12;

export default function RightPanel() {
  const viewMode = useSettingsStore((s) => s.viewMode);
  const summaryCollapsed = useSettingsStore((s) => s.rightPanelCollapsed);
  const activeConversationId = useChatStore((s) => s.activeConversationId);
  const previewArtifact = usePreviewStore((s) => s.previewArtifact);
  const isExpanded = usePreviewStore((s) => s.isExpanded);
  const closePreview = usePreviewStore((s) => s.closePreview);
  const browserOpen = useBrowserStore((s) => (
    activeConversationId
      ? s.sessions[activeConversationId]?.open === true
      : false
  ));
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

  if (!previewArtifact && !browserOpen) {
    return (
      <>
        <div
          data-pinned-summary-spacer
          aria-hidden="true"
          className="h-full shrink-0 transition-[width] duration-300 ease-in-out"
          style={{
            width: summaryCollapsed
              ? 0
              : PINNED_SUMMARY_WIDTH + PINNED_SUMMARY_GAP,
          }}
        />
        {!summaryCollapsed ? (
          <div
            data-pinned-summary-host
            className="window-titlebar-no-drag fixed right-3 z-[55] flex flex-col items-end"
            style={{ top: 56 }}
          >
            <div
              id="conversation-pinned-summary"
              data-pinned-summary
              className="w-[min(320px,calc(100vw-24px))] origin-top-right motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95"
            >
              <ConversationWorkbench />
            </div>
          </div>
        ) : null}
      </>
    );
  }

  // A normal artifact preview temporarily reclaims the left-nav width while
  // keeping chat visible; explicit full-screen expansion also hides chat.
  const panelWidth = isExpanded
    ? '100vw'
    : previewArtifact
      ? PREVIEW_WIDTH
      : BROWSER_WIDTH;
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
      className={`shrink-0 border-l border-[#e8e4dd] bg-[#f5f3ee] dark:border-[#3d3d3d] dark:bg-[#202020] h-full flex flex-col overflow-hidden transition-[width,min-width,max-width] duration-300 ease-in-out ${isExpanded ? 'relative z-50' : ''}`}
      style={panelStyle}
    >
      {previewArtifact
        ? <PreviewPanel />
        : <BrowserPanel chatId={activeConversationId} />}
    </div>
  );
}
