import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import SecurityAuditDetails, { auditDecisionLabel } from './SecurityAuditDetails';
import './settingsPage.css';
import './securityCenter.css';

type SecurityView = 'overview' | 'files' | 'commands' | 'network' | 'audit';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function categoryLabel(category: string, isEnglish: boolean): string {
  const labels: Record<string, [string, string]> = {
    file: ['文件访问与修改', 'File access and changes'],
    command: ['命令与系统操作', 'Commands and system'],
    network: ['联网与数据流转', 'Network and data'],
    authorization: ['安全决策与授权', 'Decisions and approvals'],
    settings: ['安全设置与审计管理', 'Policy and audit administration'],
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
    if (event.action === 'model_request') return isEnglish ? 'Model request' : '模型请求';
    if (event.action === 'mcp_call') return isEnglish ? 'MCP tool call' : 'MCP 工具调用';
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
    if (event.action === 'export_audit') return isEnglish ? 'Generate audit export' : '生成审计导出';
    if (event.action === 'reset') return isEnglish ? 'Reset security policy' : '重置安全策略';
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
      className: 'security-result-neutral',
    },
    pending: {
      labels: ['尚无完成记录', 'No completion recorded'],
      className: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
    },
    waiting_for_input: {
      labels: ['等待输入', 'Waiting for input'],
      className: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
    },
    executing: {
      labels: ['已授权执行', 'Execution authorized'],
      className: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
    },
    running: {
      labels: ['未确认结束', 'Exit unconfirmed'],
      className: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
    },
    timed_out: {
      labels: ['已超时', 'Timed out'],
      className: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    },
  };
  const value = values[result];
  return value
    ? { label: value.labels[isEnglish ? 1 : 0], className: value.className }
    : { label: result || (isEnglish ? 'Unknown' : '未知'), className: 'security-result-neutral' };
}

function auditRiskLabel(risk: string, isEnglish: boolean): string | null {
  if (risk === 'sensitive') return isEnglish ? 'Sensitive' : '敏感';
  if (risk === 'critical') return isEnglish ? 'Critical risk' : '严重风险';
  if (risk === 'high') return isEnglish ? 'High risk' : '高风险';
  return null;
}

function isApprovalTimeout(event: SecurityAuditEvent): boolean {
  return event.result === 'timed_out' && (event.decision === 'timed_out' || event.details.authorization === 'timed_out');
}

function SecurityPageHeader({ title, isEnglish, onBack, children }: {
  title: string;
  isEnglish: boolean;
  onBack: () => void;
  children?: ReactNode;
}) {
  const backLabel = isEnglish ? 'Security overview' : '安全防护概览';
  return <div className="security-page-header">
    <div className="security-page-heading">
      <Button size="icon-sm" variant="ghost" onClick={onBack} aria-label={backLabel} title={backLabel}>
        <ArrowLeft /><span className="sr-only">{backLabel}</span>
      </Button>
      <h3 className="settings-page-title">{title}</h3>
    </div>
    {children && <div className="security-page-actions">{children}</div>}
  </div>;
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
      <span className="security-nav-icon">
        <Icon className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="settings-page-title block">{title}</span>
        <span className="settings-page-copy mt-1 block">{description}</span>
        <span className="security-nav-status security-nav-status-mobile">{status}</span>
      </span>
      <span className="security-nav-status security-nav-status-desktop">
        {status}
      </span>
      {onClick ? <ChevronRight className="settings-page-muted h-4 w-4 shrink-0" /> : null}
    </>
  );
  const classes = 'settings-page-row security-nav-row';
  return onClick ? (
    <button type="button" onClick={onClick} className={classes}>
      {content}
    </button>
  ) : <div className={classes}>{content}</div>;
}

