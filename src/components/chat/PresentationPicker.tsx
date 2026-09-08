import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Eye, FilePlus2, Files, Globe, LayoutTemplate, Loader2, RefreshCw, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import SubTabBar from '@/components/customize/SubTabBar';
import { usePreviewStore } from '@/stores/previewStore';
import { startDiagnostic } from '@/core/diagnostics';
import { diagnosticError } from '@/shared/diagnostics';
import {
  fetchPresentationDocuments, fetchPresentationPreviews,
  fetchPresentationTemplates, getCachedPresentationTemplates,
  type PresentationDocument, type PresentationSelection, type PresentationTemplate,
} from '@/core/presentations';
import './presentationPicker.css';

interface Props {
  chatId?: string;
  isEnglish: boolean;
  onClose: () => void;
  onSelect: (selection: PresentationSelection) => void;
}

const families = [['all', '全部', 'All'], ['taiping', '中国太平', 'China Taiping'], ['guizang', '归藏', 'Guizang'], ['kimi', 'Kimi', 'Kimi']] as const;
const missingLabels: Record<string, [string, string]> = {
  source_missing: ['未找到技能资源', 'Skill source missing'], template_missing: ['模板文件缺失', 'Template missing'],
  node: ['需要 Node.js', 'Node.js required'],
};
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

