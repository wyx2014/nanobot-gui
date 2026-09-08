// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { analyzeDiagnosticEvents } from './analysis';

describe('diagnostic evidence report', () => {
  it('pairs rotated operation records by identity and does not infer failure from missing ends', () => {
    const event = (seq: number, status: string, operation: string, extra = {}) => ({ event_name: 'llm.attempt',
      timestamp: '2026-09-08T00:00:00Z', source_file: 'events/gateway.jsonl', source_record_id: seq,
      details: { process_instance_id: 'gateway-one', process_seq: seq, operation_id: operation, status, ...extra } });
    const report = analyzeDiagnosticEvents([
      event(2, 'failed', 'op-one', { incident_id: 'incident-one', incident_snapshot: { captured_at: '2026-09-08T00:00:00Z' } }),
      event(1, 'started', 'op-one'), event(3, 'started', 'op-two'), event(4, 'completed', 'op-three'),
    ]);
    expect(report.operations[0]).toMatchObject({ operation_id: 'op-one', status: 'failed', start_observed: true,
      evidence: [{ line: 1 }, { line: 2 }] });
    expect(report.failures).toHaveLength(1);
    expect(report.missing_end_events).toHaveLength(1);
    expect(report.missing_end_events[0]).toMatchObject({ operation_id: 'op-two', status: 'end_not_observed' });
    expect(report.incidents[0]).toMatchObject({ evidence: { file: 'events/gateway.jsonl', line: 2 } });
  });
});
