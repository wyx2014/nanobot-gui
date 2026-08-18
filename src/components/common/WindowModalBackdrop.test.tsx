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
  document.body.classList.remove('window-modal-open');
  container.remove();
});

describe('WindowModalBackdrop', () => {
  it('leaves the native 40px Windows caption row undimmed', () => {
    act(() => root.render(<WindowModalBackdrop />));

    const backdrop = container.querySelector<HTMLElement>('[data-window-modal-backdrop]');
    expect(backdrop?.classList.contains('top-10')).toBe(true);
    expect(backdrop?.classList.contains('top-0')).toBe(false);
    expect(backdrop?.className).not.toContain('backdrop-blur');
  });

  it('covers the full renderer on platforms without native overlay buttons', () => {
    platform.windows = false;
    act(() => root.render(<WindowModalBackdrop />));

    const backdrop = container.querySelector<HTMLElement>('[data-window-modal-backdrop]');
    expect(backdrop?.classList.contains('top-0')).toBe(true);
  });

  it('keeps background animation paused until the final stacked backdrop closes', () => {
    act(() => root.render(<><WindowModalBackdrop /><WindowModalBackdrop /></>));
    expect(document.body.classList.contains('window-modal-open')).toBe(true);

    act(() => root.render(<WindowModalBackdrop />));
    expect(document.body.classList.contains('window-modal-open')).toBe(true);

    act(() => root.render(<></>));
    expect(document.body.classList.contains('window-modal-open')).toBe(false);
  });
});
