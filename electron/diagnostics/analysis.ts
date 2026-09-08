/** Deterministic evidence projection. Missing end events are gaps, never inferred failures. */
type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const evidence = (row: Row) => ({ file: row.source_file, line: row.source_record_id, event_id: row.event_id ?? object(row.details).event_id });

export function analyzeDiagnosticEvents(events: Row[], spans: Row[] = []) {
  const groups = new Map<string, Row[]>();
  const incidents: Row[] = [];
  for (const row of events) {
    const detail = object(row.details);
    const process = row.process_instance_id ?? detail.process_instance_id ?? 'unknown';
    const identity = detail.operation_id ?? row.span_id ?? row.request_id ?? row.client_action_id ?? detail.client_action_id
      ?? (String(row.event_name).startsWith('turn.') ? row.turn_id : undefined);
    if (identity && row.event_name) {
      const key = `${process}:${identity}:${row.event_name}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    if (detail.incident_id && detail.incident_snapshot) incidents.push({ incident_id: detail.incident_id,
      kind: 'failure_time_snapshot', captured_at: object(detail.incident_snapshot).captured_at,
      event_name: row.event_name, session_id: row.session_id, turn_id: row.turn_id, trace_id: row.trace_id,
      snapshot: detail.incident_snapshot, recent_event_ids: detail.recent_event_ids, evidence: evidence(row) });
  }
  const operations: Row[] = [];
  for (const [id, rows] of groups) {
    // File rotation changes read order. Use the producer sequence within each operation.
    rows.sort((a, b) => Number(a.process_seq ?? object(a.details).process_seq ?? 0) - Number(b.process_seq ?? object(b.details).process_seq ?? 0));
    const status = (row: Row) => row.status ?? object(row.details).status;
    const start = rows.find((row) => status(row) === 'started');
    const terminal = rows.findLast((row) => ['completed', 'failed', 'cancelled', 'abandoned'].includes(String(status(row))));
    const last = terminal ?? rows.at(-1)!;
    const detail = object(last.details);
    operations.push({ id, operation_id: detail.operation_id, parent_operation_id: detail.parent_operation_id,
      event_name: last.event_name, trace_id: last.trace_id, turn_id: last.turn_id,
      client_action_id: last.client_action_id ?? detail.client_action_id,
      status: terminal ? status(terminal) : 'end_not_observed', start_observed: Boolean(start),
      error_category: detail.error_category, error_code: last.error_code ?? detail.error_code,
      duration_ms: last.duration_ms, stage: detail.stage,
      evidence: [start, terminal ?? last].filter((row, index, all) => row && all.indexOf(row) === index).map((row) => evidence(row!)) });
  }
  const failures = events.filter((row) => row.level === 'error' || (row.status ?? object(row.details).status) === 'failed')
    .map((row) => ({ event_name: row.event_name, timestamp: row.timestamp, trace_id: row.trace_id,
      error_category: object(row.details).error_category ?? 'unknown', error_code: row.error_code ?? object(row.details).error_code,
      evidence: evidence(row) }));
  const slowest = operations.filter((row) => typeof row.duration_ms === 'number')
    .sort((a, b) => Number(b.duration_ms) - Number(a.duration_ms)).slice(0, 20);
  const missingEnds = operations.filter((row) => row.status === 'end_not_observed' && row.start_observed).slice(0, 100);
  const spanLinks = spans.slice(0, 3000).map((row, index) => ({ id: row.id, parent_span_id: row.parent_span_id,
    run_id: row.run_id, trace_id: row.trace_id, status: row.status, duration_ms: row.duration_ms,
    evidence: { file: 'traces/spans.jsonl', line: index + 1 } }));
  return { schema_version: 1, kind: 'deterministic_evidence_report',
    limits: { operations: 1000, failures: 100, incidents: 100, spans: 3000 },
    counts: { operations: operations.length, failures: failures.length, incidents: incidents.length, spans: spans.length },
    truncated: operations.length > 1000 || failures.length > 100 || incidents.length > 100 || spans.length > 3000,
    operations: operations.slice(-1000), failures: failures.slice(-100), incidents: incidents.slice(-100),
    slowest_operations: slowest, missing_end_events: missingEnds, span_links: spanLinks,
    interpretation: '关联来自显式 ID；耗时可能重叠，不能相加。缺少终态可能是仍在运行、范围裁剪或采集丢失。失败事件不等于已确认根因。' };
}

export function evidenceSummary(report: ReturnType<typeof analyzeDiagnosticEvents>): string {
  const rows = report.slowest_operations.map((row) => `- ${row.event_name}${row.stage ? ` (${row.stage})` : ''}: ${row.duration_ms} ms — ${
    (row.evidence as Array<{ file: string; line: number }>).map((item) => `${item.file}:${item.line}`).join(', ')}`);
  return `\n\n## 执行证据摘要\n\n已关联 ${report.counts.operations} 个操作，记录 ${report.counts.incidents} 份故障快照。${report.truncated ? '摘要达到容量上限，详见原始事件。' : ''}\n\n${report.interpretation}\n\n## 耗时最长的操作\n\n${rows.join('\n') || '所选范围没有可用耗时记录。'}\n\n详细关联、失败索引和未观察到终态的操作见 analysis/evidence.json；故障快照见 snapshots/incidents.json。\n`;
}
