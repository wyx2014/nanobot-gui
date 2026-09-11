import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/version', () => ({ APP_VERSION: '0.0.1' }));

import { setLanguage } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import AppTitlebarMenu from './AppTitlebarMenu';
import HelpAndFeedbackOverlays from './HelpAndFeedbackOverlays';

let container: HTMLDivElement;
let root: Root;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function nextTask() {
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

function button(label: string) {
  return [...document.body.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.includes(label));
}

describe('Windows title-bar diagnostics flow', () => {
  beforeEach(() => {
    document.body.style.pointerEvents = '';
    setLanguage('zh-CN');
    useSettingsStore.setState({
      language: 'zh-CN',
      helpManualOpen: false,
      diagnosticsDialogOpen: false,
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<><AppTitlebarMenu /><HelpAndFeedbackOverlays /></>));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.style.pointerEvents = '';
    setLanguage('system');
  });

  it('releases the menu pointer lock before opening and closing diagnostics', async () => {
    const help = button('帮助(H)');
    expect(help).toBeTruthy();
    await act(async () => {
      help!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
      await nextTask();
    });

    const exportItem = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((candidate) => candidate.textContent?.includes('导出诊断包'));
    expect(exportItem).toBeTruthy();
    await act(async () => {
      exportItem!.click();
      await nextTask();
    });

    expect(document.querySelector('[data-testid="diagnostic-export-dialog"]')).toBeTruthy();
    expect(document.body.style.pointerEvents).toBe('none');

    await act(async () => {
      button('关闭')!.click();
      await nextTask();
    });

    expect(document.querySelector('[data-testid="diagnostic-export-dialog"]')).toBeNull();
    expect(document.body.style.pointerEvents).toBe('');
  });
});
