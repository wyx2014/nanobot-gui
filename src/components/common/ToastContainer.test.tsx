import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '@/stores/toastStore';
import ToastContainer from './ToastContainer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  useToastStore.setState({
    toasts: [{ id: 'toast-1', type: 'success', title: '完成' }],
  });
});

afterEach(() => {
  act(() => root.unmount());
  useToastStore.setState({ toasts: [] });
  container.remove();
});

describe('ToastContainer', () => {
  it('positions notifications below the shared title-bar safe edge', () => {
    act(() => root.render(<ToastContainer />));

    const stack = container.querySelector<HTMLElement>('.window-toast-container');
    expect(stack).not.toBeNull();
    expect(stack?.classList.contains('top-4')).toBe(false);
    expect(stack?.classList.contains('right-4')).toBe(true);
    expect(stack?.classList.contains('window-titlebar-no-drag')).toBe(true);
  });

  it('opens a clickable toast while the close button only dismisses it', () => {
    const onClick = vi.fn();
    useToastStore.setState({
      toasts: [{ id: 'toast-1', type: 'success', title: '完成', onClick }],
    });
    act(() => root.render(<ToastContainer />));

    const toast = container.querySelector<HTMLElement>('[role="button"]');
    expect(toast?.tabIndex).toBe(0);
    act(() => toast?.click());
    expect(onClick).toHaveBeenCalledOnce();
    expect(useToastStore.getState().toasts).toHaveLength(0);

    act(() => {
      useToastStore.setState({
        toasts: [{ id: 'toast-2', type: 'success', title: '完成', onClick }],
      });
    });
    const close = container.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    expect(close?.classList.contains('h-7')).toBe(true);
    expect(close?.classList.contains('w-7')).toBe(true);
    act(() => close?.click());
    expect(onClick).toHaveBeenCalledOnce();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
