import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('thinking-orbs', () => ({
  ThinkingOrb: ({ paused }: { paused?: boolean }) => (
    <canvas data-testid="thinking-orb" data-paused={paused ? 'true' : 'false'} />
  ),
}));

import ModalAwareThinkingOrb from './ModalAwareThinkingOrb';
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

describe('ModalAwareThinkingOrb', () => {
  it('stops canvas frames while a window modal is open and resumes afterwards', () => {
    act(() => root.render(<ModalAwareThinkingOrb />));
    expect(container.querySelector('canvas')?.dataset.paused).toBe('false');

    act(() => root.render(<><ModalAwareThinkingOrb /><WindowModalBackdrop /></>));
    expect(container.querySelector('canvas')?.dataset.paused).toBe('true');

    act(() => root.render(<ModalAwareThinkingOrb />));
    expect(container.querySelector('canvas')?.dataset.paused).toBe('false');
  });
});
