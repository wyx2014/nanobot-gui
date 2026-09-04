import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleSlash2,
  Clock3,
  Download,
  FileKey2,
  FileSearch,
  FolderCheck,
  FolderLock,
  Globe2,
  Info,
  Loader2,
  Network,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  SquareTerminal,
  Trash2,
  X,
} from 'lucide-react';

import ConfirmDialog from '@/components/common/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import {
  clearSecurityAudit,
  exportSecurityAudit,
  fetchSecurityAudit,
  fetchSecurityPolicy,
  updateSecurityPolicy,
  type SecurityAuditQuery,
} from '@/core/api';
import type { SecurityAuditEvent, SecurityPolicyPath, SecurityPolicyPayload, SecurityPolicyUpdate } from '@/core/types';
import { dialogBridge, fsBridge } from '@/lib/ipc-factory';
import { cn } from '@/lib/utils';
import { useToastStore } from '@/stores/toastStore';

type SecurityView = 'overview' | 'files' | 'commands' | 'network' | 'audit';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function categoryLabel(category: string, isEnglish: boolean): string {
  const labels: Record<string, [string, string]> = {
    file: ['文件安全', 'File security'],
    command: ['命令安全', 'Command security'],
    network: ['网络安全', 'Network security'],
    settings: ['安全设置', 'Security settings'],
  };
  const label = labels[category];
  return label ? label[isEnglish ? 1 : 0] : category;
}

