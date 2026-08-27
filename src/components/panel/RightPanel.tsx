import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { usePreviewStore } from '@/stores/previewStore';
import { useChatStore } from '@/stores/chatStore';
import { useBrowserStore } from '@/stores/browserStore';
import { isWindows } from '@/utils/platform';
import PreviewPanel from './PreviewPanel';
import ConversationWorkbench from './ConversationWorkbench';
import BrowserPanel from './BrowserPanel';
import {
  PINNED_SUMMARY_RIGHT,
  PINNED_SUMMARY_WIDTH,
} from './layout';

export {
  PINNED_SUMMARY_CONTENT_INSET,
  PINNED_SUMMARY_CONTENT_MAX_WIDTH,
  PINNED_SUMMARY_GAP,
  PINNED_SUMMARY_RIGHT,
  PINNED_SUMMARY_WIDTH,
} from './layout';

// Match OpenWorker's two rail modes: a compact inspector and a wide reading
// surface that leaves the conversation visible beside the artifact.
const PREVIEW_WIDTH = 'min(62vw, 960px)';
const BROWSER_WIDTH = 'min(42vw, 560px)';

// Pinned summary overlay geometry, shared with ChatView so the conversation
// content can reserve room on the right without moving its scrollbar.
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
  const [summaryConversationId, setSummaryConversationId] = useState(activeConversationId);
  const conversationChangedWhileSummaryVisible = summaryConversationId !== activeConversationId;

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

  useEffect(() => {
    setSummaryConversationId(activeConversationId);
  }, [activeConversationId]);

  // The workbench belongs to an existing chat session, not the welcome screen.
  if (viewMode !== 'chat' || !activeConversationId) {
    return null;
  }

  if (!previewArtifact && !browserOpen) {
    // The pinned summary floats over the conversation's right edge instead of
    // reserving layout width, so the chat header buttons and the content
    // scrollbar stay pinned to the window's right edge.
    if (summaryCollapsed) return null;
    return (
      <div
        data-pinned-summary-host
        className="window-titlebar-no-drag fixed z-[55] flex flex-col items-end"
        style={{ top: isWindows() ? 96 : 56, right: PINNED_SUMMARY_RIGHT }}
      >
        <div
          id="conversation-pinned-summary"
          data-pinned-summary
          className="origin-top-right motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-2 motion-safe:duration-200"
          style={{
            width: PINNED_SUMMARY_WIDTH,
            // Hard safety cap so an extremely narrow window never overflows.
            maxWidth: 'calc(100vw - 24px)',
          }}
        >
          <ConversationWorkbench
            key={activeConversationId}
            showInitialLoading={conversationChangedWhileSummaryVisible}
          />
        </div>
      </div>
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
