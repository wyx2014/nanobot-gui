import { ExternalLink, FileCode, FileText, Globe2, ImageIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { MessageContent, MessageMediaAttachment } from '@/types';
import { cn } from '@/lib/utils';
import { getBaseName, loadLocalImage } from '@/utils/pathUtils';
import { shellBridge } from '@/lib/ipc-factory';
import FileAttachment, { isImageFile } from './FileAttachment';
import { artifactFromMediaAttachment, artifactFromUrl } from '@/core/artifacts';
import { usePreviewStore } from '@/stores/previewStore';

type Align = 'left' | 'right';
type Visibility = 'all' | 'html-only';

function mediaKey(item: MessageMediaAttachment, index: number): string {
  return item.path || item.url || item.name || `${item.kind ?? 'media'}-${index}`;
}

function urlPath(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return value.split('?')[0] ?? value;
  }
}

function mediaKind(item: MessageMediaAttachment): MessageMediaAttachment['kind'] {
  const name = item.name || item.path || (item.url ? urlPath(item.url) : '');
  if (isImageFile(name)) return 'image';
  if (item.kind) return item.kind;
  return 'file';
}

function displayName(item: MessageMediaAttachment): string {
  if (item.name) return item.name;
  if (item.path) return getBaseName(item.path);
  if (item.url) return getBaseName(urlPath(item.url)) || item.url;
  return item.kind === 'image' ? 'Image' : 'File';
}

function isHtmlMedia(item: MessageMediaAttachment): boolean {
  if (item.mimeType?.toLowerCase().split(';', 1)[0] === 'text/html') return true;
  return /\.html?$/i.test(displayName(item));
}

function ImagePlaceholder({ label, compact }: { label: string; compact?: boolean }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1 rounded-[14px] border border-[#e5e2db] bg-[#f5f3ee] px-2 text-[11px] text-[#656358]',
        compact ? 'h-20 w-20' : 'h-24 w-24',
      )}
      title={label}
    >
      <ImageIcon className="h-4 w-4" />
      <span className="line-clamp-2 text-center leading-tight">{label}</span>
    </div>
  );
}

