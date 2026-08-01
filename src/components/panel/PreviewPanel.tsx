import { useState, useEffect, lazy, Suspense } from 'react';
import { clipboardBridge, shellBridge } from '@/lib/ipc-factory';
import { usePreviewStore } from '@/stores/previewStore';
import { useI18n } from '@/i18n';
import { ScrollArea } from '@/components/ui/scroll-area';
import MarkdownRenderer from '@/components/chat/MarkdownRenderer';
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  Maximize2,
  Minimize2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  artifactDisplayPath,
  artifactDownloadUrl,
  artifactContentUrl,
  artifactNativePath,
  artifactObjectUrl,
  artifactPreviewKind,
  artifactRequiresAuth,
  downloadArtifact,
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

function LazyFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-5 h-5 text-[#d97757] animate-spin" />
    </div>
  );
}

export default function PreviewPanel() {
  const { previewArtifact, closePreview, isExpanded, toggleExpanded } = usePreviewStore();
  const { locale, t } = useI18n();
  const [content, setContent] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const rendererType = previewArtifact ? artifactPreviewKind(previewArtifact) : 'unsupported';
  const fileName = previewArtifact?.name || '';
  const nativePath = previewArtifact ? artifactNativePath(previewArtifact) : null;
  const displayPath = previewArtifact ? artifactDisplayPath(previewArtifact) : '';
  const downloadUrl = previewArtifact ? artifactDownloadUrl(previewArtifact) : null;
  const requiresAuth = previewArtifact ? artifactRequiresAuth(previewArtifact) : false;

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
      setActionError(null);
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
  }, [previewArtifact, rendererType, reloadKey]);

  const runAction = async (action: () => Promise<void>) => {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      console.error('[PreviewPanel] Artifact action failed:', err);
      setActionError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleOpenInFinder = () => {
    if (!nativePath) return;
    void runAction(() => shellBridge.revealItemInDir(nativePath));
  };

  const handleOpenSystem = () => {
    if (!nativePath) return;
    void runAction(() => shellBridge.openPath(nativePath));
  };

  const handleOpenInBrowser = () => {
    if (!previewArtifact || requiresAuth) return;
    const target = nativePath
      ? `file://${encodeURI(nativePath).replace(/#/g, '%23')}`
      : artifactContentUrl(previewArtifact);
    if (target) void runAction(() => shellBridge.open(target));
  };

  const handleDownload = () => {
    if (!previewArtifact || !downloadUrl) return;
    void runAction(async () => {
      if (requiresAuth) {
        await downloadArtifact(previewArtifact);
      } else {
        await shellBridge.open(downloadUrl);
      }
    });
  };

  const handleCopyPath = () => {
    const path = nativePath || displayPath || downloadUrl;
    if (!path) return;
    void runAction(async () => {
      await clipboardBridge.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_200);
    });
  };

  if (!previewArtifact) return null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f5f3ee] dark:bg-[#202020]">
      {/* OpenWorker-style viewer header: back to the rail, breadcrumb, path, then native actions. */}
      <div className="mt-7 flex min-h-[58px] shrink-0 items-center gap-3 border-b border-[#e5e2db] bg-[#fbfaf7]/95 px-4 py-2.5 dark:border-[#3d3d3d] dark:bg-[#262626]/95">
        <Button
          variant="ghost"
          size="icon"
          onClick={closePreview}
          className="h-[30px] w-[30px] shrink-0 text-[#656358] hover:bg-[#f0ede7] hover:text-[#29261b] dark:text-[#c9c5bc] dark:hover:bg-[#3a3a3a] dark:hover:text-[#f5f2ea]"
          title={t.panel.closePreview}
          aria-label={t.panel.closePreview}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 text-[14px] font-semibold text-[#29261b] dark:text-[#f3f0e8]">
            <span className="shrink-0">{t.panel.artifacts}</span>
            <span className="font-normal text-[#aaa69c] dark:text-[#77746d]">/</span>
            <span className="truncate">{fileName}</span>
          </div>
          <div className="mt-0.5 truncate text-[11.5px] text-[#9a968c] dark:text-[#a39f96]" title={displayPath}>
            {displayPath}
          </div>
        </div>
        {rendererType === 'html' ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setReloadKey((key) => key + 1)}
            className="h-[30px] w-[30px] text-[#656358] hover:bg-[#f0ede7] hover:text-[#29261b] dark:text-[#c9c5bc] dark:hover:bg-[#3a3a3a] dark:hover:text-[#f5f2ea]"
            title={t.panel.artifactsRefresh}
            aria-label={t.panel.artifactsRefresh}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        ) : null}
        {nativePath ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleOpenSystem}
            className="h-[30px] w-[30px] text-[#656358] hover:bg-[#f0ede7] hover:text-[#29261b] dark:text-[#c9c5bc] dark:hover:bg-[#3a3a3a] dark:hover:text-[#f5f2ea]"
            title={t.panel.openInSystem}
            aria-label={t.panel.openInSystem}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        ) : (rendererType === 'html' || rendererType === 'pdf') && !requiresAuth ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleOpenInBrowser}
            className="h-[30px] w-[30px] text-[#656358]"
            title={t.panel.openInBrowser}
            aria-label={t.panel.openInBrowser}
          >
            <ExternalLink className="h-4 w-4" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          onClick={handleCopyPath}
          className="h-[30px] w-[30px] text-[#656358] hover:bg-[#f0ede7] hover:text-[#29261b] dark:text-[#c9c5bc] dark:hover:bg-[#3a3a3a] dark:hover:text-[#f5f2ea]"
          title={nativePath ? nativePath : displayPath}
          aria-label={locale.startsWith('zh') ? '复制路径' : 'Copy path'}
        >
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
        </Button>
        {nativePath ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleOpenInFinder}
            className="h-[30px] w-[30px] text-[#656358] hover:bg-[#f0ede7] hover:text-[#29261b] dark:text-[#c9c5bc] dark:hover:bg-[#3a3a3a] dark:hover:text-[#f5f2ea]"
            title={t.panel.revealInFolder}
            aria-label={t.panel.revealInFolder}
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
        ) : null}
        {downloadUrl ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDownload}
            className="h-[30px] w-[30px] text-[#656358] hover:bg-[#f0ede7] hover:text-[#29261b] dark:text-[#c9c5bc] dark:hover:bg-[#3a3a3a] dark:hover:text-[#f5f2ea]"
            title={t.panel.downloadFile}
            aria-label={t.panel.downloadFile}
          >
            <Download className="h-4 w-4" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleExpanded}
          className="h-[30px] w-[30px] text-[#656358] hover:bg-[#f0ede7] hover:text-[#29261b] dark:text-[#c9c5bc] dark:hover:bg-[#3a3a3a] dark:hover:text-[#f5f2ea]"
          title={isExpanded ? '收起预览面板' : '展开预览面板'}
          aria-label={isExpanded ? '收起预览面板' : '展开预览面板'}
        >
          {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
      </div>
      {actionError ? (
        <div className="shrink-0 border-b border-red-100 bg-red-50 px-4 py-1.5 text-[11.5px] text-red-600 dark:border-red-900/50 dark:bg-red-950/35 dark:text-red-300">
          {actionError}
        </div>
      ) : null}

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
          <div className="h-full overflow-auto bg-[#eeece6] p-5">
            <img
              src={imageUrl}
              alt={fileName}
              className="mx-auto block max-w-full rounded-lg border border-[#d9d5cc] object-contain"
              style={{
                background: 'repeating-conic-gradient(#f7f5f0 0% 25%, #e7e3db 0% 50%) 0 0 / 20px 20px',
              }}
            />
          </div>
        ) : rendererType === 'video' && imageUrl ? (
          <div className="flex items-center justify-center h-full p-4 bg-[#1f1f1f]">
            <video src={imageUrl} controls className="max-w-full max-h-full" title={fileName} />
          </div>
        ) : rendererType === 'markdown' && content !== null ? (
          <ScrollArea className="h-full">
            <div className="mx-auto max-w-[860px] px-7 pb-20 pt-6 text-[14.5px] leading-relaxed">
              <MarkdownRenderer content={content} />
            </div>
          </ScrollArea>
        ) : rendererType === 'html' && content !== null ? (
          <iframe
            srcDoc={content}
            title={fileName}
            sandbox="allow-scripts"
            className="w-full h-full border-0 bg-white"
          />
        ) : rendererType === 'code' && content !== null ? (
          <ScrollArea className="h-full bg-[#fbfaf7]">
            <SyntaxHighlighter
              style={oneLight}
              language={getLanguage(previewArtifact.name)}
              showLineNumbers
              customStyle={{
                margin: 0,
                minHeight: '100%',
                padding: '22px 26px',
                fontSize: '12.5px',
                lineHeight: 1.55,
                background: '#fbfaf7',
              }}
              lineNumberStyle={{ minWidth: '2.5em', paddingRight: '0.75em', color: '#aaa69c' }}
            >
              {content}
            </SyntaxHighlighter>
          </ScrollArea>
        ) : rendererType === 'text' && content !== null ? (
          <ScrollArea className="h-full">
            <pre className="px-[26px] py-[22px] text-[12.5px] leading-[1.55] text-[#29261b] font-mono whitespace-pre-wrap break-words">
              {content}
            </pre>
          </ScrollArea>
        ) : (
          <div className="flex flex-col items-center justify-center h-full p-4 text-center">
            <p className="text-[13px] text-[#656358]">{t.panel.unsupportedFileType}</p>
            {nativePath ? (
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
