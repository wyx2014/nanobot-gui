import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODE_DRAWS, resolvePreset } from 'thinking-orbs';

vi.mock('thinking-orbs', () => ({
  MODE_DRAWS: { orbits: vi.fn() },
  resolvePreset: vi.fn(() => ({ mode: 'orbits', speed: 2, opts: { dots: 12 } })),
}));

import ModalAwareThinkingOrb from './ModalAwareThinkingOrb';
import WindowModalBackdrop from './WindowModalBackdrop';

let container: HTMLDivElement;
let root: Root;
let frames: Map<number, FrameRequestCallback>;
let observerCallbacks: IntersectionObserverCallback[];
let reducedMotion: boolean;
let context: Pick<CanvasRenderingContext2D, 'setTransform' | 'clearRect'>;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function frameAt(time: number) {
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach((callback) => callback(time)));
}

function setVisible(visible: boolean) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(visible ? 'visible' : 'hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_DEV_LOW_POWER', '0');
  frames = new Map();
  observerCallbacks = [];
  reducedMotion = false;
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { observerCallbacks.push(callback); }
    observe() {}
    disconnect() {}
  });
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: query.includes('reduced-motion') && reducedMotion,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  } as unknown as MediaQueryList));
  context = { setTransform: vi.fn(), clearRect: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as CanvasRenderingContext2D);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  expect(frames.size).toBe(0);
  document.body.classList.remove('window-modal-open');
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('ModalAwareThinkingOrb', () => {
  it('keeps task status visible without a frame loop in local low power mode', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_DEV_LOW_POWER', '1');
    act(() => root.render(<ModalAwareThinkingOrb state="searching" />));
    expect(frames.size).toBe(0);
    expect(MODE_DRAWS.orbits).toHaveBeenLastCalledWith(context, 64, 0.6, false, { dots: 12 });
    expect(container.querySelector('canvas')?.getAttribute('aria-label')).toBe('Searching…');
    act(() => root.render(<ModalAwareThinkingOrb state="working" />));
    expect(container.querySelector('canvas')?.getAttribute('aria-label')).toBe('Working…');
    expect(frames.size).toBe(0);
  });

  it('retains the animation in production even when the local flag is set', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_DEV_LOW_POWER', '1');
    act(() => root.render(<ModalAwareThinkingOrb />));
    expect(frames.size).toBe(1);
  });

  it('shares one frame loop and paints at 30 FPS without slowing the animation', () => {
    act(() => root.render(<><ModalAwareThinkingOrb size={20} speed={0.5} /><ModalAwareThinkingOrb /></>));
    expect(frames.size).toBe(1);
    vi.mocked(MODE_DRAWS.orbits).mockClear();
    for (let frame = 0; frame < 60; frame += 1) frameAt(frame * 1_000 / 60);
    expect(MODE_DRAWS.orbits).toHaveBeenCalledTimes(60);
    const lastSmallFrame = vi.mocked(MODE_DRAWS.orbits).mock.calls[58];
    expect(lastSmallFrame[1]).toBe(20);
    expect(lastSmallFrame[2]).toBeCloseTo(58 / 60);
    expect(frames.size).toBe(1);
  });

  it('stops canvas frames while a window modal is open and resumes afterwards', () => {
    act(() => root.render(<><ModalAwareThinkingOrb /></>));
    expect(frames.size).toBe(1);

    act(() => root.render(<><ModalAwareThinkingOrb /><WindowModalBackdrop /></>));
    expect(frames.size).toBe(0);

    act(() => root.render(<><ModalAwareThinkingOrb /></>));
    expect(frames.size).toBe(1);
  });

  it('suspends hidden and offscreen canvases and resumes on return', () => {
    act(() => root.render(<ModalAwareThinkingOrb />));
    setVisible(false);
    expect(frames.size).toBe(0);
    setVisible(true);
    expect(frames.size).toBe(1);
    act(() => observerCallbacks[0]([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(frames.size).toBe(0);
    act(() => observerCallbacks[0]([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(frames.size).toBe(1);
  });

  it('retains library presets, labels, sizing, theme changes and explicit pause', async () => {
    act(() => root.render(<ModalAwareThinkingOrb state="searching" size={20} paused />));
    expect(resolvePreset).toHaveBeenLastCalledWith('searching', 20);
    expect(container.querySelector('canvas')?.style.width).toBe('20px');
    expect(container.querySelector('canvas')?.getAttribute('aria-label')).toBe('Searching…');
    expect(frames.size).toBe(0);
    await act(async () => {
      container.setAttribute('data-theme', 'dark');
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(MODE_DRAWS.orbits).toHaveBeenLastCalledWith(context, 20, expect.any(Number), true, { dots: 12 });
    act(() => root.render(<ModalAwareThinkingOrb state="working" size={64} theme="light" paused />));
    expect(resolvePreset).toHaveBeenLastCalledWith('working', 64);
    expect(MODE_DRAWS.orbits).toHaveBeenLastCalledWith(context, 64, expect.any(Number), false, { dots: 12 });
  });

  it('renders a still frame for reduced motion without scheduling animation', () => {
    reducedMotion = true;
    act(() => root.render(<ModalAwareThinkingOrb />));
    expect(frames.size).toBe(0);
    expect(MODE_DRAWS.orbits).toHaveBeenLastCalledWith(context, 64, 0.6, false, { dots: 12 });
  });
});
