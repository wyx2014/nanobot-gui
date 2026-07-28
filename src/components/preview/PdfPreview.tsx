import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { useI18n } from '@/i18n';
import { Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { readArtifactBytes, type ArtifactRef } from '@/core/artifacts';

import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

function LoadingIndicator({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 h-full">
      <Loader2 className="w-5 h-5 text-[#d97757] animate-spin" />
      {label && <span className="text-[13px] text-[#656358]">{label}</span>}
    </div>
  );
}

export default function PdfPreview({ artifact }: { artifact: ArtifactRef }) {
  const { locale, t } = useI18n();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [pageWidth, setPageWidth] = useState(720);

  useEffect(() => {
    let cancelled = false;
    let currentUrl: string | null = null;

    const load = async () => {
      setError(null);
      setPdfUrl(null);
      setNumPages(0);
      try {
        const data = await readArtifactBytes(artifact);
        if (cancelled) return;
        const bytes = new Uint8Array(data.byteLength);
        bytes.set(data);
        const blob = new Blob([bytes.buffer], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        currentUrl = url;
        setPdfUrl(url);
      } catch (err) {
        if (cancelled) return;
        console.error('[PdfPreview] Failed to read:', err);
        setError(err instanceof Error ? err.message : String(err));
      }
    };

    load();
    return () => {
      cancelled = true;
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [artifact]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const updateWidth = () => {
      const width = Math.max(280, Math.floor(node.clientWidth - 32));
      setPageWidth(width);
    };
    updateWidth();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth);
      return () => window.removeEventListener('resize', updateWidth);
    }
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, [pdfUrl]);

  const loading = !pdfUrl && !error;

  const onDocumentLoadSuccess = ({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
  };

  const onDocumentLoadError = (err: Error) => {
    console.error('[PdfPreview] PDF load error:', err);
    setError(err.message);
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <p className="text-[13px] text-red-500">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      {numPages > 0 && (
        <div className="shrink-0 flex items-center justify-between px-3 py-1.5 bg-[#f5f3ee] border-b border-[#e5e2db]">
          <span className="text-[11px] text-[#656358]">
            {locale.startsWith('zh') ? `共 ${numPages} 页` : `${numPages} page${numPages === 1 ? '' : 's'}`}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setScale(s => Math.max(0.5, s - 0.25))}
              disabled={scale <= 0.5}
              title={t.panel.pdfZoomOut}
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <span className="text-[11px] text-[#656358] min-w-[40px] text-center">
              {Math.round(scale * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setScale(s => Math.min(3, s + 0.25))}
              disabled={scale >= 3}
              title={t.panel.pdfZoomIn}
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* PDF Content */}
      <ScrollArea className="flex-1 min-h-0">
        <div ref={viewportRef} className="min-h-full bg-[#e8e5de]/50 p-4">
          {loading && (
            <LoadingIndicator label={t.panel.loadingDocument} />
          )}
          {pdfUrl && (
            <Document
              file={pdfUrl}
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={onDocumentLoadError}
              loading={<LoadingIndicator label={t.panel.loadingDocument} />}
              className="flex flex-col items-center gap-3.5"
            >
              {Array.from({ length: numPages }, (_, index) => (
                <Page
                  key={index + 1}
                  pageNumber={index + 1}
                  width={pageWidth}
                  scale={scale}
                  className="overflow-hidden rounded-sm border border-[#d7d3ca] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.08)]"
                  loading={<div className="h-[400px]"><LoadingIndicator /></div>}
                />
              ))}
            </Document>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
