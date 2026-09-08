import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DiagnosticExportDialog from './DiagnosticExportDialog';
import { cancelDiagnosticExport, captureRendererDiagnostics, exportDiagnostics } from '@/core/diagnosticExport';
import { useChatStore } from '@/stores/chatStore';
import type { Conversation } from '@/types';

vi.mock('@/core/diagnosticExport', () => ({
  captureRendererDiagnostics: vi.fn(),
  exportDiagnostics: vi.fn(), cancelDiagnosticExport: vi.fn(async () => true), onDiagnosticExportProgress: () => () => {},
}));
let container: HTMLDivElement, root: Root;
const conversation = (id: string, title: string, updatedAt: number): Conversation => ({ id, title, updatedAt,
  sessionId: `session-${id}`, createdAt: updatedAt, messages: [], status: 'idle' });
beforeEach(() => {
  useChatStore.setState({ activeConversationId: 'one', conversations: {
    one: conversation('one', '制作太平演示文稿', Date.now()),
    two: conversation('two', '整理客户资料', Date.now() - 86_400_000),
  } });
  vi.mocked(captureRendererDiagnostics).mockImplementation((event) => {
    const state = useChatStore.getState();
    const chat = state.conversations[event?.chat_id ?? state.activeConversationId ?? ''];
    return { captured_at: new Date().toISOString(), connection_status: 'open', chat_id: chat?.id,
      session_id: chat?.sessionId, trace_id: chat ? `trace-${chat.id}` : undefined };
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });
function button(label: string) { return [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === label)!; }
function openSources() {
  act(() => document.querySelector<HTMLButtonElement>('button[aria-label="日志来源"]')!.click());
}
function selectSource(label: string) {
  act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((item) => item.textContent?.includes(label))!.click());
}

describe('diagnostic export dialog', () => {
  it('opens without collecting, overlays settings, and displays partial results accurately', async () => {
    act(() => root.render(<DiagnosticExportDialog onClose={() => {}} />));
    expect(exportDiagnostics).not.toHaveBeenCalled();
    const dialog = document.querySelector<HTMLElement>('[data-testid="diagnostic-export-dialog"]');
    expect(dialog?.parentElement?.style.zIndex).toBe('90');
    expect(dialog?.classList.contains('diagnostic-export-dialog')).toBe(true);
    expect(dialog?.querySelector('.diagnostic-export-header')).not.toBeNull();
    expect(dialog?.querySelector('.diagnostic-export-body')).not.toBeNull();
    expect(dialog?.querySelector('.diagnostic-export-footer')).not.toBeNull();
    expect(dialog?.querySelector('.diagnostic-export-fields')).not.toBeNull();
    expect(document.body.textContent).toContain('当前聊天 · 制作太平演示文稿');
    vi.mocked(exportDiagnostics).mockResolvedValue({ status: 'partial', path: '/tmp/test.zip', bytes: 1234, incident_id: 'incident-one',
      sources: { gateway: { status: 'unavailable', reason: 'GATEWAY_OFFLINE' } } });
    await act(async () => { button('导出 ZIP').click(); });
    expect(exportDiagnostics).toHaveBeenCalledWith(expect.objectContaining({ scope: 'session', window_minutes: 15,
      renderer: expect.objectContaining({ chat_id: 'one', session_id: 'session-one' }) }));
    expect(document.body.textContent).toContain('诊断包已保存');
    expect(document.body.textContent).toContain('部分信息缺失或已截断：后端诊断信息');
    expect(document.body.textContent).toContain('问题编号');
    expect(document.body.textContent).toContain('保存位置');
    expect(document.body.textContent).toContain('incident-one');
  });

  it('searches history and exports the selected conversation instead of the active chat', async () => {
    vi.mocked(exportDiagnostics).mockResolvedValue({ status: 'cancelled' });
    act(() => root.render(<DiagnosticExportDialog onClose={() => {}} />));
    const sourceTrigger = document.querySelector<HTMLButtonElement>('button[aria-label="日志来源"]')!;
    sourceTrigger.parentElement!.getBoundingClientRect = () => ({
      x: 100, y: 300, left: 100, right: 580, top: 300, bottom: 336,
      width: 480, height: 36, toJSON: () => ({}),
    });
    const originalHeight = window.innerHeight;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 });
    openSources();
    const sourcePortal = document.querySelector<HTMLElement>('[data-select-portal="true"]');
    expect(sourcePortal).not.toBeNull();
    expect(sourcePortal?.closest('[role="dialog"]')).not.toBeNull();
    expect(sourcePortal?.style.bottom).toBe('106px');
    expect(sourcePortal?.style.top).toBe('auto');
    expect(document.querySelector('.diagnostic-export-body')?.getAttribute('data-source-picker-open')).toBe('true');
    const search = document.querySelector<HTMLInputElement>('input[aria-label="搜索会话名称"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, '客户');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    selectSource('整理客户资料');
    expect(document.querySelector('[data-select-portal="true"]')).toBeNull();
    expect(document.querySelector('.diagnostic-export-body')?.hasAttribute('data-source-picker-open')).toBe(false);
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalHeight });
    await act(async () => { button('导出 ZIP').click(); });
    expect(exportDiagnostics).toHaveBeenCalledWith(expect.objectContaining({ scope: 'session',
      renderer: expect.objectContaining({ chat_id: 'two', session_id: 'session-two', trace_id: 'trace-two' }) }));
    expect(useChatStore.getState().activeConversationId).toBe('one');
    expect(JSON.stringify(vi.mocked(exportDiagnostics).mock.calls)).not.toContain('整理客户资料');
  });

  it('exports the whole application only when all runtime logs is selected', async () => {
    vi.mocked(exportDiagnostics).mockResolvedValue({ status: 'cancelled' });
    act(() => root.render(<DiagnosticExportDialog onClose={() => {}} />));
    openSources();
    selectSource('全部运行日志');
    expect(document.body.textContent).toContain('所有会话、后台任务及软件运行日志');
    await act(async () => { button('导出 ZIP').click(); });
    expect(exportDiagnostics).toHaveBeenCalledWith(expect.objectContaining({ scope: 'application' }));
  });

  it('allows selecting history when no chat is open', async () => {
    useChatStore.setState({ activeConversationId: null });
    vi.mocked(exportDiagnostics).mockResolvedValue({ status: 'cancelled' });
    act(() => root.render(<DiagnosticExportDialog onClose={() => {}} />));
    expect(document.querySelector('button[aria-label="日志来源"]')?.textContent).toContain('全部运行日志');
    openSources();
    selectSource('整理客户资料');
    await act(async () => { button('导出 ZIP').click(); });
    expect(exportDiagnostics).toHaveBeenCalledWith(expect.objectContaining({ scope: 'session',
      renderer: expect.objectContaining({ session_id: 'session-two' }) }));
  });

  it('keeps a new unsynced chat selected and exports only its local logs', async () => {
    useChatStore.setState({ conversations: { one: { ...conversation('one', '新对话', Date.now()), sessionId: undefined } } });
    vi.mocked(exportDiagnostics).mockResolvedValue({ status: 'cancelled' });
    act(() => root.render(<DiagnosticExportDialog onClose={() => {}} />));
    expect(document.body.textContent).toContain('此会话尚未同步到后端');
    await act(async () => { button('导出 ZIP').click(); });
    expect(exportDiagnostics).toHaveBeenCalledWith(expect.objectContaining({ scope: 'session',
      renderer: expect.objectContaining({ chat_id: 'one', session_id: undefined }) }));
  });

  it('does not silently change scope if the selected conversation disappears', () => {
    act(() => root.render(<DiagnosticExportDialog onClose={() => {}} />));
    act(() => useChatStore.setState({ conversations: {}, activeConversationId: null }));
    expect(button('导出 ZIP').disabled).toBe(true);
    expect(document.body.textContent).toContain('请重新选择会话');
    openSources();
    selectSource('全部运行日志');
    expect(button('导出 ZIP').disabled).toBe(false);
  });

  it('allows cancellation and does not claim a cancelled export was saved', async () => {
    let finish!: (value: { status: 'cancelled' }) => void;
    vi.mocked(exportDiagnostics).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    act(() => root.render(<DiagnosticExportDialog onClose={() => {}} />));
    await act(async () => { button('导出 ZIP').click(); });
    expect(button('导出 ZIP').disabled).toBe(true);
    await act(async () => { button('取消导出').click(); });
    expect(cancelDiagnosticExport).toHaveBeenCalledOnce();
    await act(async () => finish({ status: 'cancelled' }));
    expect(document.body.textContent).toContain('已取消导出');
    expect(document.body.textContent).not.toContain('诊断包已保存');
  });
});
