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
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(container.querySelector('[data-generation-status]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')?.classList.contains('bg-gradient-to-t')).toBe(true);
    expect(container.querySelector('[role="status"]')?.classList.contains('to-transparent')).toBe(true);
  });

  it('uses the distinct thinking orb and keeps the active breathing state', () => {
    act(() => {
      root.render(
        <GenerationStatusBar phase="thinking" startedAt={Date.now()} />,
      );
    });
    expect(container.textContent).toContain('Thinking...');
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('renders the working phase for local tool calls', () => {
    act(() => {
      root.render(
        <GenerationStatusBar phase="working" startedAt={Date.now()} />,
      );
    });
    expect(container.textContent).toContain('Working...');
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('renders the searching phase for web lookups', () => {
    act(() => {
      root.render(
        <GenerationStatusBar phase="searching" startedAt={Date.now()} />,
      );
    });
    expect(container.textContent).toContain('Searching...');
    expect(container.querySelector('canvas')).not.toBeNull();
  });

  it('formats long durations and compact token counts', () => {
    expect(formatGenerationDuration(125_000)).toBe('2m5s');
    expect(formatGenerationDuration(3_723_000)).toBe('1h2m3s');
    expect(formatGenerationTokens(9_500)).toBe('9.5k tokens');
    expect(formatGenerationTokens(25_000)).toBe('25k tokens');
  });

  it('uses a shared authoritative elapsed duration when provided', () => {
    act(() => {
      root.render(
        <GenerationStatusBar
          phase="generating"
          startedAt={Date.parse('2026-07-26T11:00:00.000Z')}
          elapsedMs={23_945}
        />,
      );
    });

    expect(container.textContent).toContain('24s');
  });

  it('marks live estimated token usage until provider usage is available', () => {
    act(() => {
      root.render(
        <GenerationStatusBar
          phase="thinking"
          elapsedMs={2_000}
          tokenCount={1_234}
          tokenCountEstimated
        />,
      );
    });

    expect(container.textContent).toContain('~1.2k tokens');
  });
});
