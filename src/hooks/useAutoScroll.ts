import { useCallback, useEffect, useRef, useState } from 'react';

const BOTTOM_THRESHOLD_PX = 48;
const MAX_SETTLE_FRAMES = 12;
const MIN_SETTLE_FRAMES = 4;

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

  const scrollToBottom = useCallback((options: { force?: boolean; settle?: boolean } = {}) => {
    const force = options.force ?? true;
    const settle = options.settle ?? false;
    if (force) setBottomState(true);

    const container = containerNodeRef.current;
    if (!container) return;
    if (!force && !stickToBottomRef.current) return;

    landAtBottom(container);

    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    let previousMax = maxScrollTop(container);
    let stableFrames = 0;
    let observedFrames = 0;
    let remainingFrames = settle ? MAX_SETTLE_FRAMES : 1;

    const followLayout = () => {
      rafRef.current = null;
      const latest = containerNodeRef.current;
      if (!latest || (!force && !stickToBottomRef.current)) return;
      const nextMax = maxScrollTop(latest);
      stableFrames = Math.abs(nextMax - previousMax) < 1 ? stableFrames + 1 : 0;
      previousMax = nextMax;
      observedFrames += 1;
      remainingFrames -= 1;
      landAtBottom(latest);
      const layoutSettled = observedFrames >= MIN_SETTLE_FRAMES && stableFrames >= 2;
      if (remainingFrames > 0 && (!settle || !layoutSettled)) {
        rafRef.current = window.requestAnimationFrame(followLayout);
      }
    };

    rafRef.current = window.requestAnimationFrame(followLayout);
  }, [landAtBottom, setBottomState]);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
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
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }
  ), []);

  return {
    containerRef,
    scrollElement,
    isAtBottom,
    scrollToBottom,
  };
}
