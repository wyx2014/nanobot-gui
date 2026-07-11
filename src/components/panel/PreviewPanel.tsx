import { useState, useEffect, lazy, Suspense } from 'react';
import { shellBridge } from '@/lib/ipc-factory';
import { usePreviewStore } from '@/stores/previewStore';
import { useI18n } from '@/i18n';
import { ScrollArea } from '@/components/ui/scroll-area';
import MarkdownRenderer from '@/components/chat/MarkdownRenderer';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Loader2, X, FolderOpen, Code, Eye, FileCode, FileText, FileImage, FileSpreadsheet, FileType, File, ExternalLink, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  artifactDownloadUrl,
  artifactLocalPath,
  artifactObjectUrl,
  artifactPreviewKind,
  readArtifactText,
  type ArtifactPreviewKind,
} from '@/core/artifacts';

const PdfPreview = lazy(() => import('@/components/preview/PdfPreview'));
const DocxPreview = lazy(() => import('@/components/preview/DocxPreview'));
const XlsxPreview = lazy(() => import('@/components/preview/XlsxPreview'));
const CsvPreview = lazy(() => import('@/components/preview/CsvPreview'));

/** Binary types that handle their own file reading */
const BINARY_TYPES = new Set<ArtifactPreviewKind>(['pdf', 'docx', 'xlsx']);

function getLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', json: 'json', yaml: 'yaml', yml: 'yaml',
    html: 'html', css: 'css', sh: 'bash', bash: 'bash',
  };
  return langMap[ext] || ext || 'text';
}

function getFileIcon(filePath: string) {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'html', 'css', 'json'].includes(ext)) return FileCode;
  if (['md', 'txt', 'log'].includes(ext)) return FileText;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return FileImage;
  if (['xlsx', 'xls', 'csv'].includes(ext)) return FileSpreadsheet;
  if (ext === 'pdf' || ext === 'docx') return FileType;
  return File;
}

function LazyFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-5 h-5 text-[#d97757] animate-spin" />
    </div>
  );
}

