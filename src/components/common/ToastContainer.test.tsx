import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useToastStore } from '@/stores/toastStore';
import ToastContainer from './ToastContainer';

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
  });
});
