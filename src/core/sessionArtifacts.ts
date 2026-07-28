import { artifactFromUrl, type ArtifactRef } from '@/core/artifacts';
import { fetchGatewayResponse } from '@/core/api';
import { getBaseName } from '@/utils/pathUtils';
import { normalizeProjectPath } from '@/core/workspace';

const ARTIFACTS_TIMEOUT_MS = 20_000;

export interface SessionArtifactRecord {
  id?: string;
  project_id?: string;
  session_id?: string;
  status?: 'staging' | 'ready' | 'failed' | 'missing' | 'quarantined' | string;
  relation?: string;
  sha256?: string;
  path: string;
  name?: string;
  kind?: string;
  size?: number;
  modified_at?: string | number | null;
  mime_type?: string;
  preview_url?: string;
  download_url?: string;
  reveal_path?: string;
  error_code?: string;
  error_message?: string;
}

export interface SessionArtifact {
  id: string;
  projectId?: string;
  sessionId?: string;
  status: 'staging' | 'ready' | 'failed' | 'missing' | 'quarantined';
  relation?: string;
  errorCode?: string;
  errorMessage?: string;
  sha256?: string;
  path: string;
  name: string;
  kind: string;
  size?: number;
  modifiedAt?: string | number;
  ref: ArtifactRef;
}

interface SessionArtifactsResponse {
  project_id?: string;
  session_id?: string;
  artifacts?: SessionArtifactRecord[];
}

export interface ExpectedSessionArtifactIdentity {
  projectId?: string;
  sessionId?: string;
}

function requireGatewayBase(base: string): string {
  const normalized = base.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+/i.test(normalized)) {
    throw new Error('Session artifacts require an explicit nanobot gateway base URL.');
  }
  return normalized;
}

function resolveGatewayUrl(base: string, value: string): string {
  if (!/^https?:\/\//i.test(value)) {
    return `${base}${value.startsWith('/') ? value : `/${value}`}`;
  }
  const gatewayUrl = new URL(base);
  const candidate = new URL(value);
  if (candidate.origin !== gatewayUrl.origin) {
    throw new Error('Gateway returned an artifact URL outside its own origin.');
  }
  return candidate.toString();
}

function contentUrl(base: string, sessionKey: string, path: string, download = false): string {
  const url = `${base}/api/sessions/${encodeURIComponent(sessionKey)}/artifacts/content?path=${encodeURIComponent(path)}`;
  return download ? `${url}&download=1` : url;
}

/**
 * Resolve the gateway's workspace-relative reveal path against the active
 * conversation workspace. Rejecting absolute/traversing values keeps a
 * compromised response from turning native shell actions into arbitrary opens.
 */
export function resolveWorkspaceArtifactPath(
  workspaceRoot: string | null | undefined,
  artifactPath: string | null | undefined,
): string | undefined {
  const root = workspaceRoot?.trim();
  const rawPath = artifactPath?.trim();
  if (
    !root
    || !rawPath
    || !/^(?:\/|[A-Za-z]:[\\/])/.test(root)
    || rawPath.includes('\0')
  ) {
    return undefined;
  }
  const relative = rawPath.replace(/\\/g, '/');
  if (
    relative.startsWith('/')
    || /^[A-Za-z]:\//.test(relative)
    || /^[a-z][a-z0-9+.-]*:/i.test(relative)
  ) {
    return undefined;
  }
  const segments = relative.split('/').filter((segment) => segment && segment !== '.');
  if (!segments.length || segments.some((segment) => segment === '..')) {
    return undefined;
  }
  const normalizedRoot = normalizeProjectPath(root);
  return `${normalizedRoot}/${segments.join('/')}`;
}

