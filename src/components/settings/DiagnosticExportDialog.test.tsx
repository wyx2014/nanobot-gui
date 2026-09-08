import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DiagnosticExportDialog from './DiagnosticExportDialog';
import { cancelDiagnosticExport, exportDiagnostics } from '@/core/diagnosticExport';

vi.mock('@/core/diagnosticExport', () => ({
  captureRendererDiagnostics: () => ({ captured_at: new Date().toISOString(), connection_status: 'open', session_id: 'session-one' }),
  exportDiagnostics: vi.fn(), cancelDiagnosticExport: vi.fn(async () => true), onDiagnosticExportProgress: () => () => {},
}));
let container: HTMLDivElement, root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); });
function button(label: string) { return [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent === label)!; }

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
    expect(document.body.textContent).toContain('当前会话及应用公共事件');
    vi.mocked(exportDiagnostics).mockResolvedValue({ status: 'partial', path: '/tmp/test.zip', bytes: 1234, incident_id: 'incident-one',
      sources: { gateway: { status: 'unavailable', reason: 'GATEWAY_OFFLINE' } } });
    await act(async () => { button('导出 ZIP').click(); });
    expect(exportDiagnostics).toHaveBeenCalledWith(expect.objectContaining({ scope: 'session', window_minutes: 15 }));
    expect(document.body.textContent).toContain('诊断包已保存');
    expect(document.body.textContent).toContain('部分信息缺失或已截断：后端诊断信息');
    expect(document.body.textContent).toContain('问题编号');
    expect(document.body.textContent).toContain('保存位置');
    expect(document.body.textContent).toContain('incident-one');
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
