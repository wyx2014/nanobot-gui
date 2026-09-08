import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, CheckCircle2, CircleAlert, FolderOpen, Loader2, ShieldCheck } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cancelDiagnosticExport, captureRendererDiagnostics, exportDiagnostics, onDiagnosticExportProgress } from '@/core/diagnosticExport';
import type { DiagnosticExportResult, ExportStage } from '@/shared/diagnosticBundle';
import { useChatStore } from '@/stores/chatStore';
import './diagnosticExportDialog.css';

function localInputTime() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function DiagnosticExportDialog({ onClose, isEnglish = false, initialDescription = '' }: { onClose: () => void; isEnglish?: boolean; initialDescription?: string }) {
  const conversations = useChatStore((state) => state.conversations);
  const [currentChatId] = useState(() => useChatStore.getState().activeConversationId);
  const [description, setDescription] = useState(initialDescription);
  const [occurredAt, setOccurredAt] = useState(localInputTime);
  const [minutes, setMinutes] = useState('15');
  const [logSource, setLogSource] = useState(() => currentChatId && conversations[currentChatId] ? `session:${currentChatId}` : 'application');
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<ExportStage>('collecting');
  const [result, setResult] = useState<DiagnosticExportResult | null>(null);
  const [error, setError] = useState('');
  const requestId = useRef<string | null>(null);
  const sourcePickerPortal = useRef<HTMLDivElement>(null);
  const en = isEnglish;
  const selectedChatId = logSource === 'application' ? undefined : logSource.slice('session:'.length);
  const selectedChat = selectedChatId ? conversations[selectedChatId] : undefined;
  const sourceOptions = useMemo(() => {
    const dateFormat = new Intl.DateTimeFormat(en ? 'en-US' : 'zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    return [
      {
        value: 'application',
        label: en ? 'All runtime logs' : '全部运行日志',
        description: en ? 'All conversations, background tasks and app events' : '所有会话、后台任务及软件事件',
      },
      ...Object.values(conversations)
        .sort((a, b) => Number(b.id === currentChatId) - Number(a.id === currentChatId) || b.updatedAt - a.updatedAt)
        .map((chat) => ({
          value: `session:${chat.id}`,
          label: `${chat.id === currentChatId ? (en ? 'Current chat · ' : '当前聊天 · ') : ''}${chat.title || (en ? 'Untitled chat' : '未命名聊天')}`,
          description: dateFormat.format(chat.updatedAt),
        })),
    ];
  }, [conversations, currentChatId, en]);

  useEffect(() => {
    const stop = onDiagnosticExportProgress((event) => {
      if (event.export_id === requestId.current) setStage(event.stage);
    });
    return () => {
      stop();
      if (requestId.current) void cancelDiagnosticExport(requestId.current).catch(() => {});
    };
  }, []);

  async function start() {
    if (requestId.current) return;
    const occurred = new Date(occurredAt).getTime();
    if (!Number.isFinite(occurred) || occurred > Date.now()) {
      setError(en ? 'Choose a valid time in the past.' : '请选择有效的问题发生时间，不能晚于当前时间。');
      return;
    }
    const snapshot = captureRendererDiagnostics(selectedChatId
      ? { event_name: 'diagnostics.export', chat_id: selectedChatId } : undefined);
    if (selectedChatId && snapshot.chat_id !== selectedChatId) {
      setError(en ? 'This conversation is no longer available. Choose another log source.' : '所选会话已不可用，请重新选择日志来源。');
      return;
    }
    const id = `export_${crypto.randomUUID()}`;
    requestId.current = id;
    setBusy(true); setResult(null); setError(''); setStage('collecting');
    try {
      const next = await exportDiagnostics({ export_id: id, description, occurred_at: new Date(occurred).toISOString(),
        window_minutes: Number(minutes) as 15 | 60 | 1440, scope: selectedChatId ? 'session' : 'application', renderer: snapshot });
      setResult(next);
      if (next.status === 'failed') {
        const errors: Record<string, string> = {
          ENOSPC: en ? 'There is not enough disk space.' : '磁盘空间不足，请清理后重试。',
          EACCES: en ? 'Choose a folder you can write to.' : '无法写入所选文件夹，请选择其他保存位置。',
          EXPORT_ALREADY_RUNNING: en ? 'Another diagnostic export is running.' : '已有诊断包正在导出，请等待完成。',
          EXPORT_TIMEOUT: en ? 'Export timed out. Try a shorter time range.' : '导出超时，请缩小时间范围后重试。',
        };
        setError(errors[next.error_code ?? ''] ?? (en ? 'Could not export. Try another folder or a shorter time range.' : '导出失败，请更换保存位置或缩小时间范围后重试。'));
      }
    } catch { setError(en ? 'Diagnostic export is unavailable. Restart the desktop app and try again.' : '诊断导出暂不可用，请重启桌面应用后重试。'); }
    finally { requestId.current = null; setBusy(false); }
  }

  const complete = result?.status === 'ready' || result?.status === 'partial';
  const missing = Object.entries(result?.sources ?? {}).filter(([, source]) => source.status === 'unavailable' || source.status === 'truncated');
  const sourceNames: Record<string, string> = {
    desktop: en ? 'Desktop events' : '桌面事件', startup: en ? 'Startup logs' : '启动日志',
    gateway_text: en ? 'Gateway text logs' : '后端文本日志', gateway: en ? 'Gateway diagnostics' : '后端诊断信息',
    gateway_logs: en ? 'Gateway events' : '后端事件', gateway_security_events: en ? 'Security events' : '安全事件',
    gateway_traces: en ? 'Task traces' : '任务链路', gateway_agent_runs: en ? 'Agent runs' : 'Agent 执行记录',
    gateway_trace_spans: en ? 'Execution stages' : '执行阶段', runtime: en ? 'Runtime snapshot' : '运行状态',
    renderer: en ? 'Interface snapshot' : '界面状态', timeline: en ? 'Timeline' : '事件时间线',
    desktop_flush: en ? 'Desktop log completeness' : '桌面日志完整性',
    renderer_flush: en ? 'Interface log completeness' : '界面日志完整性',
    gateway_flush: en ? 'Gateway log completeness' : '后端日志完整性',
    doctor: en ? 'Environment checks' : '环境检查', evidence: en ? 'Execution summary' : '执行摘要',
  };
  const stages = en ? { collecting: 'Collecting diagnostics…', redacting: 'Cleaning sensitive data…', packaging: 'Saving ZIP…' }
    : { collecting: '正在收集诊断信息…', redacting: '正在清洗敏感信息…', packaging: '正在保存诊断包…' };

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent
      data-testid="diagnostic-export-dialog"
      layer={90}
      showCloseButton={!busy}
      className="diagnostic-export-dialog"
      onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}
      onInteractOutside={(event) => { if (busy) event.preventDefault(); }}
    >
      <DialogHeader className="diagnostic-export-header">
        <DialogTitle className="diagnostic-export-title">
          <Archive aria-hidden="true" />
          {en ? 'Export diagnostics' : '导出诊断包'}
        </DialogTitle>
        <DialogDescription className="diagnostic-export-description">
          {en ? 'Save a local ZIP for technical support to investigate this issue.' : '将问题信息保存为本地 ZIP，发给技术支持协助排查。'}
        </DialogDescription>
      </DialogHeader>

      <div className="diagnostic-export-body" data-source-picker-open={sourcePickerOpen || undefined}>
        {complete ? (
          <div className="diagnostic-export-success" role="status">
            <div className="diagnostic-export-success-banner">
              <CheckCircle2 aria-hidden="true" />
              <div>
                <strong>{en ? 'Diagnostic bundle saved' : '诊断包已保存'}</strong>
                <p>{en ? 'The ZIP is ready to send to technical support.' : 'ZIP 已保存到本地，可以发送给技术支持。'}</p>
              </div>
            </div>

            <dl className="diagnostic-export-result">
              <div><dt>{en ? 'Issue ID' : '问题编号'}</dt><dd className="font-mono">{result.incident_id}</dd></div>
              <div><dt>{en ? 'File size' : '文件大小'}</dt><dd>{((result.bytes ?? 0) / 1024 / 1024).toFixed(2)} MB</dd></div>
              <div><dt>{en ? 'Saved to' : '保存位置'}</dt><dd>{result.path}</dd></div>
            </dl>

            {missing.length > 0 && (
              <div className="diagnostic-export-feedback diagnostic-export-feedback-warning">
                <CircleAlert aria-hidden="true" />
                <span>{en ? 'Some sources are missing or incomplete: ' : '部分信息缺失或已截断：'}{missing.map(([key]) => sourceNames[key] ?? key).join('、')}{en ? '. Details are included in the bundle.' : '。具体原因已写入包内说明，现有信息仍可用于排查。'}</span>
              </div>
            )}
            <p className="diagnostic-export-help">{en ? 'Send this ZIP to technical support with the issue ID.' : '请将这个 ZIP 和问题编号一起发给技术支持。'}</p>
          </div>
        ) : (
          <div className="diagnostic-export-form">
            <div className="diagnostic-export-field">
              <label htmlFor="diagnostic-description">{en ? 'What happened?' : '问题描述'}</label>
              <Textarea
                id="diagnostic-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={4000}
                disabled={busy}
                placeholder={en ? 'What did you do, what did you expect, and what happened?' : '做了什么操作、期望什么结果、实际出现了什么问题？'}
              />
            </div>

            <fieldset disabled={busy} className="diagnostic-export-fields">
              <div className="diagnostic-export-field">
                <label htmlFor="diagnostic-time">{en ? 'Issue time' : '发生时间'}</label>
                <Input id="diagnostic-time" type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} />
              </div>
              <div className="diagnostic-export-field">
                <span>{en ? 'Time range' : '时间范围'}</span>
                <Select ariaLabel={en ? 'Time range' : '时间范围'} value={minutes} onChange={setMinutes} options={[
                  { value: '15', label: en ? 'Around 15 minutes' : '发生前后约 15 分钟' },
                  { value: '60', label: en ? 'Around 1 hour' : '发生前后约 1 小时' },
                  { value: '1440', label: en ? 'Around 24 hours' : '发生前后约 24 小时' },
                ]} />
              </div>
              <div className="diagnostic-export-field diagnostic-export-field-wide">
                <span>{en ? 'Log source' : '日志来源'}</span>
                <Select ariaLabel={en ? 'Log source' : '日志来源'} value={logSource} onChange={setLogSource}
                  options={sourceOptions} placeholder={en ? 'Choose a conversation' : '请重新选择会话'}
                  searchPlaceholder={en ? 'Search by conversation name' : '搜索会话名称'}
                  emptySearchLabel={en ? 'No matching conversations' : '没有匹配的会话'}
                  portalled portalLayer={100} portalContainer={() => sourcePickerPortal.current}
                  onOpenChange={setSourcePickerOpen} />
                <p className="diagnostic-export-help">
                  {selectedChatId
                    ? (en ? 'Only logs associated with this conversation in the selected time range. Environment checks are also included.' : '仅收集所选时间范围内属于此会话的日志，并附带软件环境检查。')
                    : (en ? 'Includes all conversations, background tasks and app logs in the selected time range.' : '收集所选时间范围内所有会话、后台任务及软件运行日志。')}
                </p>
                {selectedChat && !selectedChat.sessionId && <p className="diagnostic-export-help">
                  {en ? 'This conversation has not synced with the backend yet. Only its interface logs and local environment details are available.' : '此会话尚未同步到后端，目前只能收集它的界面日志和本地环境信息。'}
                </p>}
              </div>
            </fieldset>

            <div className="diagnostic-export-privacy">
              <ShieldCheck aria-hidden="true" />
              <span>{en ? 'Includes cleaned logs, task status and environment details. Conversation bodies and file attachments are excluded. Nothing is uploaded automatically.' : '包含清洗后的运行日志、任务状态和环境摘要，不包含对话正文与文件附件，不会自动上传。'}</span>
            </div>
            {busy && <div role="status" aria-live="polite" className="diagnostic-export-feedback"><Loader2 className="animate-spin" aria-hidden="true" />{stages[stage]}</div>}
            {result?.status === 'cancelled' && <div role="status" className="diagnostic-export-feedback">{en ? 'Export cancelled.' : '已取消导出。'}</div>}
            {error && <div role="alert" className="diagnostic-export-feedback diagnostic-export-feedback-error"><CircleAlert aria-hidden="true" />{error}</div>}
          </div>
        )}
      </div>

      <DialogFooter className="diagnostic-export-footer">
        {busy ? (
          <Button variant="outline" onClick={() => { if (requestId.current) void cancelDiagnosticExport(requestId.current).catch(() => {}); }}>{en ? 'Cancel export' : '取消导出'}</Button>
        ) : (
          <Button variant="outline" onClick={onClose}>{en ? 'Close' : '关闭'}</Button>
        )}
        {complete ? (
          <Button onClick={() => { void window.ipc.invoke('shell:reveal', result.path); }}><FolderOpen aria-hidden="true" />{en ? 'Show in folder' : '打开所在文件夹'}</Button>
        ) : (
          <Button disabled={busy || Boolean(selectedChatId && !selectedChat)} onClick={() => void start()}>{en ? 'Export ZIP' : '导出 ZIP'}</Button>
        )}
      </DialogFooter>
      <div ref={sourcePickerPortal} className="contents" />
    </DialogContent>
  </Dialog>;
}
