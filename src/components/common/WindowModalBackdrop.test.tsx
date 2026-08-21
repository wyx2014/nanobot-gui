import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import WindowModalBackdrop from './WindowModalBackdrop';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
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
  it('uses the shared title-bar safe edge instead of a hard-coded offset', () => {
    act(() => root.render(<WindowModalBackdrop />));

    const backdrop = container.querySelector<HTMLElement>('[data-window-modal-backdrop]');
    expect(backdrop?.classList.contains('window-titlebar-safe-top')).toBe(true);
    expect(backdrop?.classList.contains('top-10')).toBe(false);
    expect(backdrop?.className).not.toContain('backdrop-blur');
  });

  it('supports a fixed standalone backdrop with the same safe edge', () => {
    act(() => root.render(<WindowModalBackdrop position="fixed" />));

    const backdrop = container.querySelector<HTMLElement>('[data-window-modal-backdrop]');
    expect(backdrop?.classList.contains('fixed')).toBe(true);
    expect(backdrop?.classList.contains('window-titlebar-safe-top')).toBe(true);
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
