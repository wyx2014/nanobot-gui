import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAutoScroll } from './useAutoScroll';

let container: HTMLDivElement | undefined;
let root: Root | undefined;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
  vi.restoreAllMocks();
});

describe('useAutoScroll', () => {
  it('keeps correcting to the bottom while virtual content height settles', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    let scrollHeight = 1_000;
    let scrollApi: ReturnType<typeof useAutoScroll> | undefined;

    function Harness() {
      const api = useAutoScroll();
      const { containerRef } = api;
      useEffect(() => {
        scrollApi = api;
      }, [api]);
      return <div ref={containerRef} />;
    }

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(<Harness />));

    const scroller = container.firstElementChild as HTMLDivElement;
    Object.defineProperty(scroller, 'clientHeight', {
      configurable: true,
      get: () => 400,
    });
    Object.defineProperty(scroller, 'scrollHeight', {
      configurable: true,
      get: () => scrollHeight,
    });

    act(() => scrollApi?.scrollToBottom({ force: true, settle: true }));
    expect(scroller.scrollTop).toBe(600);

    scrollHeight = 1_500;
    act(() => frames.shift()?.(16));
    expect(scroller.scrollTop).toBe(1_100);

    scrollHeight = 1_900;
    act(() => frames.shift()?.(32));
    expect(scroller.scrollTop).toBe(1_500);
  });

});
