import { useCallback, useEffect, useRef, useState } from 'react';

const BOTTOM_THRESHOLD_PX = 32;

/**
 * Auto-scroll hook for streaming chat.
 *
 * Key design decisions:
 * 1. Uses MutationObserver + ResizeObserver to react to actual DOM changes,
 *    not React state changes — this is more reliable during rapid streaming.
 * 2. RAF-debounced: only one scroll per animation frame, no layout thrashing.
 * 3. No timeout-based "isUserScrolling" flag — the old approach caused 150ms
 *    gaps where auto-scroll was disabled, creating visible jumps.
 *    Instead, distance from the real max scrollTop decides whether the user is
 *    at bottom.
 */
export function useAutoScroll() {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);
  const rafId = useRef(0);

  const setAtBottomState = useCallback((atBottom: boolean) => {
    if (atBottom === isAtBottomRef.current) return;
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, []);

  const maxScrollTop = (container: HTMLDivElement) => (
    Math.max(0, container.scrollHeight - container.clientHeight)
  );

  const landAtBottom = useCallback((container: HTMLDivElement) => {
    container.scrollTop = maxScrollTop(container);
    setAtBottomState(true);
  }, [setAtBottomState]);

  const checkIfAtBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;
    return maxScrollTop(container) - container.scrollTop <= BOTTOM_THRESHOLD_PX;
  }, []);

  const refreshScrollState = useCallback(() => {
    setAtBottomState(checkIfAtBottom());
  }, [checkIfAtBottom, setAtBottomState]);

  // Manual scroll-to-bottom (for the button)
  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    landAtBottom(container);
    requestAnimationFrame(() => {
      const latest = containerRef.current;
      if (latest) landAtBottom(latest);
    });
  }, [landAtBottom]);

  // Re-enable auto-scroll and scroll to bottom immediately.
  // Use this when the user sends a message to ensure auto-scroll resumes.
  // We must actually scroll (not just set the flag) because scroll events
  // fired by DOM mutations can detect we're not at bottom and reset the flag.
  const resetToBottom = useCallback(() => {
    const container = containerRef.current;
    if (container) {
      landAtBottom(container);
    }
  }, [landAtBottom]);

  // Track scroll position — works for both user and programmatic scrolls.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      setAtBottomState(checkIfAtBottom());
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [checkIfAtBottom, setAtBottomState]);

  // Auto-scroll on DOM changes — debounced to one scroll per frame
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scheduleScroll = () => {
      // Don't scroll if user has scrolled up
      if (!isAtBottomRef.current) return;
      // Already have a pending scroll for this frame — skip
      if (rafId.current) return;

      rafId.current = requestAnimationFrame(() => {
        rafId.current = 0;
        const c = containerRef.current;
        if (!c || !isAtBottomRef.current) return;
        landAtBottom(c);
        // Safety: clear the flag next frame if no scroll event fires
        // (e.g., scrollTop didn't actually change because we're already at bottom)
        requestAnimationFrame(() => {
          setAtBottomState(checkIfAtBottom());
        });
      });
    };

    // Watch for size changes (code blocks expanding, images loading, etc.)
    const resizeObserver = new ResizeObserver(scheduleScroll);
    resizeObserver.observe(container);
    for (const child of container.children) {
      resizeObserver.observe(child);
    }

    // Watch for DOM content changes (new text chunks, new elements)
    // Also observe newly added children with ResizeObserver
    const mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement) {
            resizeObserver.observe(node);
          }
        }
      }
      scheduleScroll();
    });
    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [checkIfAtBottom, landAtBottom, setAtBottomState]);

  return {
    containerRef,
    endRef,
    isAtBottom,
    scrollToBottom,
    resetToBottom,
    refreshScrollState,
  };
}
