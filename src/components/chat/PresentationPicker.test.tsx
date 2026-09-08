import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PresentationPicker from './PresentationPicker';

const mocks = vi.hoisted(() => ({ templates: vi.fn(), documents: vi.fn(), previews: vi.fn(), cached: vi.fn() }));
vi.mock('@/core/presentations', () => ({
  fetchPresentationTemplates: mocks.templates,
  fetchPresentationDocuments: mocks.documents,
  fetchPresentationPreviews: mocks.previews,
  getCachedPresentationTemplates: mocks.cached,
}));

const templates = [
  { id: 'taiping-standard', name: '中国太平标准', name_en: 'China Taiping', family: 'taiping', format: 'pptx', available: true, previews: [], missing: [] },
  { id: 'guizang-swiss', name: '瑞士极简', name_en: 'Swiss', family: 'guizang', format: 'html', available: true, previews: [], missing: [] },
  { id: 'kimi-work', name: '蓝焰品牌', name_en: 'Blue Flame', family: 'kimi', format: 'pptx', available: true, requires_network: false, previews: [], missing: [] },
  { id: 'kimi-finance', name: '湖蓝备忘录', name_en: 'Lake Blue', family: 'kimi', format: 'pptx', available: false, requires_network: false, previews: [], missing: ['template_missing'] },
];
let root: Root | undefined;
let container: HTMLDivElement | undefined;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mocks.cached.mockReturnValue(undefined);
  mocks.previews.mockResolvedValue({ previews: [] });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  localStorage.clear();
  vi.clearAllMocks();
});

async function render(documents: unknown[] = [], catalog: Promise<unknown> = Promise.resolve({ templates })) {
  mocks.templates.mockReturnValue(catalog);
  mocks.documents.mockResolvedValue({ documents });
  const onSelect = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<PresentationPicker chatId="chat-a" isEnglish={false} onClose={() => {}} onSelect={onSelect} />));
  return onSelect;
}

async function click(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.trim() === text);
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}

describe('PresentationPicker', () => {
  it('filters template families and binds a new document with sample-first', async () => {
    const onSelect = await render();
    expect(document.body.textContent).not.toContain('归藏技能目录');
    await click('归藏');
    expect(document.querySelectorAll('.presentation-template')).toHaveLength(1);
    await act(async () => document.querySelector<HTMLButtonElement>('.presentation-template')!.click());
    await click('使用此模板');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ template_id: 'guizang-swiss', sample_first: true }));
    expect(onSelect.mock.calls[0][0].document_id).toMatch(/^[a-f0-9-]{36}$/);
  });

  it('shows the missing dependency and prevents selecting an unavailable exporter', async () => {
    const onSelect = await render();
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="湖蓝备忘录"]')!.click());
    const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('使用此模板'))!;
    expect(button.disabled).toBe(true);
    expect(document.querySelector('[role="status"]')?.textContent).toContain('模板文件缺失');
    await act(async () => button.click());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('selects a built-in Kimi template for local editable export', async () => {
    const onSelect = await render();
    expect(document.querySelector('[aria-label="蓝焰品牌"]')?.textContent).toContain('本地生成 · 可编辑 PPTX');
    expect(document.body.textContent).not.toContain('Kimi 技能目录');
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="蓝焰品牌"]')!.click());
    await click('使用此模板');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ template_id: 'kimi-work', sample_first: true }));
  });

  it('reopens the same document and validates a page revision against its page count', async () => {
    const onSelect = await render([{ document_id: 'document-001', template_id: 'taiping-standard', name: '中国太平标准', title: '年度报告', format: 'pptx', page_count: 3, artifacts: [] }]);
    await click('本会话文稿');
    const input = document.querySelector<HTMLInputElement>('input[type="number"]')!;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { set.call(input, '4'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    let button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('继续修改'))!;
    expect(button.disabled).toBe(true);
    await act(async () => { set.call(input, '2'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes('继续修改'))!;
    await act(async () => button.click());
    expect(onSelect).toHaveBeenCalledWith({ document_id: 'document-001', template_id: 'taiping-standard', name: '中国太平标准', page: 2, sample_first: false });
  });

  it('loads documents only when their view is selected', async () => {
    await render();
    expect(document.querySelectorAll('.presentation-template')).toHaveLength(4);
    expect(mocks.documents).not.toHaveBeenCalled();
    await click('本会话文稿');
    expect(mocks.documents).toHaveBeenCalledWith('chat-a');
  });

  it('keeps cached templates usable while catalog and preview requests are pending', async () => {
    mocks.cached.mockReturnValue({ templates });
    mocks.previews.mockReturnValue(new Promise(() => {}));
    const onSelect = await render([], new Promise(() => {}));
    expect(document.querySelectorAll('.presentation-template')).toHaveLength(4);
    expect(document.querySelector('.presentation-skeleton')).toBeNull();
    expect(mocks.previews).not.toHaveBeenCalled();
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="蓝焰品牌"]')!.click());
    expect(mocks.previews).toHaveBeenCalledWith('kimi-work');
    await click('使用此模板');
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ template_id: 'kimi-work' }));
  });

  it('shows a stable skeleton until the first catalog arrives', async () => {
    await render([], new Promise(() => {}));
    expect(document.querySelectorAll('.presentation-skeleton')).toHaveLength(6);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(mocks.documents).not.toHaveBeenCalled();
  });
});