function DataImageTile({
  image,
  index,
  compact,
}: {
  image: Extract<MessageContent, { type: 'image' }>;
  index: number;
  compact?: boolean;
}) {
  const openArtifact = usePreviewStore((state) => state.openArtifact);
  const dataUrl = useMemo(() => `data:${image.source.media_type};base64,${image.source.data}`, [image.source.data, image.source.media_type]);
  const label = `Image ${index + 1}`;
  const openDataImage = () => openArtifact(artifactFromUrl(dataUrl, { name: label, mimeType: image.source.media_type }));
  return (
    <div
      className={cn(
        'group/media relative overflow-hidden rounded-[14px] border border-[#e5e2db] bg-[#f5f3ee] p-0 shadow-[0_6px_18px_-14px_rgba(0,0,0,0.45)]',
        compact ? 'h-20 w-20' : 'h-24 w-24',
      )}
      title={label}
    >
      <img src={dataUrl} alt={label} className="h-full w-full object-cover" draggable={false} />
      <button
        type="button"
        onClick={openDataImage}
        className="absolute bottom-1.5 right-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#29261b]/85 text-white opacity-0 shadow-sm transition-opacity hover:bg-[#29261b] group-hover/media:opacity-100"
        title="打开图片"
        aria-label="打开图片"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function LocalImageTile({
  item,
  compact,
}: {
  item: MessageMediaAttachment;
  compact?: boolean;
}) {
  const openArtifact = usePreviewStore((state) => state.openArtifact);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const label = displayName(item);

  useEffect(() => {
    if (!item.path) return;
    let cancelled = false;
    let blobUrl: string | null = null;
    setImageUrl(null);
    setFailed(false);
    loadLocalImage(item.path)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        blobUrl = url;
        setImageUrl(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [item.path]);

  const reveal = async (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (!item.path) return;
    try {
      await shellBridge.revealItemInDir(item.path);
    } catch {
      // Finder reveal is best-effort only.
    }
  };

  const openFile = (event: React.MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    openArtifact(artifactFromMediaAttachment(item));
  };

  if (!imageUrl) {
    return <ImagePlaceholder label={failed ? `${label} 加载失败` : label} compact={compact} />;
  }

  return (
    <div
      className={cn(
        'group/media relative overflow-hidden rounded-[14px] border border-[#e5e2db] bg-white shadow-[0_6px_18px_-14px_rgba(0,0,0,0.45)] transition-all hover:border-[#d97757]/40 hover:shadow-sm',
        compact ? 'max-w-[11rem]' : 'max-w-[min(100%,22rem)]',
      )}
    >
      <div className="relative p-1.5" title={label}>
        <img src={imageUrl} alt={label} className={cn('w-full rounded-lg object-contain', compact ? 'max-h-28' : 'max-h-80')} draggable={false} />
        <button
          type="button"
          onClick={openFile}
          className="absolute bottom-3 right-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#29261b]/85 text-white opacity-0 shadow-sm transition-opacity hover:bg-[#29261b] group-hover/media:opacity-100"
          title="预览图片"
          aria-label="预览图片"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-1.5 px-2.5 pb-2 text-[12px] text-[#29261b]">
        <button
          type="button"
          onClick={openFile}
          className="min-w-0 flex-1 truncate text-left transition-colors hover:text-[#d97757] hover:underline"
          title="预览图片"
        >
          {label}
        </button>
        {item.path ? (
          <button
            type="button"
            onClick={reveal}
            className="rounded p-1 text-[#888579] transition-colors hover:bg-[#f5f3ee] hover:text-[#29261b]"
            title="在 Finder 中显示"
          >
            <ExternalLink className="h-3 w-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function RemoteImageTile({
  item,
  compact,
}: {
  item: MessageMediaAttachment;
  compact?: boolean;
}) {
  const openArtifact = usePreviewStore((state) => state.openArtifact);
  const [failed, setFailed] = useState(false);
  const label = displayName(item);
  if (!item.url || failed) return <ImagePlaceholder label={failed ? `${label} 加载失败` : label} compact={compact} />;
  const openRemoteImage = () => openArtifact(artifactFromMediaAttachment(item));
  return (
    <div
      className={cn(
        'group/media relative overflow-hidden rounded-[14px] border border-[#e5e2db] bg-white p-1.5 shadow-[0_6px_18px_-14px_rgba(0,0,0,0.45)] transition-all hover:border-[#d97757]/40 hover:shadow-sm',
        compact ? 'max-w-[11rem]' : 'max-w-[min(100%,22rem)]',
      )}
      title={label}
    >
      <img
        src={item.url}
        alt={label}
        className={cn('w-full rounded-lg object-contain', compact ? 'max-h-28' : 'max-h-80')}
        onError={() => setFailed(true)}
        draggable={false}
      />
      <button
        type="button"
        onClick={openRemoteImage}
        className="absolute bottom-8 right-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#29261b]/85 text-white opacity-0 shadow-sm transition-opacity hover:bg-[#29261b] group-hover/media:opacity-100"
        title="打开图片"
        aria-label="打开图片"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </button>
      <div className="truncate px-1 pb-0.5 pt-1.5 text-left text-[12px] text-[#29261b]">{label}</div>
    </div>
  );
}

function RemoteFileTile({ item }: { item: MessageMediaAttachment }) {
  const openArtifact = usePreviewStore((state) => state.openArtifact);
  const label = displayName(item);
  if (!item.url) {
    return (
      <span className="inline-flex max-w-[16rem] items-center gap-2 rounded-lg border border-[#e5e2db] bg-white px-3 py-2 text-[13px] text-[#656358]" title={label}>
        <FileText className="h-4 w-4 shrink-0 text-[#888579]" />
        <span className="truncate">{label}</span>
      </span>
    );
  }
  if (/\.html?$/i.test(label)) {
    const openBrowser = async (event: React.MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
      if (item.url) await shellBridge.open(item.url);
    };
    return (
      <div
        onClick={() => openArtifact(artifactFromMediaAttachment(item))}
        className="group flex min-h-[72px] w-full cursor-pointer items-center gap-4 rounded-2xl bg-[#efefef] px-5 py-3 transition-colors hover:bg-[#e9e9e9]"
        title={label}
      >
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[#5b86d6] text-white shadow-sm">
          <FileCode className="h-6 w-6" strokeWidth={2.2} />
        </div>
        <span className="min-w-0 flex-1 truncate text-left text-[16px] font-semibold text-[#202020]">{label}</span>
        <button
          type="button"
          onClick={openBrowser}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[#555] transition-colors hover:bg-white/80 hover:text-[#202020]"
          title="在浏览器中打开"
          aria-label="在浏览器中打开"
        >
          <Globe2 className="h-5 w-5" />
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => openArtifact(artifactFromMediaAttachment(item))}
      className="inline-flex max-w-[16rem] items-center gap-2 rounded-lg border border-[#e5e2db] bg-white px-3 py-2 text-[13px] text-[#29261b] transition-all hover:border-[#d97757]/40 hover:shadow-sm"
      title={item.url}
    >
      <FileText className="h-4 w-4 shrink-0 text-[#656358]" />
      <span className="truncate">{label}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[#888579]" />
    </button>
  );
}

export function UserImageGrid({
  images,
  align = 'right',
  compact,
}: {
  images: Extract<MessageContent, { type: 'image' }>[];
  align?: Align;
  compact?: boolean;
}) {
  if (images.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap items-end gap-2', align === 'right' ? 'ml-auto justify-end' : 'mr-auto justify-start')}>
      {images.map((image, index) => (
        <DataImageTile
          key={`${image.source.data.slice(0, 12)}-${index}`}
          image={image}
          index={index}
          compact={compact}
        />
      ))}
    </div>
  );
}

export function MessageMedia({
  media,
  align = 'left',
  compact,
  className,
  visibility = 'all',
}: {
  media: MessageMediaAttachment[];
  align?: Align;
  compact?: boolean;
  className?: string;
  visibility?: Visibility;
}) {
  const visibleMedia = visibility === 'html-only'
    ? media.filter(isHtmlMedia)
    : media;
  if (visibleMedia.length === 0) return null;

  return (
    <div className={cn(compact ? 'mt-0' : 'mt-2', 'flex flex-wrap gap-2', align === 'right' ? 'justify-end' : 'justify-start', className)}>
      {visibleMedia.map((item, index) => {
        const key = mediaKey(item, index);
        if (mediaKind(item) === 'image') {
          if (item.path) return <LocalImageTile key={key} item={item} compact={compact} />;
          return <RemoteImageTile key={key} item={item} compact={compact} />;
        }
        if (item.path) return <FileAttachment key={key} filePath={item.path} />;
        return <RemoteFileTile key={key} item={item} />;
      })}
    </div>
  );
}
