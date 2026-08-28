import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsStore } from '@/stores/settingsStore';
import HelpManual from './HelpManual';

vi.mock('@/utils/version', () => ({ APP_VERSION: '0.0.1' }));

let container: HTMLDivElement;
let root: Root;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  useSettingsStore.getState().setLanguage('zh-CN');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderManual(onClose = vi.fn()) {
  act(() => root.render(<HelpManual onClose={onClose} />));
  return onClose;
}

describe('HelpManual', () => {
  it('opens on a concise quick-start chapter with grouped task navigation', () => {
    renderManual();

    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(container.querySelector('[data-help-title]')?.textContent).toBe('3 分钟快速上手');
    expect(container.querySelectorAll('[data-help-chapter]')).toHaveLength(12);
    expect(container.textContent).toContain('开始使用');
    expect(container.textContent).toContain('核心工作');
    expect(container.textContent).toContain('扩展能力');
    expect(container.textContent).toContain('配置与支持');
  });

  it('filters the manual and opens the matching chapter', () => {
    renderManual();
    const input = container.querySelector<HTMLInputElement>('[data-help-search]');
    expect(input).not.toBeNull();

    act(() => {
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '任意 cron');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(container.querySelectorAll('[data-help-chapter]')).toHaveLength(1);
    expect(container.querySelector('[data-help-chapter="automations"]')).not.toBeNull();
    expect(container.querySelector('[data-help-title]')?.textContent).toBe('自动化与定时任务');
  });

  it('switches chapters and closes with Escape', async () => {
    const onClose = renderManual();
    const filesChapter = container.querySelector<HTMLButtonElement>('[data-help-chapter="files-artifacts"]');

    act(() => filesChapter?.click());
    expect(container.querySelector('[data-help-title]')?.textContent).toBe('文件、附件与产物');

    // The first body render is deferred by 40ms so the entrance animation
    // is not blocked by the markdown render.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(container.querySelector('[data-help-article]')?.textContent).toContain('添加文件的四种方式');

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
