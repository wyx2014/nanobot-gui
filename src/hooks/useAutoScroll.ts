import { useCallback, useEffect, useRef, useState } from 'react';

const BOTTOM_THRESHOLD_PX = 48;

function maxScrollTop(container: HTMLDivElement): number {
  return Math.max(0, container.scrollHeight - container.clientHeight);
}

function isNearBottom(container: HTMLDivElement): boolean {
  return maxScrollTop(container) - container.scrollTop <= BOTTOM_THRESHOLD_PX;
}

export function useAutoScroll() {
  const containerNodeRef = useRef<HTMLDivElement | null>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const detachScrollRef = useRef<(() => void) | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const stickToBottomRef = useRef(true);
  const rafRef = useRef<number | null>(null);

  const setBottomState = useCallback((next: boolean) => {
    stickToBottomRef.current = next;
    setIsAtBottom((current) => (current === next ? current : next));
  }, []);

  const landAtBottom = useCallback((container: HTMLDivElement) => {
    container.scrollTop = maxScrollTop(container);
    setBottomState(isNearBottom(container));
  }, [setBottomState]);

  const scrollToBottom = useCallback((options: { force?: boolean } = {}) => {
    const force = options.force ?? true;
    if (force) setBottomState(true);

    const container = containerNodeRef.current;
    if (!container) return;
    if (!force && !stickToBottomRef.current) return;

    landAtBottom(container);

    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      const latest = containerNodeRef.current;
      if (!latest || (!force && !stickToBottomRef.current)) return;
      landAtBottom(latest);
    });
  }, [landAtBottom, setBottomState]);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    detachScrollRef.current?.();
    detachScrollRef.current = null;
    containerNodeRef.current = node;
    setScrollElement(node);
    if (!node) return;

    const handleScroll = () => setBottomState(isNearBottom(node));
    node.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    detachScrollRef.current = () => node.removeEventListener('scroll', handleScroll);
  }, [setBottomState]);

  useEffect(() => (
    () => {
      detachScrollRef.current?.();
      detachScrollRef.current = null;
      containerNodeRef.current = null;
      setScrollElement(null);
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    }
  ), []);

  return {
    containerRef,
    scrollElement,
    isAtBottom,
    scrollToBottom,
  };
}