function formatTime(timestamp: number, isEnglish: boolean): string {
  if (!Number.isFinite(timestamp)) return '-';
  return new Intl.DateTimeFormat(isEnglish ? 'en' : 'zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}

function auditActionLabel(event: SecurityAuditEvent, isEnglish: boolean): string {
  if (event.category === 'command') {
    const actions: Record<string, [string, string]> = {
      execute: ['执行命令', 'Execute command'],
      execute_cli: ['运行 CLI 应用', 'Run CLI app'],
      write_stdin: ['向命令会话发送输入', 'Send input to command session'],
    };
    const value = actions[event.action];
    return value ? value[isEnglish ? 1 : 0] : (isEnglish ? 'Command operation' : '命令操作');
  } else if (event.category === 'network') {
    return event.action === 'search'
      ? (isEnglish ? 'Web search' : '联网搜索')
      : (isEnglish ? 'Network access' : '访问网络');
  }
  if (event.category === 'file') {
    const actions: Record<string, [string, string]> = {
      read: ['读取文件', 'Read file'],
      write: ['写入文件', 'Write file'],
      edit: ['编辑文件', 'Edit file'],
      patch: ['编辑文件', 'Edit file'],
      create: ['创建文件', 'Create file'],
      delete: ['删除文件', 'Delete file'],
    };
    const value = actions[event.action];
    return value ? value[isEnglish ? 1 : 0] : (isEnglish ? 'File operation' : '文件操作');
  }
  if (event.category === 'settings') {
    if (event.action === 'clear_audit') return isEnglish ? 'Clear audit records' : '清空审计记录';
    return isEnglish ? 'Update security policy' : '更新安全策略';
  }
  return event.action || (isEnglish ? 'Security event' : '安全事件');
}

function auditResultMeta(result: string, isEnglish: boolean): { label: string; className: string } {
  const values: Record<string, { labels: [string, string]; className: string }> = {
    succeeded: {
      labels: ['已完成', 'Succeeded'],
      className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    },
    approved: {
      labels: ['已批准', 'Approved'],
      className: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
    },
    denied: {
      labels: ['已拒绝', 'Denied'],
      className: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
    },
    blocked: {
      labels: ['已阻止', 'Blocked'],
      className: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
    },
    blocked_unattended: {
      labels: ['无人值守阻止', 'Blocked unattended'],
      className: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
    },
    failed: {
      labels: ['失败', 'Failed'],
      className: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    },
    cancelled: {
      labels: ['已取消', 'Cancelled'],
      className: 'bg-[#efede8] text-[#716b62] dark:bg-[#393630] dark:text-[#bbb5ab]',
    },
    pending: {
      labels: ['处理中', 'Pending'],
      className: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
    },
    waiting_for_input: {
      labels: ['等待输入', 'Waiting for input'],
      className: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
    },
  };
  const value = values[result];
  return value
    ? { label: value.labels[isEnglish ? 1 : 0], className: value.className }
    : { label: result || (isEnglish ? 'Unknown' : '未知'), className: 'bg-[#efede8] text-[#716b62] dark:bg-[#393630] dark:text-[#bbb5ab]' };
}

function isExceptionalAuditResult(result: string): boolean {
  return ['blocked', 'blocked_unattended', 'denied', 'failed'].includes(result);
}

function auditRiskLabel(risk: string, isEnglish: boolean): string | null {
  if (risk === 'critical') return isEnglish ? 'Critical risk' : '严重风险';
  if (risk === 'high') return isEnglish ? 'High risk' : '高风险';
  return null;
}

function ProtectionRow({
  icon: Icon,
  title,
  description,
  status,
  onClick,
}: {
  icon: typeof ShieldCheck;
  title: string;
  description: string;
  status: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#eceae6] text-[#565149] dark:bg-[#33312e] dark:text-[#d1cbc1]">
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[#282620] dark:text-[#eee9df]">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-[#7b766d] dark:text-[#9f998f]">{description}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {status}
      </span>
      {onClick ? <ChevronRight className="h-4 w-4 shrink-0 text-[#aaa49a]" /> : null}
    </>
  );
  const classes = 'flex w-full items-center gap-3 border-b border-[#ebe8e2] px-4 py-3 text-left last:border-b-0 dark:border-[#3a3834]';
  return onClick ? (
    <button type="button" onClick={onClick} className={`${classes} transition-colors hover:bg-[#f7f6f3] dark:hover:bg-[#2c2a27]`}>
      {content}
    </button>
  ) : <div className={classes}>{content}</div>;
}

function SecurityOverview({ isEnglish, onOpen }: {
  isEnglish: boolean;
  onOpen: (view: SecurityView) => void;
}) {
  return (
    <div data-security-overview className="mx-auto w-full max-w-4xl space-y-5 py-1">
      <section className="flex items-start gap-4 rounded-lg border border-[#dedbd4] bg-[#f8f7f4] px-5 py-4 dark:border-[#44413c] dark:bg-[#252320]">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-[#e3eee7] text-[#397052] dark:bg-[#263b30] dark:text-[#8bc7a4]">
          <ShieldCheck className="h-6 w-6" strokeWidth={1.7} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold text-[#25231e] dark:text-[#f0ebe2]">
            {isEnglish ? 'Application protection is active' : '应用安全防护已开启'}
          </h3>
          <p className="mt-1 text-xs leading-5 text-[#736e65] dark:text-[#aaa49a]">
            {isEnglish
              ? 'Normal cross-folder work runs without repeated prompts. Catastrophic actions are blocked and high-risk actions require confirmation.'
              : '普通跨目录工作不会反复申请权限；灾难性操作会被直接阻止，高风险操作会在聊天中请求确认。'}
          </p>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-[#e3e0d9] bg-white dark:border-[#3d3a36] dark:bg-[#272522]">
        <ProtectionRow
          icon={FileKey2}
          title={isEnglish ? 'File protection' : '文件安全'}
          description={isEnglish ? 'Manage automatic allow and mandatory approval folders' : '管理自动放行白名单与强制审批目录'}
          status={isEnglish ? 'Always on' : '始终开启'}
          onClick={() => onOpen('files')}
        />
        <ProtectionRow
          icon={SquareTerminal}
          title={isEnglish ? 'Command protection' : '命令安全'}
          description={isEnglish ? 'Blocks catastrophic commands and confirms destructive operations' : '硬拦截灾难性命令，确认删除、提权等高风险操作'}
          status={isEnglish ? 'Always on' : '始终开启'}
          onClick={() => onOpen('commands')}
        />
        <ProtectionRow
          icon={Network}
          title={isEnglish ? 'Network protection' : '网络安全'}
          description={isEnglish ? 'Protects private services and internal network boundaries' : '保护本机服务、私网地址和内部网络边界'}
          status={isEnglish ? 'Always on' : '始终开启'}
          onClick={() => onOpen('network')}
        />
        <ProtectionRow
          icon={FileSearch}
          title={isEnglish ? 'Audit center' : '审计中心'}
          description={isEnglish ? 'Trace file access, command execution, and network requests' : '追溯文件访问、命令执行与网络请求'}
          status={isEnglish ? 'Always on' : '始终开启'}
          onClick={() => onOpen('audit')}
        />
      </section>
    </div>
  );
}

function PathList({ paths, empty, defaultLabel, removeLabel, onRemove }: {
  paths: SecurityPolicyPath[];
  empty: string;
  defaultLabel: string;
  removeLabel: string;
  onRemove: (path: string) => void;
}) {
  if (!paths.length) return <div className="px-4 py-6 text-center text-xs text-[#938d83] dark:text-[#8f8a81]">{empty}</div>;
  return (
    <div>
      {paths.map((item) => (
        <div key={`${item.source}:${item.path}`} className="flex items-center gap-3 border-b border-[#ebe8e2] px-4 py-3 last:border-b-0 dark:border-[#3a3834]">
          <FolderCheck className="h-4 w-4 shrink-0 text-[#716b62] dark:text-[#aaa49a]" />
          <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[#39362f] dark:text-[#ddd7ce]" title={item.path}>{item.path}</span>
          {item.source === 'default' ? (
            <span className="shrink-0 rounded bg-[#efede8] px-1.5 py-0.5 text-[10px] text-[#777167] dark:bg-[#37342f] dark:text-[#aaa49a]">{defaultLabel}</span>
          ) : (
            <button type="button" onClick={() => onRemove(item.path)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[#8b857b] hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30" aria-label={removeLabel}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function FileSecurityView({ policy, busy, isEnglish, onBack, onAdd, onRemove, onReset }: {
  policy: SecurityPolicyPayload;
  busy: boolean;
  isEnglish: boolean;
  onBack: () => void;
  onAdd: (kind: 'allow' | 'approval') => void;
  onRemove: (kind: 'allow' | 'approval', path: string) => void;
  onReset: () => void;
}) {
  return (
    <div data-file-security className="mx-auto w-full max-w-4xl space-y-5 py-1">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-[#625e56] hover:text-[#222] dark:text-[#bbb5ab] dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" />{isEnglish ? 'Security overview' : '安全防护概览'}
      </button>
      <PathSection
        title={isEnglish ? 'Automatic allowlist' : '自动放行白名单'}
        description={isEnglish ? 'Matching path operations are treated as low risk and proceed automatically.' : '命中路径会按低风险处理并自动放行。'}
        addLabel={isEnglish ? 'Add folder' : '添加目录'}
        empty={isEnglish ? 'No automatically allowed folders' : '暂无自动放行目录'}
        paths={policy.file_allow_paths}
        busy={busy}
        defaultLabel={isEnglish ? 'Default' : '默认'}
        removeLabel={isEnglish ? 'Remove allowed folder' : '删除自动放行目录'}
        onAdd={() => onAdd('allow')}
        onRemove={(path) => onRemove('allow', path)}
      />
      <PathSection
        title={isEnglish ? 'Always ask for approval' : '强制审批目录'}
        description={isEnglish ? 'Writing, editing, or deleting under these folders always pauses for chat approval.' : '命中目录的写入、编辑或删除操作会按高风险处理，并在聊天中强制请求确认。'}
        addLabel={isEnglish ? 'Add folder' : '添加目录'}
        empty={isEnglish ? 'No folders require approval yet' : '暂无强制审批目录'}
        paths={policy.approval_paths}
        busy={busy}
        defaultLabel={isEnglish ? 'System protected' : '系统保护'}
        removeLabel={isEnglish ? 'Remove folder' : '删除目录'}
        onAdd={() => onAdd('approval')}
        onRemove={(path) => onRemove('approval', path)}
      />
      <div className="flex items-center justify-between border-t border-[#ebe8e2] px-1 pt-4 dark:border-[#3a3834]">
        <p className="text-xs leading-5 text-[#827c72] dark:text-[#99938a]">{isEnglish ? 'Automatic allow cannot cover the home root, system folders, core protection, or approval folders.' : '自动放行不能覆盖整个用户目录、系统目录、核心保护项或强制审批目录。'}</p>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onReset} className="text-[#756f65] hover:bg-[#f2f0eb] dark:text-[#aaa49a]">
          <RefreshCw />{isEnglish ? 'Restore defaults' : '恢复系统默认'}
        </Button>
      </div>
    </div>
  );
}

function PathSection({ title, description, addLabel, empty, paths, busy, defaultLabel, removeLabel, onAdd, onRemove }: {
  title: string;
  description: string;
  addLabel: string;
  empty: string;
  paths: SecurityPolicyPath[];
  busy: boolean;
  defaultLabel: string;
  removeLabel: string;
  onAdd: () => void;
  onRemove: (path: string) => void;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-end justify-between gap-4 px-1">
        <div>
          <h3 className="text-sm font-semibold text-[#2d2a24] dark:text-[#eee9df]">{title}</h3>
          <p className="mt-1 text-xs text-[#7d776d] dark:text-[#9c968c]">{description}</p>
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={onAdd} className="border-[#dedbd4] bg-white text-[#4f4b43] hover:bg-[#f5f3ee] dark:border-[#494640] dark:bg-[#2b2a27] dark:text-[#ddd8cf]">
          <Plus />{addLabel}
        </Button>
      </div>
      <div className="overflow-hidden rounded-lg border border-[#e3e0d9] bg-white dark:border-[#3d3a36] dark:bg-[#272522]">
        <PathList paths={paths} empty={empty} defaultLabel={defaultLabel} removeLabel={removeLabel} onRemove={onRemove} />
      </div>
    </section>
  );
}

function RuleListEditor({
  icon: Icon,
  title,
  description,
  placeholder,
  items,
  busy,
  addLabel,
  emptyLabel,
  removeLabel,
  onAdd,
  onRemove,
}: {
  icon: typeof ShieldCheck;
  title: string;
  description: string;
  placeholder: string;
  items: string[];
  busy: boolean;
  addLabel: string;
  emptyLabel: string;
  removeLabel: string;
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  const submit = () => {
    const normalized = value.trim();
    if (!normalized || busy || items.includes(normalized)) return;
    onAdd(normalized);
    setValue('');
  };
  return (
    <section className="overflow-hidden rounded-lg border border-[#e3e0d9] bg-white dark:border-[#3d3a36] dark:bg-[#272522]">
      <div className="flex items-start gap-3 px-4 py-4">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#e8f4ee] text-emerald-700 dark:bg-[#243a30] dark:text-emerald-300">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[#2d2a24] dark:text-[#eee9df]">{title}</h3>
          <p className="mt-1 text-xs leading-5 text-[#7d776d] dark:text-[#9c968c]">{description}</p>
        </div>
      </div>
      <div className="flex gap-2 border-t border-[#ebe8e2] px-4 py-3 dark:border-[#3a3834]">
        <Input
          value={value}
          disabled={busy}
          placeholder={placeholder}
          aria-label={title}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
          className="font-mono text-xs"
        />
        <Button type="button" size="sm" disabled={busy || !value.trim()} onClick={submit} className="shrink-0 bg-[#565149] text-white hover:bg-[#403c36] dark:bg-[#d8d1c6] dark:text-[#25231f]">
          <Plus />{addLabel}
        </Button>
      </div>
      {items.length ? (
        <div className="border-t border-[#ebe8e2] dark:border-[#3a3834]">
          {items.map((item) => (
            <div key={item} className="flex items-center gap-3 border-b border-[#ebe8e2] px-4 py-2.5 last:border-b-0 dark:border-[#3a3834]">
              <code className="min-w-0 flex-1 truncate text-xs text-[#403c35] dark:text-[#ddd7ce]" title={item}>{item}</code>
              <button type="button" disabled={busy} onClick={() => onRemove(item)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[#8b857b] hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30" aria-label={removeLabel} title={removeLabel}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="border-t border-[#ebe8e2] px-4 py-3 text-xs text-[#938d83] dark:border-[#3a3834] dark:text-[#8f8a81]">{emptyLabel}</div>
      )}
    </section>
  );
}

function CommandSecurityView({ policy, busy, isEnglish, onBack, onAdd, onRemove, onReset }: {
  policy: SecurityPolicyPayload;
  busy: boolean;
  isEnglish: boolean;
  onBack: () => void;
  onAdd: (kind: 'allow' | 'approval', value: string) => void;
  onRemove: (kind: 'allow' | 'approval', value: string) => void;
  onReset: () => void;
}) {
  return (
    <div data-command-security className="mx-auto w-full max-w-4xl space-y-4 py-1">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-[#625e56] hover:text-[#222] dark:text-[#bbb5ab] dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" />{isEnglish ? 'Security overview' : '安全防护概览'}
      </button>
      <section className="flex items-start gap-3 rounded-lg border border-[#dedbd4] bg-[#f8f7f4] px-4 py-3 dark:border-[#44413c] dark:bg-[#252320]">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#397052] dark:text-[#8bc7a4]" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[#302d27] dark:text-[#eee9df]">{isEnglish ? 'Command rule priority' : '命令安全说明'}</h3>
          <p className="mt-1 text-xs leading-5 text-[#736e65] dark:text-[#aaa49a]">
            {isEnglish
              ? 'Core blocks and protected paths always take priority. Ask prefixes override allow prefixes; allow prefixes only skip configurable command-risk prompts.'
              : '核心硬拦截和强制审批路径始终优先；询问前缀优先于放行前缀，放行仅跳过可配置的命令风险询问。'}
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={onReset} className="shrink-0 border-[#dedbd4] bg-white text-[#625e56] dark:border-[#494640] dark:bg-[#2b2a27] dark:text-[#ddd8cf]">
          <RefreshCw />{isEnglish ? 'Reset' : '重置默认'}
        </Button>
      </section>
      <RuleListEditor
        icon={CheckCircle2}
        title={isEnglish ? 'Allow prefixes' : '放行前缀'}
        description={isEnglish ? 'Matching commands skip configurable risk prompts, but never bypass core, file, or network protection.' : '命中后跳过可配置的风险询问，但不能绕过核心、文件或网络保护。'}
        placeholder={isEnglish ? 'For example: git push origin' : '例如：git push origin'}
        items={policy.command_allow_prefixes}
        busy={busy}
        addLabel={isEnglish ? 'Add' : '添加'}
        emptyLabel={isEnglish ? 'No allow prefixes' : '暂无放行前缀'}
        removeLabel={isEnglish ? 'Remove allow prefix' : '删除放行前缀'}
        onAdd={(value) => onAdd('allow', value)}
        onRemove={(value) => onRemove('allow', value)}
      />
      <RuleListEditor
        icon={ShieldAlert}
        title={isEnglish ? 'Ask prefixes' : '询问前缀'}
        description={isEnglish ? 'Matching commands always pause and request approval in the active chat.' : '命中后始终暂停执行，并在当前聊天中请求用户确认。'}
        placeholder={isEnglish ? 'For example: git push' : '例如：git push'}
        items={policy.command_approval_prefixes}
        busy={busy}
        addLabel={isEnglish ? 'Add' : '添加'}
        emptyLabel={isEnglish ? 'No ask prefixes' : '暂无询问前缀'}
        removeLabel={isEnglish ? 'Remove ask prefix' : '删除询问前缀'}
        onAdd={(value) => onAdd('approval', value)}
        onRemove={(value) => onRemove('approval', value)}
      />
    </div>
  );
}

function NetworkSecurityView({ policy, busy, isEnglish, onBack, onToggle, onAdd, onRemove, onReset }: {
  policy: SecurityPolicyPayload;
  busy: boolean;
  isEnglish: boolean;
  onBack: () => void;
  onToggle: () => void;
  onAdd: (kind: 'allow' | 'deny', value: string) => void;
  onRemove: (kind: 'allow' | 'deny', value: string) => void;
  onReset: () => void;
}) {
  return (
    <div data-network-security className="mx-auto w-full max-w-4xl space-y-4 py-1">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium text-[#625e56] hover:text-[#222] dark:text-[#bbb5ab] dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" />{isEnglish ? 'Security overview' : '安全防护概览'}
      </button>
      <section className="flex items-start gap-3 rounded-lg border border-[#dedbd4] bg-[#f8f7f4] px-4 py-3 dark:border-[#44413c] dark:bg-[#252320]">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#397052] dark:text-[#8bc7a4]" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[#302d27] dark:text-[#eee9df]">{isEnglish ? 'Effective immediately' : '生效说明'}</h3>
          <p className="mt-1 text-xs leading-5 text-[#736e65] dark:text-[#aaa49a]">{isEnglish ? 'Saved rules apply to subsequent tool calls in existing and new chats.' : '保存后对现有会话和新会话的后续工具调用立即生效。'}</p>
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={onReset} className="shrink-0 border-[#dedbd4] bg-white text-[#625e56] dark:border-[#494640] dark:bg-[#2b2a27] dark:text-[#ddd8cf]">
          <RefreshCw />{isEnglish ? 'Reset' : '重置默认'}
        </Button>
      </section>
      <section className="flex items-center gap-3 rounded-lg border border-[#e3e0d9] bg-white px-4 py-4 dark:border-[#3d3a36] dark:bg-[#272522]">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#e8f4ee] text-emerald-700 dark:bg-[#243a30] dark:text-emerald-300"><ShieldOff className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[#2d2a24] dark:text-[#eee9df]">{isEnglish ? 'Block all network access' : '阻断所有网络访问'}</h3>
          <p className="mt-1 text-xs leading-5 text-[#7d776d] dark:text-[#9c968c]">{isEnglish ? 'Web tools and network commands are blocked by default; allowed domains remain available.' : 'Web 工具和网络命令默认阻断，仅允许域名作为例外放行。'}</p>
        </div>
        <Toggle checked={policy.network_block_all} disabled={busy} onChange={onToggle} size="md" />
      </section>
      <RuleListEditor
        icon={Globe2}
        title={isEnglish ? 'Allowed domains' : '允许域名'}
        description={isEnglish ? 'Exceptions used when all network access is blocked.' : '开启全部阻断时，这些域名作为例外放行。'}
        placeholder="api.example.com"
        items={policy.network_allow_domains}
        busy={busy}
        addLabel={isEnglish ? 'Add' : '添加'}
        emptyLabel={isEnglish ? 'No allowed domains' : '暂无允许域名'}
        removeLabel={isEnglish ? 'Remove allowed domain' : '删除允许域名'}
        onAdd={(value) => onAdd('allow', value)}
        onRemove={(value) => onRemove('allow', value)}
      />
      <RuleListEditor
        icon={ShieldOff}
        title={isEnglish ? 'Denied domains' : '拒绝域名'}
        description={isEnglish ? 'These domains are always blocked and take priority over allowed domains.' : '这些域名始终禁止访问，并且优先于允许域名。'}
        placeholder="tracking.example.com"
        items={policy.network_deny_domains}
        busy={busy}
        addLabel={isEnglish ? 'Add' : '添加'}
        emptyLabel={isEnglish ? 'No denied domains' : '暂无拒绝域名'}
        removeLabel={isEnglish ? 'Remove denied domain' : '删除拒绝域名'}
        onAdd={(value) => onAdd('deny', value)}
        onRemove={(value) => onRemove('deny', value)}
      />
      <div className="flex items-start gap-2 px-1 text-xs leading-5 text-[#827c72] dark:text-[#99938a]">
        <CircleSlash2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>{isEnglish ? 'This is application-level control for Web tools and explicit network targets in commands, not a replacement for the operating-system firewall.' : '该能力针对 Web 工具和命令中的明确网络目标进行应用层控制，不能替代操作系统防火墙。'}</p>
      </div>
    </div>
  );
}

function AuditRecord({ event, isEnglish }: { event: SecurityAuditEvent; isEnglish: boolean }) {
  const CategoryIcon = event.category === 'command'
    ? SquareTerminal
    : event.category === 'network'
      ? Globe2
      : event.category === 'file'
        ? FileKey2
        : ShieldCheck;
  const categoryIconClasses = event.category === 'command'
    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
    : event.category === 'network'
      ? 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300'
      : event.category === 'file'
        ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300'
        : 'bg-[#efede8] text-[#716b62] dark:bg-[#393630] dark:text-[#bbb5ab]';
  const action = auditActionLabel(event, isEnglish);
  const resultMeta = auditResultMeta(event.result, isEnglish);
  const riskLabel = auditRiskLabel(event.risk, isEnglish);
  const target = event.target?.trim() || event.summary || '-';
  const showReason = isExceptionalAuditResult(event.result) && !!event.target?.trim() && !!event.summary?.trim();
  const accessibleSummary = [
    categoryLabel(event.category, isEnglish),
    action,
    resultMeta.label,
    target,
    showReason ? event.summary : '',
    formatTime(event.timestamp, isEnglish),
  ].filter(Boolean).join(', ');

  return (
    <div
      data-audit-record
      role="listitem"
      aria-label={accessibleSummary}
      className="grid grid-cols-1 gap-3 border-b border-[#ebe8e2] px-4 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_172px] sm:gap-6 dark:border-[#3a3834]"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className={cn('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md', categoryIconClasses)}>
          <CategoryIcon className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[11px] font-medium text-[#7a746b] dark:text-[#aaa49a]">
              {categoryLabel(event.category, isEnglish)}
            </span>
            <span className="text-[13px] font-semibold text-[#302d27] dark:text-[#eee9df]">{action}</span>
            {riskLabel ? (
              <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-700 dark:bg-orange-950/40 dark:text-orange-300">
                {riskLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 whitespace-pre-wrap break-words font-mono text-[12px] leading-5 text-[#4b473f] [overflow-wrap:anywhere] dark:text-[#d6d0c6]">
            {target}
          </p>
          {showReason ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-5 text-red-700 dark:text-red-300">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{isEnglish ? 'Reason: ' : '原因：'}{event.summary}</span>
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 pl-11 sm:block sm:pl-0 sm:text-right">
        <span className={cn('inline-flex rounded px-2 py-1 text-[10px] font-semibold', resultMeta.className)}>
          {resultMeta.label}
        </span>
        <time className="block whitespace-nowrap text-[11px] leading-5 text-[#857f75] sm:mt-2 dark:text-[#99938a]">
          {formatTime(event.timestamp, isEnglish)}
        </time>
        {event.duration_ms !== null && event.duration_ms !== undefined ? (
          <span className="mt-0.5 hidden text-[10px] text-[#aaa49a] sm:block dark:text-[#817c74]">
            {event.duration_ms} ms
          </span>
        ) : null}
      </div>
    </div>
  );
}

function AuditCenter({ token, apiBase, isEnglish, onBack }: { token: string; apiBase: string; isEnglish: boolean; onBack: () => void }) {
  const addToast = useToastStore((state) => state.addToast);
  const requestIdRef = useRef(0);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [result, setResult] = useState('');
  const [period, setPeriod] = useState('all');
  const [events, setEvents] = useState<SecurityAuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCursors, setPageCursors] = useState<Array<number | null>>([null]);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);

  const activeFilterCount = [search.trim(), category, result, period === 'all' ? '' : period]
    .filter(Boolean).length;
  const attentionCount = events.filter((event) => isExceptionalAuditResult(event.result)).length;

  const query = useMemo<SecurityAuditQuery>(() => {
    const periodMs = period === '24h'
      ? 24 * 60 * 60 * 1000
      : period === '7d'
        ? 7 * 24 * 60 * 60 * 1000
        : period === '30d'
          ? 30 * 24 * 60 * 60 * 1000
          : 0;
    return {
      search: search.trim() || undefined,
      category: category || undefined,
      result: result || undefined,
      startMs: periodMs ? Date.now() - periodMs : undefined,
      limit: 100,
    };
  }, [category, period, result, search]);

  const refresh = useCallback(async () => {
    if (!token || !apiBase) {
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setPaging(false);
    try {
      const page = await fetchSecurityAudit(token, apiBase, query);
      if (requestId !== requestIdRef.current) return;
      setEvents(page.events);
      setTotal(page.total ?? 0);
      setNextCursor(page.next_cursor ?? null);
      setPageIndex(0);
      setPageCursors([null]);
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      addToast({ type: 'error', title: isEnglish ? 'Could not load audit records' : '无法读取审计记录', message: errorMessage(error), duration: 6000 });
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [addToast, apiBase, isEnglish, query, token]);

  useEffect(() => {
    requestIdRef.current += 1;
    const timer = window.setTimeout(() => void refresh(), 220);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const loadPage = async (cursor: number | null, index: number) => {
    if (paging) return;
    const requestId = ++requestIdRef.current;
    setPaging(true);
    try {
      const page = await fetchSecurityAudit(token, apiBase, {
        ...query,
        cursor: cursor ?? undefined,
        includeTotal: false,
      });
      if (requestId !== requestIdRef.current) return;
      setEvents(page.events);
      setNextCursor(page.next_cursor ?? null);
      setPageIndex(index);
      setPageCursors((current) => {
        const next = current.slice(0, index + 1);
        next[index] = cursor;
        return next;
      });
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      addToast({ type: 'error', title: isEnglish ? 'Could not load audit page' : '加载审计记录失败', message: errorMessage(error) });
    } finally {
      if (requestId === requestIdRef.current) setPaging(false);
    }
  };

  const loadNextPage = () => {
    if (nextCursor === null) return;
    void loadPage(nextCursor, pageIndex + 1);
  };

  const loadPreviousPage = () => {
    if (pageIndex === 0) return;
    void loadPage(pageCursors[pageIndex - 1] ?? null, pageIndex - 1);
  };

  const exportAudit = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const path = await dialogBridge.save({
        title: isEnglish ? 'Export security audit' : '导出安全审计',
        defaultPath: `nanobot-security-audit-${new Date().toISOString().slice(0, 10)}.jsonl`,
        filters: [{ name: 'JSON Lines', extensions: ['jsonl'] }],
      });
      if (!path) return;
      const data = await exportSecurityAudit(token, apiBase, query);
      await fsBridge.writeFile(path, data);
      addToast({ type: 'success', title: isEnglish ? 'Audit exported' : '审计记录已导出' });
    } catch (error) {
      addToast({ type: 'error', title: isEnglish ? 'Export failed' : '导出失败', message: errorMessage(error), duration: 6000 });
    } finally {
      setExporting(false);
    }
  };

  const confirmClear = async () => {
    if (clearing) return;
    setClearOpen(false);
    setClearing(true);
    try {
      const response = await clearSecurityAudit(token, apiBase);
      await refresh();
      addToast({ type: 'success', title: isEnglish ? `Cleared ${response.deleted} records` : `已清空 ${response.deleted} 条记录` });
    } catch (error) {
      addToast({ type: 'error', title: isEnglish ? 'Clear failed' : '清空失败', message: errorMessage(error) });
    } finally {
      setClearing(false);
    }
  };

  const resetFilters = () => {
    setSearch('');
    setCategory('');
    setResult('');
    setPeriod('all');
  };

  return (
    <div data-security-audit className="mx-auto w-full max-w-4xl space-y-4 py-1">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-[#625e56] outline-none hover:text-[#222] focus-visible:ring-2 focus-visible:ring-[#d97757]/30 dark:text-[#bbb5ab] dark:hover:text-white">
        <ArrowLeft className="h-4 w-4" />{isEnglish ? 'Security overview' : '安全防护概览'}
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#ebe8e2] px-1 pb-4 dark:border-[#3a3834]">
        <div className="min-w-0">
          <h3 className="text-[17px] font-semibold text-[#282620] dark:text-[#f0ebe2]">
            {isEnglish ? 'Audit center' : '审计中心'}
          </h3>
          <p className="mt-1 text-xs leading-5 text-[#7b766d] dark:text-[#9f998f]">
            {isEnglish ? 'File, command, and network access records' : '文件、命令与网络访问记录'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={exporting || !events.length}
            onClick={() => void exportAudit()}
            className="border-[#dedbd4] bg-white text-[#4f4b43] hover:bg-[#f5f3ee] dark:border-[#494640] dark:bg-[#2b2a27] dark:text-[#ddd8cf]"
          >
            {exporting ? <Loader2 className="animate-spin" /> : <Download />}
            {isEnglish ? 'Export' : '导出'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={clearing}
            onClick={() => setClearOpen(true)}
            className="text-[#777167] hover:bg-red-50 hover:text-red-700 dark:text-[#aaa49a] dark:hover:bg-red-950/30 dark:hover:text-red-300"
          >
            {clearing ? <Loader2 className="animate-spin" /> : <Trash2 />}
            {isEnglish ? 'Clear' : '清空'}
          </Button>
        </div>
      </div>

      <section aria-label={isEnglish ? 'Audit filters' : '审计筛选'} className="rounded-lg border border-[#e3e0d9] bg-[#f8f7f4] p-3 dark:border-[#3d3a36] dark:bg-[#252320]">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-[minmax(190px,1fr)_138px_138px_130px]">
          <div className="relative col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#99938a]" />
            <Input
              value={search}
              aria-label={isEnglish ? 'Search audit records' : '搜索审计记录'}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={isEnglish ? 'Search command, path, or summary' : '搜索命令、路径或摘要'}
              className="bg-white pl-9 dark:bg-[#2b2a27]"
            />
          </div>
          <Select ariaLabel={isEnglish ? 'Audit type' : '审计类型'} value={category} onChange={setCategory} options={[
            { value: '', label: isEnglish ? 'All types' : '全部类型' },
            { value: 'file', label: isEnglish ? 'File security' : '文件安全' },
            { value: 'command', label: isEnglish ? 'Command security' : '命令安全' },
            { value: 'network', label: isEnglish ? 'Network security' : '网络安全' },
          ]} />
          <Select ariaLabel={isEnglish ? 'Audit result' : '审计结果'} value={result} onChange={setResult} options={[
            { value: '', label: isEnglish ? 'All results' : '全部结果' },
            { value: 'succeeded', label: isEnglish ? 'Succeeded' : '已完成' },
            { value: 'approved', label: isEnglish ? 'Approved' : '已批准' },
            { value: 'denied', label: isEnglish ? 'Denied' : '已拒绝' },
            { value: 'blocked', label: isEnglish ? 'Blocked' : '已阻止' },
            { value: 'blocked_unattended', label: isEnglish ? 'Blocked unattended' : '无人值守阻止' },
            { value: 'failed', label: isEnglish ? 'Failed' : '失败' },
            { value: 'waiting_for_input', label: isEnglish ? 'Waiting for input' : '等待输入' },
            { value: 'cancelled', label: isEnglish ? 'Cancelled' : '已取消' },
          ]} />
          <Select ariaLabel={isEnglish ? 'Audit period' : '审计时间范围'} value={period} onChange={setPeriod} options={[
            { value: 'all', label: isEnglish ? 'All time' : '全部时间' },
            { value: '24h', label: isEnglish ? 'Last 24h' : '最近 24 小时' },
            { value: '7d', label: isEnglish ? 'Last 7 days' : '最近 7 天' },
            { value: '30d', label: isEnglish ? 'Last 30 days' : '最近 30 天' },
          ]} />
        </div>
        <div className="mt-3 flex min-h-6 flex-wrap items-center justify-between gap-2 border-t border-[#e7e3dc] pt-3 text-xs text-[#837d73] dark:border-[#3a3834] dark:text-[#9b958b]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{isEnglish ? `${total} records` : `共 ${total} 条记录`}</span>
            {attentionCount > 0 ? (
              <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-300">
                <ShieldAlert className="h-3.5 w-3.5" />
                {isEnglish ? `${attentionCount} need attention on this page` : `当前页 ${attentionCount} 条需关注`}
              </span>
            ) : null}
            {activeFilterCount > 0 ? (
              <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 font-medium text-[#5f5a52] hover:text-[#222] dark:text-[#bbb5ab] dark:hover:text-white">
                <X className="h-3.5 w-3.5" />
                {isEnglish ? `Clear ${activeFilterCount} filters` : `清除 ${activeFilterCount} 项筛选`}
              </button>
            ) : null}
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading || paging} className="inline-flex items-center gap-1 rounded outline-none hover:text-[#333] focus-visible:ring-2 focus-visible:ring-[#d97757]/30 disabled:opacity-50 dark:hover:text-white">
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />{isEnglish ? 'Refresh' : '刷新'}
          </button>
        </div>
      </section>

      <div aria-busy={loading || paging} className="overflow-hidden rounded-lg border border-[#e3e0d9] bg-white dark:border-[#3d3a36] dark:bg-[#272522]">
        <div className="hidden grid-cols-[minmax(0,1fr)_172px] gap-6 border-b border-[#ebe8e2] bg-[#faf9f7] px-4 py-2.5 text-[10px] font-semibold text-[#8a847a] sm:grid dark:border-[#3a3834] dark:bg-[#2b2926] dark:text-[#918b82]">
          <span>{isEnglish ? 'EVENT' : '事件'}</span>
          <span className="text-right">{isEnglish ? 'RESULT / TIME' : '结果 / 时间'}</span>
        </div>
        {loading && !events.length ? (
          <div className="flex items-center justify-center py-16 text-sm text-[#888278]"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isEnglish ? 'Loading audit records…' : '正在读取审计记录…'}</div>
        ) : events.length ? (
          <div role="list">
            {events.map((event) => <AuditRecord key={event.id} event={event} isEnglish={isEnglish} />)}
          </div>
        ) : (
          <div className="px-6 py-14 text-center">
            <Clock3 className="mx-auto h-6 w-6 text-[#aaa49a]" />
            <p className="mt-2 text-sm font-medium text-[#5f5a52] dark:text-[#bbb5ab]">{isEnglish ? 'No matching audit records' : '暂无匹配的审计记录'}</p>
            {activeFilterCount > 0 ? (
              <button type="button" onClick={resetFilters} className="mt-2 text-xs font-medium text-[#8a5a44] hover:text-[#603d2d] dark:text-[#d69b7f] dark:hover:text-[#edb59a]">
                {isEnglish ? 'Clear filters' : '清除筛选条件'}
              </button>
            ) : null}
          </div>
        )}
      </div>

      {(pageIndex > 0 || nextCursor !== null) ? (
        <div className="flex items-center justify-center gap-3 pt-1">
          <Button size="sm" variant="outline" disabled={paging || pageIndex === 0} onClick={loadPreviousPage} className="border-[#dedbd4] bg-white text-[#69645b] dark:border-[#494640] dark:bg-[#2b2a27] dark:text-[#aaa49a]">
            <ChevronLeft />{isEnglish ? 'Previous page' : '上一页'}
          </Button>
          <span className="min-w-16 text-center text-xs text-[#837d73] dark:text-[#9b958b]">
            {isEnglish ? `Page ${pageIndex + 1}` : `第 ${pageIndex + 1} 页`}
          </span>
          <Button size="sm" variant="outline" disabled={paging || nextCursor === null} onClick={loadNextPage} className="border-[#dedbd4] bg-white text-[#69645b] dark:border-[#494640] dark:bg-[#2b2a27] dark:text-[#aaa49a]">
            {paging ? <Loader2 className="animate-spin" /> : null}{isEnglish ? 'Next page' : '下一页'}<ChevronRight />
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={clearOpen}
        title={isEnglish ? 'Clear security audit?' : '清空安全审计？'}
        message={isEnglish ? 'Existing records will be removed. A new audit entry will record this action.' : '现有审计记录将被删除，系统会新增一条记录用于追溯本次清空操作。'}
        confirmText={isEnglish ? 'Clear records' : '清空记录'}
        cancelText={isEnglish ? 'Cancel' : '取消'}
        variant="danger"
        onConfirm={() => void confirmClear()}
        onCancel={() => setClearOpen(false)}
      />
    </div>
  );
}

export default function SecurityProtectionSection({ token, apiBase, isEnglish }: { token: string; apiBase: string; isEnglish: boolean }) {
  const addToast = useToastStore((state) => state.addToast);
  const [view, setView] = useState<SecurityView>('overview');
  const [policy, setPolicy] = useState<SecurityPolicyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadPolicy = useCallback(async () => {
    if (!token || !apiBase) return;
    setLoading(true);
    try {
      setPolicy(await fetchSecurityPolicy(token, apiBase));
    } catch (error) {
      addToast({ type: 'error', title: isEnglish ? 'Could not load security policy' : '无法读取安全策略', message: errorMessage(error), duration: 6000 });
    } finally {
      setLoading(false);
    }
  }, [addToast, apiBase, isEnglish, token]);

  useEffect(() => { void loadPolicy(); }, [loadPolicy]);

  const persistPolicy = async (update: SecurityPolicyUpdate, successTitle: string) => {
    setBusy(true);
    try {
      setPolicy(await updateSecurityPolicy(token, apiBase, update));
      addToast({ type: 'success', title: successTitle });
    } catch (error) {
      addToast({ type: 'error', title: isEnglish ? 'Could not update policy' : '策略更新失败', message: errorMessage(error), duration: 6000 });
    } finally {
      setBusy(false);
    }
  };

  const persistPaths = (fileAllow: string[], approval: string[]) => persistPolicy(
    { file_allow_paths: fileAllow, approval_paths: approval },
    isEnglish ? 'File security updated' : '文件安全策略已更新',
  );

  const addPath = async (kind: 'allow' | 'approval') => {
    if (!policy || busy) return;
    const selected = await dialogBridge.open({
      directory: true,
      multiple: false,
      title: kind === 'allow'
        ? (isEnglish ? 'Choose automatically allowed folder' : '选择自动放行目录')
        : (isEnglish ? 'Choose approval folder' : '选择强制审批目录'),
    });
    if (!selected || typeof selected !== 'string') return;
    const fileAllow = policy.file_allow_paths.map((item) => item.path);
    const approval = policy.approval_paths.map((item) => item.path);
    const target = kind === 'allow' ? fileAllow : approval;
    if (target.includes(selected)) return;
    target.push(selected);
    await persistPaths(fileAllow, approval);
  };

  const removePath = async (kind: 'allow' | 'approval', path: string) => {
    if (!policy || busy) return;
    const fileAllow = policy.file_allow_paths.map((item) => item.path)
      .filter((item) => kind !== 'allow' || item !== path);
    const approval = policy.approval_paths.map((item) => item.path)
      .filter((item) => kind !== 'approval' || item !== path);
    await persistPaths(fileAllow, approval);
  };

  const updateCommandRule = (kind: 'allow' | 'approval', value: string, remove = false) => {
    if (!policy || busy) return;
    const key = kind === 'allow' ? 'command_allow_prefixes' : 'command_approval_prefixes';
    const current = policy[key];
    const next = remove ? current.filter((item) => item !== value) : [...current, value];
    void persistPolicy(
      kind === 'allow' ? { command_allow_prefixes: next } : { command_approval_prefixes: next },
      isEnglish ? 'Command security updated' : '命令安全策略已更新',
    );
  };

  const updateNetworkRule = (kind: 'allow' | 'deny', value: string, remove = false) => {
    if (!policy || busy) return;
    const key = kind === 'allow' ? 'network_allow_domains' : 'network_deny_domains';
    const current = policy[key];
    const next = remove ? current.filter((item) => item !== value) : [...current, value];
    void persistPolicy(
      kind === 'allow' ? { network_allow_domains: next } : { network_deny_domains: next },
      isEnglish ? 'Network security updated' : '网络安全策略已更新',
    );
  };

  if (loading && !policy) {
    return <div className="flex items-center justify-center py-20 text-sm text-[#888278]"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isEnglish ? 'Loading security protection…' : '正在读取安全防护…'}</div>;
  }
  if (!policy) {
    return <div className="py-16 text-center"><FolderLock className="mx-auto h-7 w-7 text-[#aaa49a]" /><p className="mt-2 text-sm text-[#777167]">{isEnglish ? 'Security policy is unavailable' : '安全策略暂时不可用'}</p><Button size="sm" variant="ghost" className="mt-3" onClick={() => void loadPolicy()}><RefreshCw />{isEnglish ? 'Retry' : '重试'}</Button></div>;
  }
  if (view === 'files') {
    return <FileSecurityView policy={policy} busy={busy} isEnglish={isEnglish} onBack={() => setView('overview')} onAdd={(kind) => void addPath(kind)} onRemove={(kind, path) => void removePath(kind, path)} onReset={() => void persistPaths([], [])} />;
  }
  if (view === 'commands') return (
    <CommandSecurityView
      policy={policy}
      busy={busy}
      isEnglish={isEnglish}
      onBack={() => setView('overview')}
      onAdd={(kind, value) => updateCommandRule(kind, value)}
      onRemove={(kind, value) => updateCommandRule(kind, value, true)}
      onReset={() => void persistPolicy(
        { command_allow_prefixes: [], command_approval_prefixes: [] },
        isEnglish ? 'Command defaults restored' : '已恢复命令安全默认设置',
      )}
    />
  );
  if (view === 'network') return (
    <NetworkSecurityView
      policy={policy}
      busy={busy}
      isEnglish={isEnglish}
      onBack={() => setView('overview')}
      onToggle={() => void persistPolicy(
        { network_block_all: !policy.network_block_all },
        isEnglish ? 'Network security updated' : '网络安全策略已更新',
      )}
      onAdd={(kind, value) => updateNetworkRule(kind, value)}
      onRemove={(kind, value) => updateNetworkRule(kind, value, true)}
      onReset={() => void persistPolicy(
        { network_block_all: false, network_allow_domains: [], network_deny_domains: [] },
        isEnglish ? 'Network defaults restored' : '已恢复网络安全默认设置',
      )}
    />
  );
  if (view === 'audit') return <AuditCenter token={token} apiBase={apiBase} isEnglish={isEnglish} onBack={() => setView('overview')} />;
  return <SecurityOverview isEnglish={isEnglish} onOpen={setView} />;
}
