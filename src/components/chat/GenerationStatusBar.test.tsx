import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GenerationStatusBar, {
  formatGenerationDuration,
  formatGenerationTokens,
} from './GenerationStatusBar';

let container: HTMLDivElement;
let root: Root;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-26T12:00:07.000Z'));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe('GenerationStatusBar', () => {
  it('renders the generating icon, breathing state, elapsed time and tokens', () => {
    act(() => {
      root.render(
        <GenerationStatusBar
          phase="generating"
          startedAt={Date.parse('2026-07-26T12:00:00.000Z')}
          tokenCount={328}
        />,
      );
    });

    expect(container.textContent).toContain('Generating...');
    expect(container.textContent).toContain('7s');
    expect(container.textContent).toContain('328 tokens');
    expect(container.querySelector('svg.lucide-sparkles')).not.toBeNull();
    expect(container.querySelector('.generation-status-breathe')).not.toBeNull();
  });

  it('uses the distinct thinking icon and keeps the active breathing state', () => {
    act(() => {
      root.render(
        <GenerationStatusBar phase="thinking" startedAt={Date.now()} />,
      );
    });
    expect(container.textContent).toContain('Thinking...');
    expect(container.querySelector('svg.lucide-brain-circuit')).not.toBeNull();
    expect(container.querySelector('.generation-status-breathe')).not.toBeNull();
  });

  it('formats long durations and compact token counts', () => {
    expect(formatGenerationDuration(125_000)).toBe('2m 5s');
    expect(formatGenerationTokens(9_500)).toBe('9.5k tokens');
    expect(formatGenerationTokens(25_000)).toBe('25k tokens');
  });
});