function SecurityOverview({ policy, confirmedAt, unconfirmed, loading, busy, isEnglish, onRefresh, onOpen }: {
  policy: SecurityPolicyPayload;
  confirmedAt: number | null;
  unconfirmed: boolean;
  loading: boolean;
  busy: boolean;
  isEnglish: boolean;
  onRefresh: () => void;
  onOpen: (view: SecurityView) => void;
}) {
  const componentStatus = (key: string, configured: string) => {
    const enabled = policy.components[key]?.enabled;
    return enabled === false ? (isEnglish ? 'Configured off' : '配置未启用')
      : enabled === undefined ? (isEnglish ? 'Status not reported' : '未返回启用状态') : configured;
  };
  const StatusIcon = unconfirmed || !policy.protection_enabled ? ShieldAlert : ShieldCheck;
  return (
    <div data-security-overview className="settings-page-stack">
      <section className="settings-page-intro">
        <StatusIcon className={cn('mt-0.5 h-4 w-4 shrink-0', unconfirmed ? 'text-amber-600 dark:text-amber-300' : 'settings-page-secondary')} strokeWidth={1.8} />
        <div className="min-w-0 flex-1">
          <h3 className="settings-page-title">
            {unconfirmed ? (isEnglish ? 'Current policy unconfirmed' : '当前策略尚未确认') : !policy.protection_enabled ? (isEnglish ? 'Protection configured off' : '防护配置未启用') : (isEnglish ? 'Security policy retrieved' : '已读取安全策略')}
          </h3>
          <p className="settings-page-copy mt-1">
            {isEnglish
              ? 'Application protection. Policy settings do not verify the outcome of every operation.'
              : '应用层防护；策略配置不代表每次操作的实际执行结果。'}
          </p>
          {confirmedAt !== null && <p className="settings-page-caption mt-2">{isEnglish ? 'Last confirmed: ' : '上次确认：'}{formatTime(confirmedAt, isEnglish)}{unconfirmed ? (isEnglish ? ' (previous snapshot)' : '（上次快照）') : ''}</p>}
        </div>
        <Button size="icon-sm" variant="ghost" disabled={loading || busy} onClick={onRefresh} aria-label={isEnglish ? 'Refresh security policy' : '刷新安全策略'} title={isEnglish ? 'Refresh security policy' : '刷新安全策略'}><RefreshCw className={cn(loading && 'animate-spin')} /></Button>
      </section>

      <section className="security-nav-list" aria-label={isEnglish ? 'Protection policies' : '防护策略'}>
        <ProtectionRow
          icon={FileKey2}
          title={isEnglish ? 'File protection' : '文件安全'}
          description={isEnglish ? `${policy.approval_paths.length} approval folders; ${policy.file_allow_paths.length} allowed folders` : `${policy.approval_paths.length} 个强制审批目录，${policy.file_allow_paths.length} 个自动放行目录`}
          status={componentStatus('file', isEnglish ? 'Approval rules configured' : '按目录风险审批')}
          onClick={() => onOpen('files')}
        />
        <ProtectionRow
          icon={SquareTerminal}
          title={isEnglish ? 'Command protection' : '命令安全'}
          description={isEnglish ? `${policy.command_approval_prefixes.length} ask prefixes; ${policy.command_allow_prefixes.length} allow prefixes` : `${policy.command_approval_prefixes.length} 条询问前缀，${policy.command_allow_prefixes.length} 条放行前缀`}
          status={componentStatus('command', policy.core_protection_locked ? (isEnglish ? 'Core blocks locked' : '核心拦截已锁定') : (isEnglish ? 'Core lock unconfirmed' : '核心锁定未确认'))}
          onClick={() => onOpen('commands')}
        />
        <ProtectionRow
          icon={Network}
          title={isEnglish ? 'Network protection' : '网络安全'}
          description={isEnglish ? `${policy.network_deny_domains.length} denied domains; ${policy.network_allow_domains.length} exceptions${policy.network_block_all ? '' : ' (inactive)'}` : `${policy.network_deny_domains.length} 个拒绝域名，${policy.network_allow_domains.length} 个放行例外${policy.network_block_all ? '' : '（当前不启用）'}`}
          status={componentStatus('network', policy.network_block_all ? (isEnglish ? 'Covered requests blocked by default' : '受控请求默认阻断') : (isEnglish ? 'Allowed after risk checks' : '通过安全检查后放行'))}
          onClick={() => onOpen('network')}
        />
      </section>
      <section className="security-audit-entry">
        <ProtectionRow
          icon={FileSearch}
          title={isEnglish ? 'Audit center' : '审计中心'}
          description={isEnglish ? 'Operations, approvals, policy changes, and audit administration' : '关键操作、授权结果、安全设置变更与审计管理'}
          status={componentStatus('audit', isEnglish ? 'Recording configured' : '已配置记录')}
          onClick={() => onOpen('audit')}
        />
      </section>
    </div>
  );
}

