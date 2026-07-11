import type { MessageMediaAttachment } from '@/types';
import { fsBridge } from '@/lib/ipc-factory';
import { getGatewayBaseUrl } from '@/core/nanobotClient';
import { getBaseName, isLocalFilePath } from '@/utils/pathUtils';

export type ArtifactPreviewKind =
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'csv'
  | 'html'
  | 'markdown'
  | 'code'
  | 'image'
  | 'video'
  | 'text'
  | 'unsupported';

export type ArtifactSource =
  | { kind: 'local'; path: string }
  | { kind: 'gateway'; previewUrl: string; downloadUrl: string }
  | { kind: 'remote'; url: string }
  | { kind: 'data'; url: string };

export interface ArtifactRef {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  source: ArtifactSource;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  log: 'text/plain',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
};

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'cpp', 'c', 'h',
  'json', 'yaml', 'yml', 'toml', 'xml', 'css', 'scss', 'less',
  'sh', 'bash', 'zsh', 'sql', 'graphql', 'rb', 'php', 'swift', 'kt',
]);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v']);

function cleanUrlPath(value: string): string {
  try {
    return decodeURIComponent(new URL(value, 'http://artifact.local').pathname);
  } catch {
    return value.split(/[?#]/, 1)[0] ?? value;
  }
}

export function artifactExtension(value: string): string {
  const clean = cleanUrlPath(value);
  const name = getBaseName(clean);
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function artifactMimeType(name: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim().toLowerCase();
  return MIME_BY_EXTENSION[artifactExtension(name)] || 'application/octet-stream';
}

export function artifactPreviewKind(artifact: ArtifactRef): ArtifactPreviewKind {
  const ext = artifactExtension(artifact.name);
  const mime = artifact.mimeType.toLowerCase();
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  if (ext === 'csv' || mime === 'text/csv') return 'csv';
  if (ext === 'html' || ext === 'htm' || mime === 'text/html') return 'html';
  if (ext === 'md' || ext === 'markdown' || mime === 'text/markdown') return 'markdown';
  if (IMAGE_EXTENSIONS.has(ext) || mime.startsWith('image/')) return 'image';
  if (VIDEO_EXTENSIONS.has(ext) || mime.startsWith('video/')) return 'video';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (ext === 'txt' || ext === 'log' || mime.startsWith('text/')) return 'text';
  return 'unsupported';
}

export function isPreviewableArtifact(artifact: ArtifactRef): boolean {
  return artifactPreviewKind(artifact) !== 'unsupported';
}

function stableArtifactId(source: string, name: string): string {
  let hash = 2166136261;
  const input = `${source}\0${name}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `artifact-${(hash >>> 0).toString(36)}`;
}

export function resolveArtifactUrl(url: string): string {
  if (!url || /^(https?:|data:|blob:)/i.test(url)) return url;
  const base = getGatewayBaseUrl();
  if (!base) return url;
  return `${base}${url.startsWith('/') ? url : `/${url}`}`;
}

export function artifactFromPath(
  path: string,
  metadata: Partial<Pick<ArtifactRef, 'id' | 'name' | 'mimeType' | 'size'>> = {},
): ArtifactRef {
  const name = metadata.name || getBaseName(path);
  return {
    id: metadata.id || stableArtifactId(path, name),
    name,
    mimeType: artifactMimeType(name, metadata.mimeType),
    ...(metadata.size !== undefined ? { size: metadata.size } : {}),
    source: { kind: 'local', path },
  };
}

export function artifactFromUrl(
  rawUrl: string,
  metadata: Partial<Pick<ArtifactRef, 'id' | 'name' | 'mimeType' | 'size'>> & { downloadUrl?: string } = {},
): ArtifactRef {
  const url = resolveArtifactUrl(rawUrl);
  const name = metadata.name || getBaseName(cleanUrlPath(url)) || '文件';
  const common = {
    id: metadata.id || stableArtifactId(url, name),
    name,
    mimeType: artifactMimeType(name, metadata.mimeType),
    ...(metadata.size !== undefined ? { size: metadata.size } : {}),
  };
  if (url.startsWith('data:')) return { ...common, source: { kind: 'data', url } };
  const isGateway = rawUrl.startsWith('/api/') || /\/api\/(?:media|artifacts)\//.test(url);
  if (isGateway) {
    return {
      ...common,
      source: {
        kind: 'gateway',
        previewUrl: url,
        downloadUrl: resolveArtifactUrl(metadata.downloadUrl || url),
      },
    };
  }
  return { ...common, source: { kind: 'remote', url } };
}

export function artifactFromMediaAttachment(attachment: MessageMediaAttachment): ArtifactRef {
  const localPath = attachment.localPath || attachment.path;
  const metadata = {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
  };
  if (localPath && isLocalFilePath(localPath)) return artifactFromPath(localPath, metadata);
  if (attachment.url) {
    return artifactFromUrl(attachment.url, { ...metadata, downloadUrl: attachment.downloadUrl });
  }
  if (localPath) return artifactFromPath(localPath, metadata);
  return artifactFromUrl('', { ...metadata, name: attachment.name || '文件' });
}

export function artifactLocalPath(artifact: ArtifactRef): string | null {
  return artifact.source.kind === 'local' ? artifact.source.path : null;
}

export function artifactContentUrl(artifact: ArtifactRef): string | null {
  if (artifact.source.kind === 'gateway') return artifact.source.previewUrl;
  if (artifact.source.kind === 'remote' || artifact.source.kind === 'data') return artifact.source.url;
  return null;
}

export function artifactDownloadUrl(artifact: ArtifactRef): string | null {
  if (artifact.source.kind === 'gateway') return artifact.source.downloadUrl;
  if (artifact.source.kind === 'remote') return artifact.source.url;
  return null;
}

export async function readArtifactBytes(artifact: ArtifactRef): Promise<Uint8Array> {
  const path = artifactLocalPath(artifact);
  if (path) return fsBridge.readFile(path);
  const url = artifactContentUrl(artifact);
  if (!url) throw new Error('文件内容地址不可用');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`读取文件失败：HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

export async function readArtifactText(artifact: ArtifactRef): Promise<string> {
  const path = artifactLocalPath(artifact);
  if (path) return fsBridge.readTextFile(path);
  const bytes = await readArtifactBytes(artifact);
  return new TextDecoder('utf-8').decode(bytes);
}

export async function artifactObjectUrl(artifact: ArtifactRef): Promise<string> {
  if (artifact.source.kind === 'data' || artifact.source.kind === 'remote') return artifact.source.url;
  if (artifact.source.kind === 'gateway' && artifact.mimeType.startsWith('video/')) {
    return artifact.source.previewUrl;
  }
  const bytes = await readArtifactBytes(artifact);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return URL.createObjectURL(new Blob([copy.buffer], { type: artifact.mimeType }));
}

export function looksLikeArtifactUrl(url: string): boolean {
  if (!/^(https?:\/\/|\/api\/)/i.test(url)) return false;
  return artifactPreviewKind(artifactFromUrl(url)) !== 'unsupported';
}
