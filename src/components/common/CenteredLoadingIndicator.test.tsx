import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CenteredLoadingIndicator from './CenteredLoadingIndicator';

vi.mock('./ModalAwareThinkingOrb', () => ({
  default: ({ state }: { state: string }) => <div data-testid="thinking-orb" data-state={state} />,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

describe('CenteredLoadingIndicator', () => {
  it('renders the conversation loading treatment with a contextual label', () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    act(() => root?.render(
      <CenteredLoadingIndicator
        label="正在加载自动化…"
        className="min-h-[240px]"
        testId="view-loading"
      />,
    ));

    const indicator = container.querySelector('[data-testid="view-loading"]');
    expect(indicator?.getAttribute('role')).toBe('status');
    expect(indicator?.getAttribute('aria-live')).toBe('polite');
    expect(indicator?.className).toContain('min-h-[240px]');
    expect(indicator?.textContent).toContain('正在加载自动化…');
    expect(container.querySelector('[data-testid="thinking-orb"]')?.getAttribute('data-state')).toBe('solving');
  });
});