function PathList({ paths, busy, empty, defaultLabel, removeLabel, onRemove }: {
  paths: SecurityPolicyPath[];
  busy: boolean;
  empty: string;
  defaultLabel: string;
  removeLabel: string;
  onRemove: (path: string) => void;
}) {
  if (!paths.length) return <div className="security-empty-inline">{empty}</div>;
  return (
    <div className="security-rule-list">
      {paths.map((item) => (
        <div key={`${item.source}:${item.path}`} className="security-rule-row">
          <FolderCheck className="settings-page-secondary h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={item.path}>{item.path}</span>
          {item.source === 'default' ? (
            <span className="settings-page-caption shrink-0">{defaultLabel}</span>
          ) : (
            <button type="button" disabled={busy} onClick={() => onRemove(item.path)} className="security-remove" aria-label={removeLabel} title={removeLabel}>
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
    <div data-file-security className="settings-page-stack">
      <SecurityPageHeader title={isEnglish ? 'File protection' : '文件安全'} isEnglish={isEnglish} onBack={onBack}>
        <Button size="sm" variant="outline" disabled={busy} onClick={onReset}><RefreshCw />{isEnglish ? 'Restore defaults' : '恢复系统默认'}</Button>
      </SecurityPageHeader>
      <p className="settings-page-copy">{isEnglish ? 'Ordinary file work is allowed by default. An empty allowlist keeps risk checks in place. Core blocks and mandatory approval take priority over allow rules. Saved changes apply to subsequent tool calls.' : '普通文件操作默认允许，白名单为空时仍按风险检查。核心拦截、强制审批优先于自动放行；保存后影响后续工具调用。'}</p>
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
      <div className="security-note security-footer">
        <Info className="h-4 w-4" />
        <p>{isEnglish ? 'Automatic allow cannot cover the home root, system folders, core protection, or approval folders.' : '自动放行不能覆盖整个用户目录、系统目录、核心保护项或强制审批目录。'}</p>
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
    <section className="security-rule-section">
      <div className="security-rule-heading">
        <div>
          <h3 className="settings-page-title">{title}</h3>
          <p className="settings-page-copy">{description}</p>
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={onAdd}>
          <Plus />{addLabel}
        </Button>
      </div>
      <PathList paths={paths} busy={busy} empty={empty} defaultLabel={defaultLabel} removeLabel={removeLabel} onRemove={onRemove} />
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
  onAdd: (value: string) => Promise<boolean>;
  onRemove: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  const submitting = useRef(false);
  const submit = async () => {
    const normalized = value.trim();
    if (!normalized || busy || submitting.current || items.includes(normalized)) return;
    submitting.current = true;
    try {
      if (await onAdd(normalized)) setValue('');
    } finally {
      submitting.current = false;
    }
  };
  return (
    <section className="security-rule-section">
      <div className="security-rule-heading">
        <div>
          <h3 className="settings-page-title"><Icon className="h-4 w-4" strokeWidth={1.8} />{title}</h3>
          <p className="settings-page-copy">{description}</p>
        </div>
      </div>
      <div className="security-rule-input">
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
          className="font-mono"
        />
        <Button type="button" size="sm" disabled={busy || !value.trim() || items.includes(value.trim())} onClick={submit}>
          <Plus />{addLabel}
        </Button>
      </div>
      {items.length ? (
        <div className="security-rule-list">
          {items.map((item) => (
            <div key={item} className="security-rule-row">
              <code className="min-w-0 flex-1 truncate" title={item}>{item}</code>
              <button type="button" disabled={busy} onClick={() => onRemove(item)} className="security-remove" aria-label={removeLabel} title={removeLabel}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="security-empty-inline">{emptyLabel}</div>
      )}
    </section>
  );
}

function CommandSecurityView({ policy, busy, isEnglish, onBack, onAdd, onRemove, onReset }: {
  policy: SecurityPolicyPayload;
  busy: boolean;
  isEnglish: boolean;
  onBack: () => void;
  onAdd: (kind: 'allow' | 'approval', value: string) => Promise<boolean>;
  onRemove: (kind: 'allow' | 'approval', value: string) => void;
  onReset: () => void;
}) {
  return (
    <div data-command-security className="settings-page-stack">
      <SecurityPageHeader title={isEnglish ? 'Command protection' : '命令安全'} isEnglish={isEnglish} onBack={onBack}>
        <Button size="sm" variant="outline" disabled={busy} onClick={onReset}><RefreshCw />{isEnglish ? 'Reset' : '重置默认'}</Button>
      </SecurityPageHeader>
      <div className="settings-page-copy space-y-1">
          <p>
            {isEnglish
              ? 'Core blocks and protected paths always take priority. Ask prefixes override allow prefixes; allow prefixes only skip configurable command-risk prompts.'
              : '核心硬拦截和强制审批路径始终优先；询问前缀优先于放行前缀，放行仅跳过可配置的命令风险询问。'}
          </p>
          <p>{isEnglish ? 'With no custom prefixes, built-in risk checks apply. Saved changes affect subsequent tool calls.' : '未添加前缀时，按内置风险规则判断；保存后影响后续工具调用。'}</p>
      </div>
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
  onAdd: (kind: 'allow' | 'deny', value: string) => Promise<boolean>;
  onRemove: (kind: 'allow' | 'deny', value: string) => void;
  onReset: () => void;
}) {
  return (
    <div data-network-security className="settings-page-stack">
      <SecurityPageHeader title={isEnglish ? 'Network protection' : '网络安全'} isEnglish={isEnglish} onBack={onBack}>
        <Button size="sm" variant="outline" disabled={busy} onClick={onReset}><RefreshCw />{isEnglish ? 'Reset' : '重置默认'}</Button>
      </SecurityPageHeader>
      <p className="settings-page-copy">{isEnglish ? 'Saved rules apply to subsequent tool calls in existing and new chats.' : '保存后对现有会话和新会话的后续工具调用立即生效。'}</p>
      <div className="settings-page-row security-switch-row">
        <div>
          <h3 className="settings-page-title">{isEnglish ? 'Block covered tool requests by default' : '默认阻断受控工具联网'}</h3>
          <p className="settings-page-copy">{isEnglish ? 'When on, covered requests need an allowed-domain exception. When off, requests still follow denied-domain and built-in risk checks.' : '开启后，受控请求仅按允许域名例外放行；关闭时仍执行拒绝域名和内置风险检查。'}</p>
        </div>
        <Toggle checked={policy.network_block_all} disabled={busy} onChange={onToggle} size="md" />
      </div>
      <RuleListEditor
        icon={Globe2}
        title={isEnglish ? 'Allowed domains' : '允许域名'}
        description={policy.network_block_all
          ? (isEnglish ? 'Exceptions to default blocking. An empty list blocks all covered requests. Denied domains and built-in restrictions take priority.' : '默认阻断的例外；列表为空时阻断所有受控请求。拒绝域名和内置限制优先。')
          : (isEnglish ? 'Currently inactive. These exceptions apply only when default blocking is on; an empty list does not block access.' : '当前不启用，仅在开启默认阻断后作为例外；列表为空不表示禁止联网。')}
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
      <div className="security-note security-footer">
        <CircleSlash2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>{isEnglish ? 'Coverage: Web tools and recognized network targets in commands. Model requests and downstream MCP traffic are not fully covered; this cannot replace the operating-system firewall.' : '适用范围：Web 工具及命令中可识别的网络目标。不保证覆盖模型请求或 MCP 服务内部的全部联网，不能替代操作系统防火墙。'}</p>
      </div>
    </div>
  );
}

function AuditRecord({ event, isEnglish }: { event: SecurityAuditEvent; isEnglish: boolean }) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const operationCount = typeof event.details.operation_count === 'number' ? event.details.operation_count : 1;
  const authorization = event.details.authorization || (event.decision.startsWith('approved') ? event.decision : null);
  const CategoryIcon = event.category === 'command'
    ? SquareTerminal
    : event.category === 'network'
      ? Globe2
      : event.category === 'file'
        ? FileKey2
        : ShieldCheck;
  const action = auditActionLabel(event, isEnglish);
  const resultMeta = auditResultMeta(event.result, isEnglish);
  if (isApprovalTimeout(event)) resultMeta.label = isEnglish ? 'Approval timed out' : '审批已超时';
  const riskLabel = auditRiskLabel(event.risk, isEnglish);
  const target = operationCount > 1 && event.category === 'file'
    ? (isEnglish ? 'Workspace file operations in this task' : '本轮工作区文件操作')
    : event.target?.trim() || event.summary || '-';
  const reason = ['blocked', 'blocked_unattended', 'denied'].includes(event.result)
    ? event.result === 'blocked' && event.details.error_type
      ? (isEnglish ? 'Execution was blocked by a tool security boundary' : '执行时被工具安全边界阻止')
      : event.summary
    : event.result === 'failed' && typeof event.details.exit_code === 'number'
      ? `${isEnglish ? 'Process exit code: ' : '进程退出码：'}${event.details.exit_code}` : '';
  const showReason = !!reason;
  const accessibleSummary = [
    categoryLabel(event.category, isEnglish),
    action,
    resultMeta.label,
    target,
    reason,
    formatTime(event.timestamp, isEnglish),
  ].filter(Boolean).join(', ');

  return (
    <div
      data-audit-record
      role="listitem"
      aria-label={accessibleSummary}
      className="security-event"
    >
      <details onToggle={(e) => setDetailsOpen(e.currentTarget.open)} className="min-w-0">
        <summary
          title={isEnglish ? (detailsOpen ? 'Collapse details' : 'Expand details') : (detailsOpen ? '收起详情' : '展开详情')}
          aria-label={`${isEnglish ? (detailsOpen ? 'Collapse details' : 'Expand details') : (detailsOpen ? '收起详情' : '展开详情')}：${action}`}
          className="security-event-summary"
        >
        <span className="security-event-icon">
          <CategoryIcon className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13px] font-semibold leading-5">{action}</span>
            <span className="settings-page-caption">
              {categoryLabel(event.category, isEnglish)}
            </span>
            {operationCount > 1 && <span className="settings-page-caption">{isEnglish ? `${operationCount} operations` : `${operationCount} 次`}</span>}
            {riskLabel ? (
              <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[11px] font-medium text-orange-700 dark:bg-orange-950/40 dark:text-orange-300">
                {riskLabel}
              </span>
            ) : null}
          </div>
          <p data-audit-preview className="settings-page-secondary mt-0.5 line-clamp-2 whitespace-pre-wrap break-words font-mono text-[12px] leading-[18px] [overflow-wrap:anywhere]">
            {target}
          </p>
          {Boolean(authorization || event.details.agent_label) && <p className="settings-page-caption mt-1 truncate">
            {[event.details.agent_label, authorization ? auditDecisionLabel(authorization, isEnglish) : null].filter(Boolean).map(String).join(' · ')}
          </p>}
          {showReason ? (
            <p className="mt-1 flex items-start gap-1.5 text-xs leading-5 text-red-700 dark:text-red-300">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{isEnglish ? 'Reason: ' : '原因：'}{reason}</span>
            </p>
          ) : null}
        </div>
      <div className="security-event-result">
        <span className={cn('inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium leading-4', resultMeta.className)}>
          {resultMeta.label}
        </span>
        <time className="settings-page-caption block whitespace-nowrap tabular-nums">
          {formatTime(event.timestamp, isEnglish)}
        </time>
        {event.duration_ms !== null && event.duration_ms !== undefined ? (
          <span className="security-event-duration settings-page-caption tabular-nums">
            {event.duration_ms} ms
          </span>
        ) : null}
      </div>
          <ChevronRight aria-hidden="true" className="security-event-chevron" />
        </summary>
        {detailsOpen && <div className="security-event-details">
          <SecurityAuditDetails event={event} isEnglish={isEnglish} />
        </div>}
      </details>
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
  const [loadError, setLoadError] = useState('');

  const activeFilterCount = [search.trim(), category, result, period === 'all' ? '' : period]
    .filter(Boolean).length;
  const preventedCount = events.filter((event) => ['blocked', 'blocked_unattended', 'denied'].includes(event.result) || isApprovalTimeout(event)).length;
  const exceptionCount = events.filter((event) => ['failed', 'timed_out'].includes(event.result) && !isApprovalTimeout(event)).length;

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
      setLoadError(isEnglish ? 'The local service is not connected.' : '本地服务尚未连接。');
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
      setLoadError('');
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setLoadError(errorMessage(error));
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [apiBase, isEnglish, query, token]);

  useEffect(() => {
    requestIdRef.current += 1;
    setLoading(true);
    const timer = window.setTimeout(() => void refresh(), 220);
    return () => {
      requestIdRef.current += 1;
      window.clearTimeout(timer);
    };
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
      setLoadError('');
      setNextCursor(page.next_cursor ?? null);
      setPageIndex(index);
      setPageCursors((current) => {
        const next = current.slice(0, index + 1);
        next[index] = cursor;
        return next;
      });
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setLoadError(errorMessage(error));
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
      await refresh();
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
    <div data-security-audit className="settings-page-stack">
      <SecurityPageHeader title={isEnglish ? 'Audit center' : '审计中心'} isEnglish={isEnglish} onBack={onBack}>
          <Button
            size="sm"
            variant="outline"
            disabled={exporting || loading || paging || !!loadError || !events.length}
            onClick={() => void exportAudit()}
          >
            {exporting ? <Loader2 className="animate-spin" /> : <Download />}
            {isEnglish ? 'Export' : '导出'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={clearing}
            onClick={() => setClearOpen(true)}
            className="settings-action-danger"
          >
            {clearing ? <Loader2 className="animate-spin" /> : <Trash2 />}
            {isEnglish ? 'Clear' : '清空'}
          </Button>
      </SecurityPageHeader>

      <div className="security-audit-content">
      <section aria-label={isEnglish ? 'Audit filters' : '审计筛选'} className="security-filters">
        <div className="security-filter-grid">
          <div className="relative">
            <Search className="settings-page-muted pointer-events-none absolute left-3 top-2.5 h-4 w-4" />
            <Input
              value={search}
              aria-label={isEnglish ? 'Search audit records' : '搜索审计记录'}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={isEnglish ? 'Search command, path, or summary' : '搜索命令、路径或摘要'}
              className="pl-9"
            />
          </div>
          <Select ariaLabel={isEnglish ? 'Audit type' : '审计类型'} value={category} onChange={setCategory} options={[
            { value: '', label: isEnglish ? 'All types' : '全部类型' },
            ...['file', 'command', 'network', 'authorization', 'settings'].map((value) => ({ value, label: categoryLabel(value, isEnglish) })),
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
            { value: 'timed_out', label: isEnglish ? 'Timed out' : '已超时' },
            { value: 'running', label: isEnglish ? 'Exit unconfirmed' : '未确认结束' },
            { value: 'pending', label: isEnglish ? 'No completion recorded' : '尚无完成记录' },
          ]} />
          <Select ariaLabel={isEnglish ? 'Audit period' : '审计时间范围'} value={period} onChange={setPeriod} options={[
            { value: 'all', label: isEnglish ? 'All time' : '全部时间' },
            { value: '24h', label: isEnglish ? 'Last 24h' : '最近 24 小时' },
            { value: '7d', label: isEnglish ? 'Last 7 days' : '最近 7 天' },
            { value: '30d', label: isEnglish ? 'Last 30 days' : '最近 30 天' },
          ]} />
        </div>
        <div className="security-filter-stats">
          <div>
            {!loading && !loadError && <span>{isEnglish ? `${total} records` : `共 ${total} 条记录`}</span>}
            {!loading && !loadError && preventedCount > 0 ? (
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5" />
                {isEnglish ? `${preventedCount} blocked or not authorized on this page` : `当前页已拦截或未获授权 ${preventedCount} 条`}
              </span>
            ) : null}
            {!loading && !loadError && exceptionCount > 0 && <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300"><Info className="h-3.5 w-3.5" />{isEnglish ? `${exceptionCount} execution exceptions on this page` : `当前页执行异常 ${exceptionCount} 条`}</span>}
            {activeFilterCount > 0 ? (
              <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 font-medium hover:underline">
                <X className="h-3.5 w-3.5" />
                {isEnglish ? `Clear ${activeFilterCount} filters` : `清除 ${activeFilterCount} 项筛选`}
              </button>
            ) : null}
          </div>
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => void refresh()} disabled={loading || paging} aria-label={isEnglish ? 'Refresh' : '刷新'} title={isEnglish ? 'Refresh' : '刷新'}>
            <RefreshCw className={cn(loading && 'animate-spin')} /><span className="sr-only">{isEnglish ? 'Refresh' : '刷新'}</span>
          </Button>
        </div>
      </section>

      {loadError && <div role="alert" className="settings-page-alert"><div><p className="font-semibold">{isEnglish ? 'Could not load audit records' : '无法读取审计记录'}</p><p>{loadError}</p><p>{events.length ? (isEnglish ? 'The records below are from the previous load. Refresh to retry.' : '下方保留上次加载的记录，请刷新重试。') : (isEnglish ? 'Refresh to retry; record availability is unconfirmed.' : '请刷新重试，目前无法确认是否存在记录。')}</p></div></div>}
      <p className="settings-page-copy">{isEnglish ? 'Historical outcomes. Blocked actions do not necessarily need follow-up; execution failures do not by themselves indicate a threat. Live approvals appear in the conversation.' : '以下为历史结果：已拦截不代表仍待处理，执行异常不等同于安全威胁；当前待审批事项以会话中的请求为准。'}</p>

      <div aria-busy={loading || paging} className="security-audit-table">
        <div className="security-audit-columns">
          <span>{isEnglish ? 'EVENT' : '事件'}</span>
          <span className="text-right">{isEnglish ? 'RESULT / TIME' : '结果 / 时间'}</span>
        </div>
        {loading && !events.length ? (
          <div className="settings-page-empty flex items-center justify-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isEnglish ? 'Loading audit records…' : '正在读取审计记录…'}</div>
        ) : events.length ? (
          <div role="list">
            {events.map((event) => <AuditRecord key={event.id} event={event} isEnglish={isEnglish} />)}
          </div>
        ) : loadError ? null : (
          <div className="settings-page-empty">
            <Clock3 className="settings-page-muted mx-auto h-5 w-5" />
            <p className="settings-page-title mt-2">{isEnglish ? 'No matching audit records' : '暂无匹配的审计记录'}</p>
            {activeFilterCount > 0 ? (
              <button type="button" onClick={resetFilters} className="mt-2 font-medium hover:underline">
                {isEnglish ? 'Clear filters' : '清除筛选条件'}
              </button>
            ) : null}
          </div>
        )}
      </div>

      {(pageIndex > 0 || nextCursor !== null) ? (
        <div className="security-pagination">
          <Button size="sm" variant="outline" disabled={loading || paging || !!loadError || pageIndex === 0} onClick={loadPreviousPage}>
            <ChevronLeft />{isEnglish ? 'Previous page' : '上一页'}
          </Button>
          <span className="settings-page-caption min-w-16 text-center">
            {isEnglish ? `Page ${pageIndex + 1}` : `第 ${pageIndex + 1} 页`}
          </span>
          <Button size="sm" variant="outline" disabled={loading || paging || !!loadError || nextCursor === null} onClick={loadNextPage}>
            {paging ? <Loader2 className="animate-spin" /> : null}{isEnglish ? 'Next page' : '下一页'}<ChevronRight />
          </Button>
        </div>
      ) : null}
      </div>
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

function SecurityProtectionContent({ token, apiBase, isEnglish }: { token: string; apiBase: string; isEnglish: boolean }) {
  const addToast = useToastStore((state) => state.addToast);
  const [view, setView] = useState<SecurityView>('overview');
  const [policy, setPolicy] = useState<SecurityPolicyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [confirmedAt, setConfirmedAt] = useState<number | null>(null);
  const [resetKind, setResetKind] = useState<'files' | 'commands' | 'network' | null>(null);
  const requestIdRef = useRef(0);
  const operationRef = useRef<'load' | 'save' | 'pick' | null>(null);

  const loadPolicy = useCallback(async () => {
    if (operationRef.current === 'save' || operationRef.current === 'pick') return;
    const requestId = ++requestIdRef.current;
    if (!token || !apiBase) {
      setLoadError(isEnglish ? 'The local service is not connected. Retry when it is available.' : '本地服务尚未连接，请在连接恢复后重试。');
      setLoading(false);
      return;
    }
    operationRef.current = 'load';
    setLoading(true);
    try {
      const next = await fetchSecurityPolicy(token, apiBase);
      if (requestId !== requestIdRef.current) return;
      setPolicy(next);
      setConfirmedAt(Date.now());
      setLoadError('');
      setSaveError('');
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setLoadError(errorMessage(error));
    } finally {
      if (requestId === requestIdRef.current) {
        operationRef.current = null;
        setLoading(false);
      }
    }
  }, [apiBase, isEnglish, token]);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);
  useEffect(() => () => { requestIdRef.current += 1; }, []);

  const persistPolicy = async (update: SecurityPolicyUpdate, successTitle: string): Promise<boolean> => {
    if (operationRef.current || loadError || !token || !apiBase) return false;
    operationRef.current = 'save';
    const requestId = ++requestIdRef.current;
    setBusy(true);
    try {
      const next = await updateSecurityPolicy(token, apiBase, update);
      if (requestId !== requestIdRef.current) return false;
      setPolicy(next);
      setConfirmedAt(Date.now());
      setSaveError('');
      addToast({ type: 'success', title: successTitle });
      return true;
    } catch (error) {
      if (requestId !== requestIdRef.current) return false;
      setSaveError(errorMessage(error));
      return false;
    } finally {
      if (requestId === requestIdRef.current) {
        operationRef.current = null;
        setBusy(false);
      }
    }
  };

  const persistPaths = (fileAllow: string[], approval: string[]) => persistPolicy(
    { file_allow_paths: fileAllow, approval_paths: approval },
    isEnglish ? 'File security updated' : '文件安全策略已更新',
  );

  const addPath = async (kind: 'allow' | 'approval') => {
    if (!policy || operationRef.current || loadError) return;
    operationRef.current = 'pick';
    setBusy(true);
    const requestId = ++requestIdRef.current;
    let selected;
    try {
      selected = await dialogBridge.open({
        directory: true,
        multiple: false,
        title: kind === 'allow'
          ? (isEnglish ? 'Choose automatically allowed folder' : '选择自动放行目录')
          : (isEnglish ? 'Choose approval folder' : '选择强制审批目录'),
      });
    } catch (error) {
      if (requestId === requestIdRef.current) setSaveError(errorMessage(error));
    } finally {
      if (requestId === requestIdRef.current) {
        operationRef.current = null;
        setBusy(false);
      }
    }
    if (requestId !== requestIdRef.current) return;
    if (!selected || typeof selected !== 'string') return;
    const fileAllow = policy.file_allow_paths.map((item) => item.path);
    const approval = policy.approval_paths.map((item) => item.path);
    const target = kind === 'allow' ? fileAllow : approval;
    if (target.includes(selected)) return;
    target.push(selected);
    const saved = await persistPaths(fileAllow, approval);
    if (!saved && requestId + 1 === requestIdRef.current) {
      setSaveError((message) => `${selected}: ${message}`);
    }
  };

  const removePath = async (kind: 'allow' | 'approval', path: string) => {
    if (!policy || busy) return;
    const fileAllow = policy.file_allow_paths.map((item) => item.path)
      .filter((item) => kind !== 'allow' || item !== path);
    const approval = policy.approval_paths.map((item) => item.path)
      .filter((item) => kind !== 'approval' || item !== path);
    await persistPaths(fileAllow, approval);
  };

  const updateCommandRule = async (kind: 'allow' | 'approval', value: string, remove = false) => {
    if (!policy || busy) return false;
    const key = kind === 'allow' ? 'command_allow_prefixes' : 'command_approval_prefixes';
    const current = policy[key];
    const next = remove ? current.filter((item) => item !== value) : [...current, value];
    return persistPolicy(
      kind === 'allow' ? { command_allow_prefixes: next } : { command_approval_prefixes: next },
      isEnglish ? 'Command security updated' : '命令安全策略已更新',
    );
  };

  const updateNetworkRule = async (kind: 'allow' | 'deny', value: string, remove = false) => {
    if (!policy || busy) return false;
    const key = kind === 'allow' ? 'network_allow_domains' : 'network_deny_domains';
    const current = policy[key];
    const next = remove ? current.filter((item) => item !== value) : [...current, value];
    return persistPolicy(
      kind === 'allow' ? { network_allow_domains: next } : { network_deny_domains: next },
      isEnglish ? 'Network security updated' : '网络安全策略已更新',
    );
  };

  const resetOptions = {
    files: {
      title: isEnglish ? 'Restore file defaults?' : '恢复文件安全默认规则？',
      message: isEnglish ? 'Remove custom allowed folders and approval folders. Built-in protected folders remain. Command rules, network rules, and audit records are unchanged. Applies to subsequent tool calls.' : '将移除自定义自动放行目录和自定义审批目录，保留系统保护目录。命令、网络规则及审计记录不变；后续工具调用按默认规则执行。',
      update: { file_allow_paths: [], approval_paths: [] },
    },
    commands: {
      title: isEnglish ? 'Restore command defaults?' : '恢复命令安全默认规则？',
      message: isEnglish ? 'Remove all custom allow and ask prefixes. Built-in risk checks remain. File rules, network rules, and audit records are unchanged. Applies to subsequent tool calls.' : '将移除所有自定义放行前缀和询问前缀，保留内置风险检查。文件、网络规则及审计记录不变；后续工具调用按默认规则执行。',
      update: { command_allow_prefixes: [], command_approval_prefixes: [] },
    },
    network: {
      title: isEnglish ? 'Restore network defaults?' : '恢复网络安全默认规则？',
      message: isEnglish ? 'Turn off default blocking and remove allowed and denied domains. Built-in network checks remain. File rules, command rules, and audit records are unchanged. Subsequent tool requests may access more destinations.' : '将关闭默认阻断，清空允许域名和拒绝域名，保留内置网络检查。文件、命令规则及审计记录不变；后续工具请求可访问的目标可能增加。',
      update: { network_block_all: false, network_allow_domains: [], network_deny_domains: [] },
    },
  };
  const editingDisabled = busy || loading || !!loadError;
  let content;
  if (view === 'audit') content = <AuditCenter token={token} apiBase={apiBase} isEnglish={isEnglish} onBack={() => setView('overview')} />;
  else if (loading && !policy) content = <div className="settings-page-empty flex items-center justify-center"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isEnglish ? 'Loading security protection…' : '正在读取安全防护…'}</div>;
  else if (!policy) content = <div className="settings-page-empty"><FolderLock className="settings-page-muted mx-auto h-6 w-6" /><p className="mt-2">{isEnglish ? 'Security policy is unavailable' : '安全策略暂时不可用'}</p><Button size="sm" variant="ghost" className="mt-3" onClick={() => setView('audit')}><FileSearch />{isEnglish ? 'Audit center' : '审计中心'}</Button></div>;
  else if (view === 'files') content = <FileSecurityView policy={policy} busy={editingDisabled} isEnglish={isEnglish} onBack={() => setView('overview')} onAdd={(kind) => void addPath(kind)} onRemove={(kind, path) => void removePath(kind, path)} onReset={() => setResetKind('files')} />;
  else if (view === 'commands') content = (
    <CommandSecurityView
      policy={policy}
      busy={editingDisabled}
      isEnglish={isEnglish}
      onBack={() => setView('overview')}
      onAdd={(kind, value) => updateCommandRule(kind, value)}
      onRemove={(kind, value) => updateCommandRule(kind, value, true)}
      onReset={() => setResetKind('commands')}
    />
  );
  else if (view === 'network') content = (
    <NetworkSecurityView
      policy={policy}
      busy={editingDisabled}
      isEnglish={isEnglish}
      onBack={() => setView('overview')}
      onToggle={() => void persistPolicy(
        { network_block_all: !policy.network_block_all },
        isEnglish ? 'Network security updated' : '网络安全策略已更新',
      )}
      onAdd={(kind, value) => updateNetworkRule(kind, value)}
      onRemove={(kind, value) => updateNetworkRule(kind, value, true)}
      onReset={() => setResetKind('network')}
    />
  );
  else content = <SecurityOverview policy={policy} confirmedAt={confirmedAt} unconfirmed={!!loadError || !!saveError} loading={loading} busy={busy} isEnglish={isEnglish} onRefresh={() => void loadPolicy()} onOpen={setView} />;

  return <div className="settings-page security-center">
    {view !== 'audit' && (loadError || saveError) && <div role="alert" className="settings-page-alert">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <p className="font-semibold">{loadError ? (isEnglish ? 'Current policy could not be confirmed' : '无法确认当前策略') : (isEnglish ? 'Policy save unconfirmed' : '策略保存未确认')}</p>
        <p>{loadError || saveError}</p>
        <p>{loadError
          ? (policy ? (isEnglish ? 'Showing the previous snapshot. Refresh successfully before editing.' : '下方为上次读取的快照，刷新成功后可继续修改。') : (isEnglish ? 'Retry to retrieve the current policy.' : '请重试读取当前策略。'))
          : (isEnglish ? 'Retry the operation, or refresh to check what was saved.' : '请重试原操作，或刷新核对当前已保存的规则。')}</p>
      </div>
      <Button size="sm" variant="ghost" disabled={loading || busy} onClick={() => void loadPolicy()}><RefreshCw className={cn(loading && 'animate-spin')} />{loadError ? (isEnglish ? 'Retry' : '重试') : (isEnglish ? 'Check policy' : '刷新核对')}</Button>
    </div>}
    {content}
    <ConfirmDialog
      open={resetKind !== null}
      title={resetKind ? resetOptions[resetKind].title : ''}
      message={resetKind ? resetOptions[resetKind].message : ''}
      confirmText={isEnglish ? 'Restore defaults' : '确认恢复'}
      cancelText={isEnglish ? 'Cancel' : '取消'}
      onCancel={() => setResetKind(null)}
      onConfirm={() => {
        if (!resetKind || editingDisabled) return;
        const update = resetOptions[resetKind].update;
        setResetKind(null);
        void persistPolicy(update, isEnglish ? 'Defaults restored' : '已恢复默认规则');
      }}
    />
  </div>;
}

export default function SecurityProtectionSection(props: { token: string; apiBase: string; isEnglish: boolean }) {
  return <SecurityProtectionContent key={`${props.apiBase}:${props.token}`} {...props} />;
}
