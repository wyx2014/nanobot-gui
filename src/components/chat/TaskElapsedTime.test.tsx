import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TaskElapsedTime from './TaskElapsedTime';

let container: HTMLDivElement;
let root: Root;
const START = Date.parse('2026-09-01T12:00:00Z');

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('TaskElapsedTime', () => {
  it('renders completed history without timers or visibility observers', () => {
    const observer = vi.fn();
    vi.stubGlobal('IntersectionObserver', observer);
    act(() => root.render(<TaskElapsedTime elapsedMs={7_000} />));
    expect(container.textContent).toBe('7s');
    expect(observer).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('updates rounded seconds without rerendering its parent or history', () => {
    const renderParent = vi.fn();
    function Parent() {
      renderParent();
      return <><p>Completed history</p><TaskElapsedTime startedAt={START / 1_000} /></>;
    }
    act(() => root.render(<Parent />));
    expect(container.textContent).toContain('0s');
    act(() => vi.advanceTimersByTime(500));
    expect(container.textContent).toContain('1s');
    act(() => vi.advanceTimersByTime(1_000));
    expect(container.textContent).toContain('2s');
    act(() => vi.advanceTimersByTime(60_000));
    expect(container.textContent).toContain('1m2s');
    expect(renderParent).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('stops hidden updates and catches up to wall time immediately on return', () => {
    act(() => root.render(<TaskElapsedTime startedAt={START} />));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(120_000));
    expect(container.textContent).toBe('0s');
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(container.textContent).toBe('2m0s');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('freezes the authoritative final duration and releases the clock', () => {
    act(() => root.render(<TaskElapsedTime startedAt={START} />));
    act(() => vi.advanceTimersByTime(8_000));
    act(() => root.render(<TaskElapsedTime elapsedMs={7_400} prefix="Elapsed " />));
    act(() => vi.advanceTimersByTime(120_000));
    expect(container.textContent).toBe('Elapsed 7s');
    expect(vi.getTimerCount()).toBe(0);
  });
});
