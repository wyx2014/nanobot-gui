import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initLanguage } from '@/i18n';
import GatewayStartupStatus from './GatewayStartupStatus';

vi.mock('@/components/sidebar/NanobotDiagnosticsDialog', () => ({
  default: ({ open }: { open: boolean }) => open ? <div data-testid="diagnostics" /> : null,
}));

let root: Root;
let container: HTMLDivElement;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  initLanguage('en-US');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('GatewayStartupStatus', () => {
  it('replaces the loading animation with the startup failure and recovery actions', () => {
    const retry = vi.fn();
    act(() => root.render(<GatewayStartupStatus onRetry={retry} />));
    expect(container.querySelector('canvas')).not.toBeNull();
    act(() => root.render(<GatewayStartupStatus error="Gateway did not become ready within 30s" onRetry={retry} />));
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Gateway did not become ready within 30s');
    const buttons = container.querySelectorAll('button');
    expect(buttons[0].textContent).toBe('Retry');
    act(() => buttons[0].click());
    expect(retry).toHaveBeenCalledTimes(1);
    act(() => buttons[1].click());
    expect(container.querySelector('[data-testid="diagnostics"]')).not.toBeNull();
  });

  it('returns to the loading state when a retry clears the failure', () => {
    act(() => root.render(<GatewayStartupStatus error="Startup failed" />));
    act(() => root.render(<GatewayStartupStatus error={null} />));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('TP Cowork is starting');
    expect(container.querySelector('canvas')).not.toBeNull();
  });
});
