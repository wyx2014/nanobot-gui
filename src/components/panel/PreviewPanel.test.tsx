import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { artifactFromPath } from '@/core/artifacts';
import { initLanguage } from '@/i18n';
import { clipboardBridge, fsBridge, shellBridge } from '@/lib/ipc-factory';
import { usePreviewStore } from '@/stores/previewStore';
import PreviewPanel from './PreviewPanel';

let container: HTMLDivElement | undefined;
let root: Root | undefined;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function renderPreview() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<PreviewPanel />));
  return container;
}

async function settleEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  initLanguage('en-US');
  usePreviewStore.getState().closePreview();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
  usePreviewStore.getState().closePreview();
  vi.restoreAllMocks();
});

describe('PreviewPanel artifact viewer', () => {
  it('uses an OpenWorker-style breadcrumb and native artifact toolbar', async () => {
    vi.spyOn(fsBridge, 'readTextFile').mockResolvedValue('artifact body');
    const openPath = vi.spyOn(shellBridge, 'openPath').mockResolvedValue();
    const reveal = vi.spyOn(shellBridge, 'revealItemInDir').mockResolvedValue();
    const copy = vi.spyOn(clipboardBridge, 'writeText').mockResolvedValue();

    usePreviewStore.getState().openArtifact(artifactFromPath(
      '/workspace/reports/market.txt',
      { displayPath: 'reports/market.txt' },
    ));
    const view = renderPreview();
    await settleEffects();

    expect(view.textContent).toContain('Artifacts');
    expect(view.textContent).toContain('market.txt');
    expect(view.textContent).toContain('reports/market.txt');
    expect(view.textContent).toContain('artifact body');

    await act(async () => {
      (view.querySelector('[aria-label="Open in system app"]') as HTMLButtonElement).click();
      (view.querySelector('[aria-label="Show in folder"]') as HTMLButtonElement).click();
      (view.querySelector('[aria-label="Copy path"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(openPath).toHaveBeenCalledWith('/workspace/reports/market.txt');
    expect(reveal).toHaveBeenCalledWith('/workspace/reports/market.txt');
    expect(copy).toHaveBeenCalledWith('/workspace/reports/market.txt');
  });

  it('returns to the artifact list with the back button', () => {
    vi.spyOn(fsBridge, 'readTextFile').mockResolvedValue('');
    usePreviewStore.getState().openArtifact(artifactFromPath('/workspace/report.txt'));
    const view = renderPreview();

    act(() => {
      (view.querySelector('[aria-label="Close preview"]') as HTMLButtonElement).click();
    });
    expect(usePreviewStore.getState().previewArtifact).toBeNull();
  });
});
