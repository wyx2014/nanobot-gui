import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerTokenProvider } from './api';
import { fetchSessionArtifacts, resolveWorkspaceArtifactPath } from './sessionArtifacts';

afterEach(() => {
  registerTokenProvider(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchSessionArtifacts', () => {
  it('uses an explicit gateway URL, bearer auth, and the encoded session key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      artifacts: [{
        id: 'art-1',
        project_id: 'project-1',
        session_id: 'session-1',
        status: 'ready',
        path: 'reports/market.pdf',
        name: 'market.pdf',
        kind: 'document',
        size: 4096,
        modified_at: '2026-07-25T08:30:00Z',
        mime_type: 'application/pdf',
        preview_url: '/api/sessions/websocket%3Achat-1/artifacts/content?path=reports%2Fmarket.pdf',
        download_url: '/api/sessions/websocket%3Achat-1/artifacts/content?path=reports%2Fmarket.pdf&download=1',
      }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const artifacts = await fetchSessionArtifacts(
      'secret-token',
      'websocket:chat/1',
      'http://127.0.0.1:8900',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8900/api/sessions/websocket%3Achat%2F1/artifacts',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-token',
        }),
      }),
    );
    expect(artifacts[0]).toMatchObject({
      id: 'art-1',
      projectId: 'project-1',
      sessionId: 'session-1',
      status: 'ready',
      path: 'reports/market.pdf',
      name: 'market.pdf',
      size: 4096,
      ref: {
        id: 'art-1',
        mimeType: 'application/pdf',
        source: {
          kind: 'gateway',
          requiresAuth: true,
          previewUrl: 'http://127.0.0.1:8900/api/sessions/websocket%3Achat-1/artifacts/content?path=reports%2Fmarket.pdf',
        },
      },
    });
  });

  it('builds authenticated content URLs when optional URLs are omitted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      artifacts: [{ path: 'output/table.xlsx', name: 'table.xlsx' }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    const [artifact] = await fetchSessionArtifacts(
      'token',
      'websocket:chat-2',
      'http://127.0.0.1:8900/',
    );

    expect(artifact.ref.source).toEqual({
      kind: 'gateway',
      requiresAuth: true,
      previewUrl: 'http://127.0.0.1:8900/api/sessions/websocket%3Achat-2/artifacts/content?path=output%2Ftable.xlsx',
      downloadUrl: 'http://127.0.0.1:8900/api/sessions/websocket%3Achat-2/artifacts/content?path=output%2Ftable.xlsx&download=1',
    });
  });

  it('shows only the newest revision for one logical artifact path', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      artifacts: [
        {
          id: 'new-report',
          path: 'reports/market.md',
          modified_at: '2026-07-26T15:22:27Z',
          status: 'ready',
        },
        {
          id: 'old-report',
          path: './reports/market.md',
          modified_at: '2026-07-26T15:18:24Z',
          status: 'ready',
        },
        {
          id: 'report-html',
          path: 'reports/market.html',
          modified_at: '2026-07-26T15:22:23Z',
          status: 'ready',
        },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    const artifacts = await fetchSessionArtifacts(
      'token',
      'websocket:chat-revisions',
      'http://127.0.0.1:8900',
    );

    expect(artifacts.map((artifact) => artifact.id)).toEqual([
      'new-report',
      'report-html',
    ]);
  });

  it('reconstructs a native shell path only inside the active conversation workspace', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      artifacts: [{
        path: 'reports/market.pdf',
        reveal_path: 'reports/market.pdf',
      }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    const [artifact] = await fetchSessionArtifacts(
      'token',
      'websocket:chat-2',
      'http://127.0.0.1:8900',
      '/Users/test/Documents/project',
    );

    expect(artifact.ref).toMatchObject({
      displayPath: 'reports/market.pdf',
      nativePath: '/Users/test/Documents/project/reports/market.pdf',
    });
    expect(resolveWorkspaceArtifactPath('/workspace', '../outside.pdf')).toBeUndefined();
    expect(resolveWorkspaceArtifactPath('/workspace', '/tmp/outside.pdf')).toBeUndefined();
    expect(resolveWorkspaceArtifactPath('/workspace', 'reports/../outside.pdf')).toBeUndefined();
  });

  it('rejects relative renderer API bases instead of hitting the renderer origin', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSessionArtifacts('token', 'websocket:chat-3', ''))
      .rejects.toThrow('explicit local service base URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a missing endpoint on an older gateway as an empty artifact list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));

    await expect(fetchSessionArtifacts(
      'token',
      'websocket:chat-4',
      'http://127.0.0.1:8900',
    )).resolves.toEqual([]);
  });

  it('refreshes an expired token once before reporting an artifact list failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        artifacts: [{ path: 'reports/recovered.pdf' }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const refresh = vi.fn().mockResolvedValue('fresh-token');
    registerTokenProvider(refresh);

    await expect(fetchSessionArtifacts(
      'expired-token',
      'websocket:chat-refresh',
      'http://127.0.0.1:8900',
    )).resolves.toEqual([
      expect.objectContaining({ path: 'reports/recovered.pdf' }),
    ]);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer expired-token' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fresh-token' }),
      }),
    );
  });

  it('rejects cross-origin artifact URLs so bearer credentials cannot leak', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      artifacts: [{
        path: 'report.pdf',
        preview_url: 'https://untrusted.example/report.pdf',
      }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(fetchSessionArtifacts(
      'secret-token',
      'websocket:chat-5',
      'http://127.0.0.1:8900',
    )).rejects.toThrow('outside its own origin');
  });

  it('rejects an artifact snapshot belonging to another project', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      project_id: 'project-b',
      session_id: 'session-a',
      artifacts: [],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(fetchSessionArtifacts(
      'token',
      'websocket:chat-a',
      'http://127.0.0.1:8900',
      '/workspace/a',
      { projectId: 'project-a', sessionId: 'session-a' },
    )).rejects.toThrow('different project');
  });
});
