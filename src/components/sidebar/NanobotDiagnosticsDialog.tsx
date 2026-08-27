import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ClipboardCopy,
  FolderOpen,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import WindowModalBackdrop from '@/components/common/WindowModalBackdrop';
import {
  getNanobotDiagnostics,
  type NanobotDiagnosticsSnapshot,
} from '@/core/nanobotClient';
import { clipboardBridge, shellBridge } from '@/lib/ipc-factory';
import { cn } from '@/lib/utils';

interface NanobotDiagnosticsDialogProps {
  open: boolean;
  onClose: () => void;
  isEnglish: boolean;
}

const POLL_INTERVAL_MS = 1_000;

export default function NanobotDiagnosticsDialog({
  open,
  onClose,
  isEnglish,
}: NanobotDiagnosticsDialogProps) {
  const [snapshot, setSnapshot] = useState<NanobotDiagnosticsSnapshot | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);
  const requestRunningRef = useRef(false);
  const followTailRef = useRef(true);
  const outputRef = useRef<HTMLPreElement>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const refresh = useCallback(async () => {
    if (requestRunningRef.current) return;
    requestRunningRef.current = true;
    setRefreshing(true);
    try {
      const next = await getNanobotDiagnostics();
      if (!next?.text) throw new Error('Diagnostic IPC returned no data');
      setSnapshot(next);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      requestRunningRef.current = false;
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    followTailRef.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  useEffect(() => () => clearTimeout(copiedTimerRef.current), []);

  useLayoutEffect(() => {
    if (!open || !followTailRef.current || !outputRef.current) return;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [open, snapshot?.text]);

  const copyDiagnostics = async () => {
    if (!snapshot?.text) return;
    await clipboardBridge.writeText(snapshot.text);
    clearTimeout(copiedTimerRef.current);
    setCopied(true);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 1800);
  };

  if (!open) return null;

  const labels = isEnglish
    ? {
        title: 'TPCowork startup diagnostics',
        description: 'Recording starts with the app. Opening this panel does not change or restart the service.',
        refresh: 'Refresh',
        copy: 'Copy diagnostics',
        copied: 'Copied',
        reveal: 'Show log file',
        close: 'Close',
        loading: 'Reading startup diagnostics…',
        warning: 'Common credentials are redacted. The copied output may still contain local file paths.',
        readFailed: 'Could not read diagnostics',
      }
    : {
        title: 'TPCowork 启动诊断日志',
        description: '日志从应用启动时就持续记录；打开此面板不会改变或重启服务。',
        refresh: '刷新',
        copy: '复制诊断日志',
        copied: '已复制',
        reveal: '显示日志文件',
        close: '关闭',
        loading: '正在读取启动诊断…',
        warning: '常见密钥已脱敏；复制内容仍可能包含本机文件路径。',
        readFailed: '无法读取诊断日志',
      };
  const statusLabels: Record<NanobotDiagnosticsSnapshot['status'], string> = isEnglish
    ? { ready: 'Ready', starting: 'Starting', running: 'Running', error: 'Error', stopped: 'Stopped' }
    : { ready: '已就绪', starting: '启动中', running: '运行中', error: '异常', stopped: '未运行' };
  const status = snapshot?.status ?? 'starting';

  return createPortal(
    <div className="window-modal-viewport fixed inset-0 z-[10000] flex items-center justify-center px-5 py-8">
      <WindowModalBackdrop
        position="fixed"
        interactive
        className="dark:bg-black/55"
        onClick={onClose}
      />
      <section
        data-testid="nanobot-diagnostics-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nanobot-diagnostics-title"
        className="relative flex h-[min(760px,88vh)] w-[min(920px,92vw)] flex-col overflow-hidden rounded-[20px] border border-[#dedad2] bg-[#fbfaf7] shadow-lg dark:border-[#414141] dark:bg-[#242424]"
      >
        <header className="flex shrink-0 items-start justify-between gap-5 border-b border-[#e6e2da] px-6 py-5 dark:border-white/10">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 id="nanobot-diagnostics-title" className="text-[18px] font-semibold text-[#29261b] dark:text-[#f0ece5]">
                {labels.title}
              </h2>
              <span
                data-diagnostics-status={status}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                  status === 'ready' && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
                  (status === 'starting' || status === 'running') && 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
                  status === 'error' && 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300',
                  status === 'stopped' && 'bg-neutral-200 text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300',
                )}
              >
                {statusLabels[status]}
              </span>
            </div>
            <p className="mt-1.5 text-[13px] leading-5 text-[#77736a] dark:text-[#aaa69e]">
              {labels.description}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#77736a] transition-colors hover:bg-[#ebe8e1] hover:text-[#29261b] dark:text-[#b8b4ac] dark:hover:bg-[#393939] dark:hover:text-white"
            aria-label={labels.close}
            title={labels.close}
          >
            <X className="h-4.5 w-4.5" />
          </button>
        </header>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#e6e2da] px-6 py-3 dark:border-white/10">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dedad2] bg-white px-3 text-[12px] font-medium text-[#4b4943] transition-colors hover:bg-[#f3f1eb] disabled:opacity-60 dark:border-[#494949] dark:bg-[#2d2d2d] dark:text-[#ddd9d1] dark:hover:bg-[#383838]"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            {labels.refresh}
          </button>
          <button
            type="button"
            onClick={() => void copyDiagnostics()}
            disabled={!snapshot?.text}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#29261b] px-3 text-[12px] font-medium text-white transition-colors hover:bg-[#403c2d] disabled:opacity-45 dark:bg-[#ece8e1] dark:text-[#29261b] dark:hover:bg-white"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
            {copied ? labels.copied : labels.copy}
          </button>
          <button
            type="button"
            onClick={() => snapshot?.logPath && void shellBridge.revealItemInDir(snapshot.logPath)}
            disabled={!snapshot?.logExists}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium text-[#656158] transition-colors hover:bg-[#ebe8e1] disabled:cursor-not-allowed disabled:opacity-40 dark:text-[#c5c1b9] dark:hover:bg-[#383838]"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {labels.reveal}
          </button>
          {snapshot && (
            <span className="ml-auto truncate font-mono text-[11px] text-[#969188] dark:text-[#85817a]">
              {snapshot.platform} · PID {snapshot.pid ?? '—'} · :{snapshot.port}
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 bg-[#171817] p-3">
          {error && !snapshot ? (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div>
                <p className="text-sm font-medium text-red-300">{labels.readFailed}</p>
                <p className="mt-2 max-w-lg break-words font-mono text-xs text-red-200/70">{error}</p>
              </div>
            </div>
          ) : snapshot ? (
            <pre
              ref={outputRef}
              data-testid="nanobot-diagnostics-output"
              onScroll={(event) => {
                const element = event.currentTarget;
                followTailRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
              }}
              className="h-full overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-[#101110] p-4 font-mono text-[11.5px] leading-[1.55] text-[#d8dbd4] selection:bg-[#d97757]/45"
            >
              {snapshot.text}
            </pre>
          ) : (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-[#aaa]">
              <Loader2 className="h-4 w-4 animate-spin" />
              {labels.loading}
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-[#e6e2da] px-6 py-3 text-[11.5px] text-[#8a867c] dark:border-white/10 dark:text-[#99958d]">
          {labels.warning}
          {error && snapshot && <span className="ml-2 text-red-500">· {error}</span>}
        </footer>
      </section>
    </div>,
    document.body,
  );
}