export default function PresentationPicker({ chatId, isEnglish: en, onClose, onSelect }: Props) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [templates, setTemplates] = useState<PresentationTemplate[]>(() => getCachedPresentationTemplates()?.templates ?? []);
  const [documents, setDocuments] = useState<PresentationDocument[]>([]);
  const [tab, setTab] = useState<'templates' | 'documents'>('templates');
  const [family, setFamily] = useState('all');
  const [format, setFormat] = useState('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sampleFirst, setSampleFirst] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [documentsError, setDocumentsError] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState('');
  const [detail, setDetail] = useState<{ id: string; previews: string[] } | null>(null);
  const selected = templates.find((item) => item.id === selectedId);
  const cover = selected?.previews[0];
  const opening = useRef<ReturnType<typeof startDiagnostic> | null>(null);
  useEffect(() => {
    const operation = startDiagnostic('presentation.picker_open', { chat_id: chatId,
      details: { cache_hit: Boolean(getCachedPresentationTemplates()?.templates.length) } });
    opening.current = operation;
    return () => { operation.finish('cancelled'); opening.current = null; };
  }, [chatId]);
  useEffect(() => {
    if (loading && !templates.length) return;
    const frame = requestAnimationFrame(() => opening.current?.finish(catalogError && !templates.length ? 'failed' : 'completed',
      { count: templates.length, stage: 'catalog_committed', ...(catalogError ? { error_code: 'CATALOG_LOAD_FAILED' } : {}) }));
    return () => cancelAnimationFrame(frame);
  }, [loading, templates.length, catalogError]);

  useEffect(() => {
    const operation = startDiagnostic('presentation.catalog', { chat_id: chatId });
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    setCatalogError('');
    fetchPresentationTemplates().then((catalog) => {
      if (cancelled) return;
      setTemplates(catalog.templates);
      operation.finish('completed', { count: catalog.templates.length });
      if (catalog.previews_pending) timer = setTimeout(() => setReload((value) => value + 1), 1500);
    }).catch((cause: unknown) => { if (!cancelled) { setCatalogError(errorMessage(cause)); operation.finish('failed', diagnosticError(cause)); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; clearTimeout(timer); operation.finish('cancelled'); };
  }, [reload, chatId]);

  useEffect(() => {
    if (tab !== 'documents') return;
    const operation = startDiagnostic('presentation.documents', { chat_id: chatId });
    let cancelled = false;
    setLoadingDocuments(true);
    setDocumentsError('');
    (chatId ? fetchPresentationDocuments(chatId) : Promise.resolve({ documents: [] })).then((list) => {
      if (!cancelled) { setDocuments(list.documents); setDocumentsLoaded(true); operation.finish('completed', { count: list.documents.length }); }
    }).catch((cause: unknown) => { if (!cancelled) { setDocumentsError(errorMessage(cause)); operation.finish('failed', diagnosticError(cause)); } })
      .finally(() => { if (!cancelled) setLoadingDocuments(false); });
    return () => { cancelled = true; operation.finish('cancelled'); };
  }, [chatId, tab, reload]);

  useEffect(() => {
    if (!selectedId) return;
    const operation = startDiagnostic('presentation.previews', { chat_id: chatId, details: { template_id: selectedId } });
    let cancelled = false;
    setPreviewError('');
    setDetail(null);
    fetchPresentationPreviews(selectedId).then((result) => {
      if (!cancelled) { setDetail({ id: selectedId, previews: result.previews }); operation.finish('completed', { count: result.previews.length }); }
    }).catch((cause: unknown) => { if (!cancelled) { setPreviewError(errorMessage(cause)); operation.finish('failed', diagnosticError(cause)); } });
    return () => { cancelled = true; operation.finish('cancelled'); };
  }, [selectedId, cover, reload, chatId]);

  const choose = (template: PresentationTemplate) => {
    try { localStorage.setItem('nanobot.presentation.lastTemplate', template.id); } catch { /* optional preference */ }
    onSelect({ template_id: template.id, document_id: crypto.randomUUID(), name: en ? template.name_en : template.name, sample_first: sampleFirst });
    onClose();
  };
  let last = 'taiping-standard';
  try { last = localStorage.getItem('nanobot.presentation.lastTemplate') || last; } catch { /* optional preference */ }
  const filtered = templates.filter((item) => (family === 'all' || item.family === family)
    && (format === 'all' || item.format === format)
    && `${item.name} ${item.name_en}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(b.id === last) - Number(a.id === last));
  const previews = selected ? (detail?.id === selected.id ? detail.previews : selected.previews) : [];
  const error = tab === 'documents' ? documentsError : catalogError || (selected ? previewError : '');
  const missing = (template: PresentationTemplate) => template.missing.map((key) => missingLabels[key]?.[en ? 1 : 0] || key).join(' · ');

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="presentation-picker" onOpenAutoFocus={(event) => { event.preventDefault(); titleRef.current?.focus(); }}>
      <header className="presentation-heading">
        <DialogTitle ref={titleRef} tabIndex={-1}>{en ? 'Presentations' : '演示文稿'}</DialogTitle>
        <DialogDescription className="sr-only">{en ? 'Presentation templates and documents' : '演示文稿模板与文稿'}</DialogDescription>
      </header>
      <div className="presentation-tabs">
        <SubTabBar ariaLabel={en ? 'Presentation view' : '演示文稿视图'} activeTab={tab} onChange={(id) => { setTab(id as typeof tab); setSelectedId(null); }} tabs={[
          { id: 'templates', icon: LayoutTemplate, label: en ? 'Templates' : '模板库' },
          { id: 'documents', icon: Files, label: en ? 'Documents' : '本会话文稿', count: documentsLoaded ? documents.length : undefined },
        ]} />
        <Button variant="ghost" size="icon-sm" title={en ? 'Refresh' : '刷新'} disabled={loading || loadingDocuments} onClick={() => setReload((value) => value + 1)}>
          {loading || loadingDocuments ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </Button>
      </div>
      {error && <div role="alert" className="presentation-error"><span>{error}</span><Button variant="ghost" size="icon-sm" title={en ? 'Retry' : '重试'} onClick={() => setReload((value) => value + 1)}><RefreshCw /></Button></div>}
      {selected ? <>
        <div className="presentation-detail-heading"><Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}><ArrowLeft />{en ? 'Templates' : '返回模板库'}</Button><span>{en ? selected.name_en : selected.name} · {selected.format.toUpperCase()}</span></div>
        <div className="presentation-scroll presentation-detail">
          {previews.map((src, index) => <img key={src} src={src} alt={`${selected.name} ${index + 1}`} loading="lazy" decoding="async" width={720} height={405} />)}
          {!previews.length && <div className="presentation-empty"><LayoutTemplate /><span>{detail?.id === selected.id || previewError ? (en ? 'Preview unavailable' : '暂无预览') : (en ? 'Loading preview' : '正在读取预览')}</span></div>}
        </div>
        {!selected.available && <div className="presentation-error" role="status">{missing(selected)}</div>}
        <footer className="presentation-footer"><label><input type="checkbox" checked={sampleFirst} onChange={(event) => setSampleFirst(event.target.checked)} />{en ? 'Start with 3 sample pages' : '先生成 3 页样稿'}</label><Button disabled={!selected.available} onClick={() => choose(selected)}><Check />{en ? 'Use template' : '使用此模板'}</Button></footer>
      </> : tab === 'templates' ? <>
        <div className="presentation-filters">
          <div className="presentation-families" role="group" aria-label={en ? 'Template family' : '模板系列'}>{families.map(([id, zh, english]) => <button type="button" key={id} aria-pressed={family === id} onClick={() => setFamily(id)}>{en ? english : zh}</button>)}</div>
          <div className="presentation-search"><Search className="size-4" /><Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label={en ? 'Search templates' : '搜索模板'} placeholder={en ? 'Search templates' : '搜索模板'} /></div>
          <Select className="presentation-format" variant="inline" ariaLabel={en ? 'Output format' : '交付格式'} value={format} onChange={setFormat} options={[{value: 'all', label: en ? 'All formats' : '全部格式'}, {value: 'pptx', label: en ? 'Editable PPTX' : '可编辑 PPTX'}, {value: 'html', label: en ? 'Web presentation' : '网页演示'}]} />
        </div>
        <div className="presentation-scroll" aria-busy={loading && !templates.length}>
          {loading && !templates.length ? <>
            <span className="sr-only" role="status">{en ? 'Loading templates' : '正在读取模板'}</span>
            <div className="presentation-grid" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <div className="presentation-skeleton" key={index}><div className="presentation-cover" /><span /><span /></div>)}</div>
          </> : <div className="presentation-grid">{filtered.map((item) => <button type="button" className="presentation-template" key={item.id} onClick={() => setSelectedId(item.id)} aria-label={en ? item.name_en : item.name}>
            <div className="presentation-cover">{item.previews[0] ? <img src={item.previews[0]} alt="" loading="lazy" decoding="async" width={720} height={405} /> : <LayoutTemplate className="size-8" />}</div>
            <div className="presentation-template-meta"><strong>{en ? item.name_en : item.name}</strong><span>{item.format.toUpperCase()}</span></div>
            <div className="presentation-template-state" data-unavailable={!item.available || undefined}>{item.requires_network && <Globe className="size-3" />}<span>{!item.available ? missing(item) : item.requires_network ? (en ? 'Online export' : '联网导出') : item.family === 'taiping' ? (en ? 'Company template' : '公司标准模板') : item.family === 'kimi' ? (en ? 'Local · Editable PPTX' : '本地生成 · 可编辑 PPTX') : (en ? 'Web presentation' : '网页演示')}</span></div>
          </button>)}</div>}
          {!loading && !filtered.length && !catalogError && <div className="presentation-empty"><Search />{en ? 'No matching templates' : '没有匹配的模板'}</div>}
        </div>
        <footer className="presentation-footer"><span>{en ? `${filtered.length} templates` : `${filtered.length} 套模板`}</span></footer>
      </> : <>
        <div className="presentation-document-options"><label>{en ? 'Page to revise' : '修改页码'}<Input type="number" min={1} max={100} value={page} onChange={(event) => setPage(event.target.value)} placeholder={en ? 'All' : '整份文稿'} /></label></div>
        <div className="presentation-scroll presentation-documents" aria-busy={loadingDocuments}>
          {loadingDocuments && !documents.length ? <div className="presentation-empty" role="status"><Loader2 className="animate-spin" />{en ? 'Loading documents' : '正在读取文稿'}</div> : documents.map((document) => <div className="presentation-document" key={document.document_id}>
            <div><strong>{document.title}</strong><p>{document.name} · {document.format.toUpperCase()} · {document.page_count ? `${document.page_count} ${en ? 'pages' : '页'}` : en ? 'Draft' : '草稿'}</p></div>
            {document.artifacts.some((file) => /\.(pdf|html)$/i.test(file.path)) && <Button variant="ghost" size="icon-sm" title={en ? 'Preview' : '预览文稿'} onClick={() => {
              const artifact = document.artifacts.find((file) => /\.(pdf|html)$/i.test(file.path));
              if (artifact) { usePreviewStore.getState().openPreview(artifact.path); onClose(); }
            }}><Eye /></Button>}
            <Button variant="outline" size="sm" disabled={!!page && (!Number.isInteger(Number(page)) || Number(page) < 1 || Number(page) > (document.page_count || 100))} onClick={() => {
              onSelect({ template_id: document.template_id, document_id: document.document_id, name: document.name, sample_first: false, ...(page ? { page: Number(page) } : {}) }); onClose();
            }}><ArrowRight />{en ? 'Continue editing' : '继续修改'}</Button>
          </div>)}
          {!loadingDocuments && !documents.length && !documentsError && <div className="presentation-empty"><FilePlus2 />{en ? 'No presentations yet' : '当前会话还没有文稿'}</div>}
        </div>
        <footer className="presentation-footer"><span>{en ? `${documents.length} documents` : `${documents.length} 份文稿`}</span><Button variant="outline" size="sm" onClick={() => setTab('templates')}><FilePlus2 />{en ? 'New presentation' : '新建演示文稿'}</Button></footer>
      </>}
    </DialogContent>
  </Dialog>;
}
