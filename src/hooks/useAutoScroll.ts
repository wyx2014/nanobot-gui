import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Auto-scroll hook for streaming chat.
 *
 * Key design decisions:
 * 1. Uses MutationObserver + ResizeObserver to react to actual DOM changes,
 *    not React state changes — this is more reliable during rapid streaming.
 * 2. RAF-debounced: only one scroll per animation frame, no layout thrashing.
 * 3. No timeout-based "isUserScrolling" flag — the old approach caused 150ms
 *    gaps where auto-scroll was disabled, creating visible jumps.
 *    Instead, programmatic scrolls always land at scrollHeight, so the scroll
 *    handler's checkIfAtBottom() naturally returns true — no flag needed.
 */
export function useAutoScroll() {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);
  const rafId = useRef(0);
  // Flag to skip scroll-handler check after programmatic scrolls.
  // Prevents a race where new content arrives between scrollTop assignment
  // and the async scroll event, causing checkIfAtBottom() to return false.
  const isProgrammaticScroll = useRef(false);

  const checkIfAtBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollTop + clientHeight >= scrollHeight - 100;
  }, []);

  // Manual scroll-to-bottom (for the button)
  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    isProgrammaticScroll.current = true;
    container.scrollTop = container.scrollHeight;
    isAtBottomRef.current = true;
    setIsAtBottom(true);
  }, []);

  // Re-enable auto-scroll and scroll to bottom immediately.
  // Use this when the user sends a message to ensure auto-scroll resumes.
  // We must actually scroll (not just set the flag) because scroll events
  // fired by DOM mutations can detect we're not at bottom and reset the flag.
  const resetToBottom = useCallback(() => {
    const container = containerRef.current;
    if (container) {
      isProgrammaticScroll.current = true;
      container.scrollTop = container.scrollHeight;
    }
    isAtBottomRef.current = true;
    setIsAtBottom(true);
  }, []);

  // Track scroll position — works for both user and programmatic scrolls.
  // Programmatic scrolls land at scrollHeight, so checkIfAtBottom returns true
  // and isAtBottom stays true — no extra re-render.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Skip check for programmatic scrolls — the race between scrollTop
      // assignment and this async event can cause false negatives.
      if (isProgrammaticScroll.current) {
        isProgrammaticScroll.current = false;
        return;
      }
      const atBottom = checkIfAtBottom();
      // Only update state when the value actually changes to avoid re-renders
      if (atBottom !== isAtBottomRef.current) {
        isAtBottomRef.current = atBottom;
        setIsAtBottom(atBottom);
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [checkIfAtBottom]);

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
        isProgrammaticScroll.current = true;
        c.scrollTop = c.scrollHeight;
        // Safety: clear the flag next frame if no scroll event fires
        // (e.g., scrollTop didn't actually change because we're already at bottom)
        requestAnimationFrame(() => {
          isProgrammaticScroll.current = false;
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
  }, []);

  return {
    containerRef,
    endRef,
    isAtBottom,
    scrollToBottom,
    resetToBottom,
  };
}
