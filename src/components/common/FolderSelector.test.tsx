import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '@/stores/settingsStore';
import FolderSelector, { type FolderSelectorProps } from './FolderSelector';

let container: HTMLDivElement | undefined;
let root: Root | undefined;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderSelector(overrides: Partial<FolderSelectorProps> = {}) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(
    <FolderSelector
      currentPath={null}
      recentPaths={[]}
      projectsHydrated
      onSelect={() => {}}
      onClear={() => {}}
      variant="pill"
      {...overrides}
    />,
  ));
  return container;
}

function openPopover(view: HTMLElement) {
  const trigger = view.querySelector<HTMLButtonElement>('button');
  expect(trigger).not.toBeNull();
  act(() => trigger?.click());
  return view.querySelector<HTMLElement>('[data-workspace-selector-popover]');
}

function buttonWithText(view: ParentNode, text: string) {
  return [...view.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.includes(text));
}

beforeEach(() => {
  useSettingsStore.getState().setLanguage('zh-CN');
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

describe('FolderSelector first-use popover', () => {
  it('opens the popover without an empty search or project list', () => {
    const view = renderSelector();
    const popover = openPopover(view);

    expect(popover).not.toBeNull();
    expect(popover?.dataset.workspaceSelectorEmpty).toBe('true');
    expect(popover?.querySelector('[data-workspace-search]')).toBeNull();
    expect(popover?.querySelector('[data-workspace-project-list]')).toBeNull();
    expect(popover?.textContent).toContain('新建工作空间');

    const newWorkspace = buttonWithText(popover!, '新建工作空间');
    act(() => newWorkspace?.click());

    expect(popover?.textContent).toContain('新建空白工作空间');
    expect(popover?.textContent).toContain('使用现有项目');
  });

  it('keeps search and the project list once projects exist', () => {
    const view = renderSelector({ recentPaths: ['/Users/test/Alpha'] });
    const popover = openPopover(view);

    expect(popover?.querySelector('input[placeholder="搜索工作空间"]')).not.toBeNull();
    expect(popover?.querySelector('[data-workspace-project-list]')?.textContent).toContain('Alpha');
  });

  it('shows a compact loading row until the first project sync completes', () => {
    const view = renderSelector({ projectsHydrated: false });
    const popover = openPopover(view);

    expect(popover?.querySelector('[data-workspace-search]')).toBeNull();
    expect(popover?.querySelector('[data-workspace-project-list]')).toBeNull();
    expect(popover?.querySelector('[data-workspace-projects-loading]')).not.toBeNull();
  });
});
