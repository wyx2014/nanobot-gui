import { describe, expect, it } from 'vitest';

import {
  getConversationColumnClasses,
  PINNED_SUMMARY_COMPACT_MAX_WIDTH,
  shouldAutoHideSidebarForPinnedSummary,
} from './layout';

const visibleCompactSummary = {
  windows: true,
  compactViewport: true,
  chatVisible: true,
  hasActiveConversation: true,
  summaryCollapsed: false,
  previewOpen: false,
  browserOpen: false,
};

describe('pinned summary responsive layout', () => {
  it('centers the compact composer inside the same outer column as messages', () => {
    const pinned = getConversationColumnClasses(true);

    expect(pinned.outer).toBe('w-full max-w-4xl ml-auto mr-0');
    expect(pinned.composer).toBe('w-full max-w-3xl mx-auto');
  });

  it('keeps the regular composer at the full centered conversation width', () => {
    const regular = getConversationColumnClasses(false);

    expect(regular.outer).toBe('w-full max-w-4xl mx-auto');
    expect(regular.composer).toBe('w-full');
  });

  it('uses the width required by the sidebar, summary and full conversation column', () => {
    expect(PINNED_SUMMARY_COMPACT_MAX_WIDTH).toBe(1459);
  });

  it('temporarily hides the Windows sidebar when the summary would squeeze chat', () => {
    expect(shouldAutoHideSidebarForPinnedSummary(visibleCompactSummary)).toBe(true);
  });

  it('keeps the sidebar for wide windows and non-summary panel states', () => {
    expect(shouldAutoHideSidebarForPinnedSummary({
      ...visibleCompactSummary,
      compactViewport: false,
    })).toBe(false);
    expect(shouldAutoHideSidebarForPinnedSummary({
      ...visibleCompactSummary,
      summaryCollapsed: true,
    })).toBe(false);
    expect(shouldAutoHideSidebarForPinnedSummary({
      ...visibleCompactSummary,
      previewOpen: true,
    })).toBe(false);
    expect(shouldAutoHideSidebarForPinnedSummary({
      ...visibleCompactSummary,
      browserOpen: true,
    })).toBe(false);
  });

  it('does not change the macOS layout', () => {
    expect(shouldAutoHideSidebarForPinnedSummary({
      ...visibleCompactSummary,
      windows: false,
    })).toBe(false);
  });
});