export default function PreviewPanel() {
  const { previewArtifact, closePreview } = usePreviewStore();
  const { t } = useI18n();
  const [content, setContent] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [htmlViewMode, setHtmlViewMode] = useState<'preview' | 'source'>('preview');

  const rendererType = previewArtifact ? artifactPreviewKind(previewArtifact) : 'unsupported';
  const fileName = previewArtifact?.name || '';
  const Icon = previewArtifact ? getFileIcon(previewArtifact.name) : File;
  const localPath = previewArtifact ? artifactLocalPath(previewArtifact) : null;
  const downloadUrl = previewArtifact ? artifactDownloadUrl(previewArtifact) : null;

  useEffect(() => {
    if (!previewArtifact) {
      setContent(null);
      setImageUrl(null);
      return;
    }

    let cancelled = false;
    let blobUrl: string | null = null;

    const loadFile = async () => {
      setLoading(true);
      setError(null);
      setContent(null);
      setImageUrl(null);

      try {
        // Binary types and unsupported types don't need parent-level reads.
        if (rendererType === 'unsupported' || BINARY_TYPES.has(rendererType)) {
          setLoading(false);
          return;
        }

        if (rendererType === 'image' || rendererType === 'video') {
          blobUrl = await artifactObjectUrl(previewArtifact);
          if (cancelled) {
            if (blobUrl.startsWith('blob:')) URL.revokeObjectURL(blobUrl);
            blobUrl = null;
            return;
          }
          setImageUrl(blobUrl);
        } else {
          const text = await readArtifactText(previewArtifact);
          if (cancelled) return;
          setContent(text);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('[PreviewPanel] Failed to read artifact:', previewArtifact.name, err);
        const message = err instanceof Error ? err.message : String(err);
        setError(message || t.panel.failedToReadFile);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadFile();
    return () => {
      cancelled = true;
      if (blobUrl?.startsWith('blob:')) URL.revokeObjectURL(blobUrl);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- t is stable from i18n singleton
  }, [previewArtifact, rendererType]);

  const handleOpenInFinder = async () => {
    if (localPath) {
      try {
        await shellBridge.revealItemInDir(localPath);
      } catch (err) {
        console.error('Failed to open folder:', err);
      }
    }
  };

  const handleOpenSystem = async () => {
    if (!localPath) return;
    await shellBridge.openPath(localPath);
  };

  const handleDownload = async () => {
    if (!downloadUrl) return;
    await shellBridge.open(downloadUrl);
  };

  if (!previewArtifact) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Header — mt-7 to clear the overlay title bar drag region */}
      <div className="shrink-0 px-3 py-2.5 mt-7 border-b border-[#e5e2db] flex items-center gap-2">
        <Icon className="w-4 h-4 text-[#656358] shrink-0" />
        <span className="text-[13px] font-medium text-[#29261b] truncate flex-1">
          {fileName}
        </span>
        {rendererType === 'html' && (
          <div className="flex items-center bg-[#e8e5de] rounded p-0.5 mr-1">
            <button
              onClick={() => setHtmlViewMode('preview')}
              className={`p-1 rounded text-[10px] ${htmlViewMode === 'preview' ? 'bg-white shadow-sm' : ''}`}
              title={t.panel.previewMode}
            >
              <Eye className="w-3 h-3" />
            </button>
            <button
              onClick={() => setHtmlViewMode('source')}
              className={`p-1 rounded text-[10px] ${htmlViewMode === 'source' ? 'bg-white shadow-sm' : ''}`}
              title={t.panel.sourceMode}
            >
              <Code className="w-3 h-3" />
            </button>
          </div>
        )}
        {localPath ? (
          <>
            <Button variant="ghost" size="icon" onClick={handleOpenSystem} className="h-6 w-6 text-[#656358]" title={t.panel.openInSystem}>
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleOpenInFinder} className="h-6 w-6 text-[#656358]" title={t.panel.revealInFolder}>
              <FolderOpen className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : downloadUrl ? (
          <Button variant="ghost" size="icon" onClick={handleDownload} className="h-6 w-6 text-[#656358]" title={t.panel.downloadFile}>
            <Download className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          onClick={closePreview}
          className="h-6 w-6 text-[#656358] hover:text-[#29261b]"
          title={t.panel.closePreview}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-5 h-5 text-[#d97757] animate-spin" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full p-4 text-center">
            <p className="text-[13px] text-red-500">{error}</p>
          </div>
        ) : rendererType === 'pdf' || rendererType === 'docx' || rendererType === 'xlsx' || (rendererType === 'csv' && content !== null) ? (
          <Suspense fallback={<LazyFallback />}>
            {rendererType === 'pdf' && <PdfPreview artifact={previewArtifact} />}
            {rendererType === 'docx' && <DocxPreview artifact={previewArtifact} />}
            {rendererType === 'xlsx' && <XlsxPreview artifact={previewArtifact} />}
            {rendererType === 'csv' && content !== null && <CsvPreview content={content} />}
          </Suspense>
        ) : rendererType === 'image' && imageUrl ? (
          <div className="flex items-center justify-center h-full p-4 bg-[#e8e5de]/30">
            <img src={imageUrl} alt={fileName} className="max-w-full max-h-full object-contain" />
          </div>
        ) : rendererType === 'video' && imageUrl ? (
          <div className="flex items-center justify-center h-full p-4 bg-[#1f1f1f]">
            <video src={imageUrl} controls className="max-w-full max-h-full" title={fileName} />
          </div>
        ) : rendererType === 'markdown' && content !== null ? (
          <ScrollArea className="h-full">
            <div className="p-4">
              <MarkdownRenderer content={content} />
            </div>
          </ScrollArea>
        ) : rendererType === 'html' && content !== null ? (
          htmlViewMode === 'preview' ? (
            <iframe
              srcDoc={content}
              title={fileName}
              sandbox="allow-scripts"
              className="w-full h-full border-0 bg-white"
            />
          ) : (
            <ScrollArea className="h-full bg-[#1e1e1e]">
              <SyntaxHighlighter
                style={oneDark}
                language="html"
                customStyle={{ margin: 0, padding: '12px', fontSize: '11px', background: '#1e1e1e' }}
              >
                {content}
              </SyntaxHighlighter>
            </ScrollArea>
          )
        ) : rendererType === 'code' && content !== null ? (
          <ScrollArea className="h-full bg-[#1e1e1e]">
            <SyntaxHighlighter
              style={oneDark}
              language={getLanguage(previewArtifact.name)}
              showLineNumbers
              customStyle={{ margin: 0, padding: '12px', fontSize: '11px', background: '#1e1e1e' }}
              lineNumberStyle={{ minWidth: '2em', paddingRight: '0.5em', color: '#666' }}
            >
              {content}
            </SyntaxHighlighter>
          </ScrollArea>
        ) : rendererType === 'text' && content !== null ? (
          <ScrollArea className="h-full">
            <pre className="p-4 text-[12px] text-[#29261b] font-mono whitespace-pre-wrap break-words">
              {content}
            </pre>
          </ScrollArea>
        ) : (
          <div className="flex flex-col items-center justify-center h-full p-4 text-center">
            <p className="text-[13px] text-[#656358]">{t.panel.unsupportedFileType}</p>
            {localPath ? (
              <Button variant="outline" size="sm" onClick={handleOpenSystem} className="mt-3">
                <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                {t.panel.openInSystem}
              </Button>
            ) : downloadUrl ? (
              <Button variant="outline" size="sm" onClick={handleDownload} className="mt-3">
                <Download className="w-3.5 h-3.5 mr-1.5" />
                {t.panel.downloadFile}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
