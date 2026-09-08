import { useEffect, useState, useSyncExternalStore, type RefObject } from 'react';
import { useModalBackgroundPaused } from './modalPerformance';

function subscribeVisibility(listener: () => void): () => void {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}

function documentVisible(): boolean {
  return document.visibilityState !== 'hidden';
}

export function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, documentVisible, () => true);
}

/** Suspend visual work without changing the runtime clock or task execution. */
export function useVisualActivity<T extends Element>(ref: RefObject<T | null>, mounted = true): boolean {
  const visible = useDocumentVisible();
  const modalPaused = useModalBackgroundPaused();
  const [intersecting, setIntersecting] = useState(true);

  useEffect(() => {
    const element = ref.current;
    if (!mounted || !element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      setIntersecting(entry.isIntersecting);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [mounted, ref]);

  return visible && intersecting && !modalPaused;
}
