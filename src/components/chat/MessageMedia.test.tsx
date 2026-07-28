import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { artifactPreviewKind } from '@/core/artifacts';
import { shellBridge } from '@/lib/ipc-factory';
import { usePreviewStore } from '@/stores/previewStore';
import { MessageMedia } from './MessageMedia';

let container: HTMLDivElement | undefined;
let root: Root | undefined;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  act(() => root?.unmount());
  usePreviewStore.getState().closePreview();
  container?.remove();
  container = undefined;
  root = undefined;
});

function render(
  media: Parameters<typeof MessageMedia>[0]['media'],
  visibility: Parameters<typeof MessageMedia>[0]['visibility'] = 'all',
) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<MessageMedia media={media} visibility={visibility} />));
  return container;
}

describe('MessageMedia artifact opening', () => {
  it('opens a signed PDF in the right-panel artifact preview', () => {
    const view = render([{
      url: '/api/media/sig/payload',
      downloadUrl: '/api/media/sig/payload?download=1',
      name: 'report.pdf',
      mimeType: 'application/pdf',
      kind: 'file',
    }]);

    act(() => view.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    const artifact = usePreviewStore.getState().previewArtifact;
    expect(artifact?.source.kind).toBe('gateway');
    expect(artifact && artifactPreviewKind(artifact)).toBe('pdf');
  });

  it('uses the same preview surface for a local PDF path', () => {
    const view = render([{ path: '/workspace/report.pdf', name: 'report.pdf', kind: 'file' }]);

    act(() => view.querySelector('[title="点击预览文件"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(usePreviewStore.getState().previewArtifact?.source).toEqual({
      kind: 'local',
      path: '/workspace/report.pdf',
    });
  });

  it('opens the HTML preview URL in the browser instead of downloading it', async () => {
    const open = vi.spyOn(shellBridge, 'open').mockResolvedValue();
    const view = render([{
      url: 'http://127.0.0.1:8900/api/media/sig/html?preview=1',
      downloadUrl: 'http://127.0.0.1:8900/api/media/sig/html?download=1',
      name: 'research-report.html',
      mimeType: 'text/html',
      kind: 'file',
    }]);

    await act(async () => {
      view.querySelector('[aria-label="在浏览器中打开"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(open).toHaveBeenCalledWith(
      'http://127.0.0.1:8900/api/media/sig/html?preview=1',
    );
    expect(open).not.toHaveBeenCalledWith(
      'http://127.0.0.1:8900/api/media/sig/html?download=1',
    );
    open.mockRestore();
  });

  it('keeps only HTML in assistant conversation media', () => {
    const view = render([
      {
        url: '/api/media/pdf',
        name: 'report.pdf',
        mimeType: 'application/pdf',
        kind: 'file',
      },
      {
        url: '/api/media/html',
        name: 'report.html',
        mimeType: 'text/html',
        kind: 'file',
      },
      {
        url: '/api/media/image',
        name: 'chart.png',
        mimeType: 'image/png',
        kind: 'image',
      },
    ], 'html-only');

    expect(view.textContent).toContain('report.html');
    expect(view.textContent).not.toContain('report.pdf');
    expect(view.querySelector('img')).toBeNull();
  });
});
