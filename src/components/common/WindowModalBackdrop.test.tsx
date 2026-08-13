import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ windows: true }));

vi.mock('@/utils/platform', () => ({
  isWindows: () => platform.windows,
}));

import WindowModalBackdrop from './WindowModalBackdrop';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  platform.windows = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('WindowModalBackdrop', () => {
  it('leaves the native 40px Windows caption row undimmed', () => {
    act(() => root.render(<WindowModalBackdrop />));

    const backdrop = container.querySelector<HTMLElement>('[data-window-modal-backdrop]');
    expect(backdrop?.classList.contains('top-10')).toBe(true);
    expect(backdrop?.classList.contains('top-0')).toBe(false);
  });

  it('covers the full renderer on platforms without native overlay buttons', () => {
    platform.windows = false;
    act(() => root.render(<WindowModalBackdrop />));

    const backdrop = container.querySelector<HTMLElement>('[data-window-modal-backdrop]');
    expect(backdrop?.classList.contains('top-0')).toBe(true);
  });
});
