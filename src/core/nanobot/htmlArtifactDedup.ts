import type { MessageMediaAttachment } from '@/types';

const HTML_DELIVERY_REFERENCE_RE = /(^|[。！？；;!?\s]+)(?:[*_`>#-]+\s*)?(?:请\s*(?:查看|打开)\s*)?(?:完整\s*)?HTML\s*(?:报告|文件)?(?:\s*(?:路径|链接|地址))?\s*[:：]?/i;

function safelyDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizedArtifactReference(value: string): string {
  return safelyDecode(value)
    .trim()
    .replace(/\\/g, '/')
    .split(/[?#]/, 1)[0]
    .toLowerCase();
}

function htmlAttachmentIdentifiers(attachment: MessageMediaAttachment): string[] {
  const values = [
    attachment.localPath,
    attachment.path,
    attachment.name,
    attachment.url,
    attachment.downloadUrl,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const isHtml = attachment.mimeType?.toLowerCase().split(';', 1)[0] === 'text/html'
    || values.some((value) => /\.html?(?:$|[?#])/i.test(value));
  if (!isHtml) return [];

  const identifiers = new Set<string>();
  for (const value of values) {
    const normalized = normalizedArtifactReference(value);
    if (!/\.html?$/i.test(normalized)) continue;
    identifiers.add(normalized);
    const baseName = normalized.split('/').filter(Boolean).pop();
    if (baseName) identifiers.add(baseName);
  }
  return [...identifiers];
}

export function stripDuplicateHtmlArtifactReference(
  content: string,
  attachments: MessageMediaAttachment[],
): string {
  const identifiers = attachments.flatMap(htmlAttachmentIdentifiers);
  if (!content || identifiers.length === 0) return content;

  const cleaned = content.split('\n').map((line) => {
    const normalizedLine = safelyDecode(line).replace(/\\/g, '/').toLowerCase();
    if (!identifiers.some((identifier) => normalizedLine.includes(identifier))) return line;

    const match = HTML_DELIVERY_REFERENCE_RE.exec(line);
    if (!match) return line;
    const prefix = line.slice(0, match.index + match[1].length).trimEnd();
    return /^[-*+]$/.test(prefix.trim()) ? '' : prefix;
  });

  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
