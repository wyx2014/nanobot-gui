import type { SecurityAuditEvent } from '@/core/types';

const policyLabels: Record<string, [string, string]> = {
  file_allow_paths: ['文件放行路径', 'Allowed file paths'],
  approval_paths: ['强制审批路径', 'Approval paths'],
  command_allow_prefixes: ['命令放行前缀', 'Allowed commands'],
  command_approval_prefixes: ['命令审批前缀', 'Commands requiring approval'],
  network_block_all: ['默认阻断受控工具联网', 'Block covered tool requests by default'],
  network_allow_domains: ['允许域名', 'Allowed domains'],
  network_deny_domains: ['拒绝域名', 'Denied domains'],
};

export function auditDecisionLabel(value: unknown, en: boolean): string {
  const labels: Record<string, [string, string]> = {
    allow: ['策略允许', 'Allowed by policy'], allowed: ['策略允许', 'Allowed by policy'],
    require_approval: ['需要用户批准', 'Approval required'], block: ['策略阻止', 'Blocked by policy'],
    approved: ['用户已批准', 'Approved by user'], approved_for_turn: ['沿用本轮授权', 'Turn approval reused'],
    denied: ['用户已拒绝', 'Denied by user'], blocked: ['已阻止', 'Blocked'],
    blocked_unattended: ['无人值守，未获批准', 'No interactive approval'],
    timed_out: ['审批超时', 'Approval timed out'],
  };
  return labels[String(value)]?.[en ? 1 : 0] ?? String(value ?? '-');
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export default function SecurityAuditDetails({ event, isEnglish: en }: { event: SecurityAuditEvent; isEnglish: boolean }) {
  const d = event.details;
  const text = (value: unknown): string => Array.isArray(value)
    ? value.map(text).join(', ') || (en ? 'None' : '无')
    : typeof value === 'boolean' ? (value ? (en ? 'On' : '开启') : (en ? 'Off' : '关闭'))
      : value === null || value === undefined ? '-' : String(value);
  const rows: Array<[string, unknown]> = [
    [en ? 'Policy decision' : '策略判断', auditDecisionLabel(d.initial_decision || event.decision, en)],
    [en ? 'Policy reason' : '策略依据', event.summary],
    [en ? 'Matched rule' : '命中规则', event.rule_id],
    [en ? 'Authorization' : '授权结果', d.authorization ? auditDecisionLabel(d.authorization, en) : null],
    [en ? 'Approval scope' : '授权范围', d.approval_scope === 'turn' ? (en ? 'Same rule and action in this turn' : '本轮同规则、同类操作') : null],
    [en ? 'Exit code' : '退出码', d.exit_code],
    [en ? 'Response status' : '响应状态码', d.status_code],
    [en ? 'Error type' : '失败类型', d.error_type],
    [en ? 'Initiated by' : '操作发起方', d.actor === 'user' ? (en ? 'User' : '用户') : d.actor === 'agent' ? (en ? 'Agent' : '研究员或主助手') : null],
    [en ? 'Researcher' : '研究员', d.agent_label],
    [en ? 'Session' : '所属会话', event.session_id || d.session_key],
    [en ? 'Task' : '所属任务', event.turn_id],
    [en ? 'Project' : '所属项目', event.project_id],
    [en ? 'Tool' : '工具', event.tool_name],
    [en ? 'Tool call' : '操作编号', event.tool_call_id],
    [en ? 'Working directory' : '工作目录', d.working_directory],
    [en ? 'Approval ID' : '审批编号', d.approval_id],
    [en ? 'Process session' : '命令会话', d.process_session_id],
    [en ? 'Server' : '服务', d.server || d.provider],
    [en ? 'Model' : '模型', d.model],
    [en ? 'Destination' : '请求目标', d.destination_known === false && !object(d.http_activity).request_count ? (en ? 'Unknown' : '未知') : null],
    [en ? 'Exported records' : '导出条数', d.exported_count],
    [en ? 'Export outcome' : '导出结果', d.export_stage === 'generated' ? (en ? 'File generated; local save is unconfirmed' : '文件已生成，本地保存结果未确认') : null],
    [en ? 'Deleted records' : '清空条数', d.deleted_count],
    [en ? 'Last recorded' : '最后记录时间', typeof d.last_timestamp === 'number' ? new Date(d.last_timestamp).toLocaleString(en ? 'en' : 'zh-CN') : null],
  ];
  const dataLabels: Record<string, [string, string]> = {
    tool_arguments: ['工具参数', 'Tool arguments'], search_terms: ['搜索词', 'Search terms'],
    url: ['网页地址', 'URL'], conversation_context: ['会话上下文', 'Conversation context'],
    tool_definitions: ['工具定义', 'Tool definitions'],
  };
  if (Array.isArray(d.data_categories)) rows.push([en ? 'Request data' : '请求数据类型', d.data_categories.map((value) => dataLabels[String(value)]?.[en ? 1 : 0] ?? value)]);
  const paths = Array.isArray(d.paths) ? d.paths : [];
  const lifecycle = Array.isArray(d.lifecycle) ? d.lifecycle : [];
  const http = object(d.http_activity);
  const requests = Array.isArray(http.requests) ? http.requests : [];
  const changes = Object.entries(object(d.changes));
  const stageLabels: Record<string, [string, string]> = {
    pending: ['记录操作意图', 'Operation recorded'], executing: ['批准后开始执行', 'Execution authorized'],
    succeeded: ['操作完成', 'Completed'], failed: ['操作失败', 'Failed'], running: ['进程仍在运行', 'Process running'],
    cancelled: ['操作取消', 'Cancelled'], timed_out: ['超时', 'Timed out'], blocked: ['操作被阻止', 'Blocked'],
    denied: ['用户拒绝', 'Denied'], blocked_unattended: ['无人值守阻止', 'Blocked unattended'],
    waiting_for_input: ['等待输入', 'Waiting for input'],
  };
  return (
    <div className="security-details @container space-y-4 pt-3 text-[13px] leading-5 [overflow-wrap:anywhere]">
      {event.target && <div>
        <p data-audit-target-label className="mb-1 font-medium">{event.category === 'command' ? (en ? 'Command / target' : '命令 / 目标') : (en ? 'Target' : '操作目标')}</p>
        <p data-audit-full-target className="select-text whitespace-pre-wrap font-mono text-[12px] leading-5">{event.target}</p>
      </div>}
      <dl className="grid gap-x-8 gap-y-2 @min-[620px]:grid-cols-2">
        {rows.filter(([, value]) => value !== undefined && value !== null && value !== '').map(([label, value]) => (
          <div key={label} className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)] gap-x-3"><dt>{label}</dt><dd className="min-w-0 select-text whitespace-pre-wrap">{text(value)}</dd></div>
        ))}
      </dl>
      {paths.length > 0 && <div><p className="font-medium">{en ? 'File paths' : '文件路径'}{d.paths_truncated ? (en ? ' (first 20)' : '（前 20 个）') : ''}</p><ul>{paths.map((path, index) => <li key={index} className="font-mono">{text(path)}</li>)}</ul></div>}
      {changes.length > 0 && <div className="space-y-2">{changes.map(([key, change]) => <div key={key}>
        <p className="font-medium">{policyLabels[key]?.[en ? 1 : 0] || key}</p>
        <p>{en ? 'Before: ' : '变更前：'}{text(object(change).before)}</p><p>{en ? 'After: ' : '变更后：'}{text(object(change).after)}</p>
      </div>)}</div>}
      {requests.length > 0 && <div><p className="font-medium">{en ? 'HTTP requests' : 'HTTP 请求'} ({text(http.request_count)})</p>
        <ul>{requests.map((request, index) => { const r = object(request); return <li key={index} className="font-mono">{text(r.method)} {text(r.url)} · {r.status_code ? text(r.status_code) : (en ? 'No response recorded' : '未记录响应')}</li>; })}</ul>
      </div>}
      {lifecycle.length > 0 && <ol className="border-t pt-2">{lifecycle.map((stage, index) => {
        const s = object(stage);
        return <li key={index} className="flex flex-wrap gap-x-3"><time className="settings-page-caption">{typeof s.timestamp === 'number' ? new Date(s.timestamp).toLocaleTimeString(en ? 'en' : 'zh-CN') : '-'}</time><span>{stageLabels[String(s.result)]?.[en ? 1 : 0] || text(s.result)}</span></li>;
      })}</ol>}
    </div>
  );
}