function normalizeArtifact(
  base: string,
  sessionKey: string,
  row: SessionArtifactRecord,
  workspaceRoot?: string | null,
): SessionArtifact | null {
  const path = typeof row.path === 'string' ? row.path.trim() : '';
  if (!path) return null;
  const name = (typeof row.name === 'string' && row.name.trim())
    ? row.name.trim()
    : getBaseName(path);
  const previewUrl = row.preview_url
    ? resolveGatewayUrl(base, row.preview_url)
    : contentUrl(base, sessionKey, path);
  const downloadUrl = row.download_url
    ? resolveGatewayUrl(base, row.download_url)
    : contentUrl(base, sessionKey, path, true);
  const size = typeof row.size === 'number' && Number.isFinite(row.size) && row.size >= 0
    ? row.size
    : undefined;
  const kind = typeof row.kind === 'string' && row.kind.trim() ? row.kind.trim() : 'file';
  const modifiedAt = (
    typeof row.modified_at === 'string'
    || typeof row.modified_at === 'number'
  ) ? row.modified_at : undefined;
  const nativePath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    typeof row.reveal_path === 'string' ? row.reveal_path : path,
  );
  const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : path;
  const status = (
    row.status === 'staging'
    || row.status === 'failed'
    || row.status === 'missing'
    || row.status === 'quarantined'
  ) ? row.status : 'ready';
  return {
    id,
    status,
    ...(typeof row.project_id === 'string' ? { projectId: row.project_id } : {}),
    ...(typeof row.session_id === 'string' ? { sessionId: row.session_id } : {}),
    ...(typeof row.relation === 'string' ? { relation: row.relation } : {}),
    ...(typeof row.error_code === 'string' ? { errorCode: row.error_code } : {}),
    ...(typeof row.error_message === 'string' ? { errorMessage: row.error_message } : {}),
    ...(typeof row.sha256 === 'string' ? { sha256: row.sha256 } : {}),
    path,
    name,
    kind,
    ...(size !== undefined ? { size } : {}),
    ...(modifiedAt !== undefined ? { modifiedAt } : {}),
    ref: artifactFromUrl(previewUrl, {
      id,
      name,
      mimeType: row.mime_type,
      size,
      downloadUrl,
      requiresAuth: true,
      displayPath: path,
      ...(nativePath ? { nativePath } : {}),
    }),
  };
}

function currentArtifactRevisions(artifacts: SessionArtifact[]): SessionArtifact[] {
  const sorted = [...artifacts].sort((left, right) => {
    const leftTime = left.modifiedAt === undefined ? 0 : new Date(left.modifiedAt).getTime();
    const rightTime = right.modifiedAt === undefined ? 0 : new Date(right.modifiedAt).getTime();
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
  const seenPaths = new Set<string>();
  return sorted.filter((artifact) => {
    const logicalPath = artifact.path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
    if (seenPaths.has(logicalPath)) return false;
    seenPaths.add(logicalPath);
    return true;
  });
}

export async function fetchSessionArtifacts(
  token: string,
  sessionKey: string,
  gatewayBase: string,
  workspaceRoot?: string | null,
  expectedIdentity?: ExpectedSessionArtifactIdentity,
): Promise<SessionArtifact[]> {
  const base = requireGatewayBase(gatewayBase);
  const url = `${base}/api/sessions/${encodeURIComponent(sessionKey)}/artifacts`;
  const response = await fetchGatewayResponse(url, token, {
    method: 'GET',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
    },
  }, ARTIFACTS_TIMEOUT_MS);

  // Older gateways do not expose the artifacts index yet. Treat that as an
  // empty workbench so the rest of chat remains usable during rolling updates.
  if (response.status === 404) return [];
  if (!response.ok) {
    const detail = typeof response.text === 'function' ? (await response.text()).trim() : '';
    throw new Error(detail || `Failed to load artifacts: HTTP ${response.status}`);
  }
  const contentType = response.headers?.get?.('content-type') ?? '';
  if (contentType && !contentType.toLowerCase().includes('application/json')) {
    throw new Error('Gateway returned a non-JSON artifact response.');
  }

  const payload = await response.json() as SessionArtifactsResponse;
  if (
    expectedIdentity?.projectId
    && payload.project_id
    && payload.project_id !== expectedIdentity.projectId
  ) {
    throw new Error('Gateway returned artifacts for a different project.');
  }
  if (
    expectedIdentity?.sessionId
    && payload.session_id
    && payload.session_id !== expectedIdentity.sessionId
  ) {
    throw new Error('Gateway returned artifacts for a different session.');
  }
  const normalized = (Array.isArray(payload.artifacts) ? payload.artifacts : [])
    .map((row) => normalizeArtifact(base, sessionKey, row, workspaceRoot))
    .filter((artifact) => (
      (!expectedIdentity?.projectId || !artifact?.projectId || artifact.projectId === expectedIdentity.projectId)
      && (!expectedIdentity?.sessionId || !artifact?.sessionId || artifact.sessionId === expectedIdentity.sessionId)
    ))
    .filter((artifact): artifact is SessionArtifact => artifact !== null);
  // Older gateways may still return every immutable revision.  Keep the GUI
  // compatible by treating a normalized project-relative path as one logical
  // artifact and displaying only its newest revision.
  return currentArtifactRevisions(normalized);
}
