import { describe, expect, it } from 'vitest';
import {
  artifactFromMediaAttachment,
  artifactFromPath,
  artifactFromUrl,
  artifactPreviewKind,
  isPreviewableArtifact,
} from './artifacts';

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
});
