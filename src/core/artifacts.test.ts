import { afterEach, describe, expect, it, vi } from 'vitest';
import * as nanobotClient from './nanobotClient';
import { registerTokenProvider } from './api';
import {
  artifactFromMediaAttachment,
  artifactFromPath,
  artifactFromUrl,
  artifactNativePath,
  artifactPreviewKind,
  isPreviewableArtifact,
  readArtifactBytes,
} from './artifacts';

afterEach(() => {
  registerTokenProvider(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('artifact normalization', () => {
  it('normalizes a local PDF into a right-panel preview artifact', () => {
    const artifact = artifactFromPath('/workspace/reports/market.pdf');

    expect(artifact).toMatchObject({
      name: 'market.pdf',
      mimeType: 'application/pdf',
      source: { kind: 'local', path: '/workspace/reports/market.pdf' },
    });
    expect(artifactPreviewKind(artifact)).toBe('pdf');
    expect(isPreviewableArtifact(artifact)).toBe(true);
  });

  it('uses the attachment name to classify an extensionless signed URL', () => {
    const artifact = artifactFromUrl('/api/media/sig/payload', {
      name: 'market.pdf',
      mimeType: 'application/pdf',
      downloadUrl: '/api/media/sig/payload?download=1',
    });

    expect(artifact.source).toMatchObject({
      kind: 'gateway',
    });
    expect(artifactPreviewKind(artifact)).toBe('pdf');
  });

  it('keeps remote documents previewable instead of treating them as web pages', () => {
    const artifact = artifactFromUrl('https://example.com/report.docx');

    expect(artifact.source).toEqual({ kind: 'remote', url: 'https://example.com/report.docx' });
    expect(artifactPreviewKind(artifact)).toBe('docx');
  });

  it('keeps signed videos inside the unified preview surface', () => {
    const artifact = artifactFromUrl('/api/media/sig/payload', {
      name: 'demo.mp4',
      mimeType: 'video/mp4',
    });

    expect(artifactPreviewKind(artifact)).toBe('video');
  });

  it('prefers a trusted local path when an attachment has both path and URL', () => {
    const artifact = artifactFromMediaAttachment({
      path: '/workspace/report.xlsx',
      url: 'http://127.0.0.1:8900/api/media/sig/payload',
      name: 'report.xlsx',
    });

    expect(artifact.source).toEqual({ kind: 'local', path: '/workspace/report.xlsx' });
    expect(artifactPreviewKind(artifact)).toBe('xlsx');
  });

  it('reads protected gateway artifacts with a bearer header, never a tokenized URL', async () => {
    vi.spyOn(nanobotClient, 'getNanobotToken').mockReturnValue('private-token');
    vi.spyOn(nanobotClient, 'getGatewayBaseUrl').mockReturnValue('http://127.0.0.1:8900');
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'application/pdf' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const artifact = artifactFromUrl(
      'http://127.0.0.1:8900/api/sessions/websocket%3Achat/artifacts/content?path=report.pdf',
      {
        name: 'report.pdf',
        requiresAuth: true,
        nativePath: '/workspace/report.pdf',
      },
    );

    expect(artifactNativePath(artifact)).toBe('/workspace/report.pdf');
    await expect(readArtifactBytes(artifact)).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8900/api/sessions/websocket%3Achat/artifacts/content?path=report.pdf',
      {
        credentials: 'same-origin',
        headers: expect.objectContaining({ Authorization: 'Bearer private-token' }),
      },
    );
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('private-token');
  });

  it('refreshes an expired token before retrying protected artifact content', async () => {
    vi.spyOn(nanobotClient, 'getNanobotToken').mockReturnValue('expired-token');
    vi.spyOn(nanobotClient, 'getGatewayBaseUrl').mockReturnValue('http://127.0.0.1:8900');
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response(new Uint8Array([4, 5, 6]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const refresh = vi.fn().mockResolvedValue('fresh-token');
    registerTokenProvider(refresh);
    const artifact = artifactFromUrl(
      'http://127.0.0.1:8900/api/artifacts/art-1/content',
      {
        name: 'report.pdf',
        requiresAuth: true,
      },
    );

    await expect(readArtifactBytes(artifact)).resolves.toEqual(new Uint8Array([4, 5, 6]));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fresh-token' }),
      }),
    );
  });
});
