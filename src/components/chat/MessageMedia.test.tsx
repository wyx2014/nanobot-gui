import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { artifactPreviewKind } from '@/core/artifacts';
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

function render(media: Parameters<typeof MessageMedia>[0]['media']) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<MessageMedia media={media} />));
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
});
