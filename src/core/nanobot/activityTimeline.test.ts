import { describe, expect, it } from 'vitest';
import type { Message } from '@/types';
import {
  activityEvidenceFromMessageMedia,
  createActivityTimelineProjector,
  normalizeActivityTimeline,
} from './activityTimeline';

function msg(partial: Partial<Message> & Pick<Message, 'id' | 'role'>): Message {
  return {
    content: '',
    timestamp: 1,
    ...partial,
  };
}

describe('normalizeActivityTimeline', () => {
  it('reuses completed turn units while a streaming assistant turn changes', () => {
    const user = msg({ id: 'u1', role: 'user', content: 'question' });
    const completed = msg({ id: 'a1', role: 'assistant', content: 'previous answer' });
    const activeStart = msg({ id: 'u2', role: 'user', content: 'next question' });
    const projector = createActivityTimelineProjector();
    const first = projector.project([user, completed, activeStart, msg({ id: 'stream', role: 'assistant', content: 'part' })]);
    const second = projector.project([user, completed, activeStart, msg({ id: 'stream', role: 'assistant', content: 'partial answer' })]);

    expect(second.slice(0, 3)).toEqual(first.slice(0, 3));
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
    expect(second[2]).toBe(first[2]);
    expect(second[3]).not.toBe(first[3]);
  });

  it('keeps reasoning and tool rows before the answer as an activity unit', () => {
    const units = normalizeActivityTimeline([
      msg({ id: 'u1', role: 'user', content: 'question' }),
      msg({ id: 'r1', role: 'assistant', content: '', thinking: 'thinking' }),
      msg({ id: 't1', role: 'tool', kind: 'trace', content: 'Using search', traces: ['Using search'] }),
      msg({ id: 'a1', role: 'assistant', content: 'answer' }),
    ]);

    expect(units.map((unit) => unit.type)).toEqual(['message', 'activity', 'message']);
    expect(units[1].type === 'activity' ? units[1].messages.map((message) => message.id) : []).toEqual(['r1', 't1']);
  });

  it('splits inline assistant reasoning into activity before the visible answer', () => {
    const units = normalizeActivityTimeline([
      msg({ id: 'u1', role: 'user', content: 'question' }),
      msg({ id: 'a1', role: 'assistant', content: 'answer', thinking: 'final thought' }),
    ]);

    expect(units.map((unit) => unit.type)).toEqual(['message', 'activity', 'message']);
    expect(units[1].type === 'activity' ? units[1].messages[0]?.id : '').toBe('a1-reasoning');
    expect(units[2].type === 'message' ? units[2].message.thinking : undefined).toBeUndefined();
  });

  it('keeps late activity after an assistant answer', () => {
    const units = normalizeActivityTimeline([
      msg({ id: 'u1', role: 'user', content: 'question' }),
      msg({ id: 'a1', role: 'assistant', content: 'partial answer' }),
      msg({ id: 't1', role: 'tool', kind: 'trace', content: 'Using tool', traces: ['Using tool'] }),
      msg({ id: 'a2', role: 'assistant', content: 'final answer' }),
    ]);

    expect(units.map((unit) => unit.type)).toEqual(['message', 'message', 'activity', 'message']);
    expect(units[2].type === 'activity' ? units[2].messages.map((message) => message.id) : []).toEqual(['t1']);
  });

  it('ignores empty assistant placeholders between activity rows', () => {
    const units = normalizeActivityTimeline([
      msg({ id: 'u1', role: 'user', content: 'question' }),
      msg({ id: 't1', role: 'tool', kind: 'trace', content: 'Using search', traces: ['Using search'] }),
      msg({ id: 'empty', role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'search', input: {}, isExecuting: true }] }),
      msg({ id: 't2', role: 'tool', kind: 'trace', content: 'Using browser', traces: ['Using browser'] }),
      msg({ id: 'a1', role: 'assistant', content: 'answer' }),
    ]);

    expect(units.map((unit) => unit.type)).toEqual(['message', 'activity', 'message']);
    expect(units[1].type === 'activity' ? units[1].messages.map((message) => message.id) : []).toEqual(['t1', 't2']);
  });

  it('separates file edit activity from ordinary tool activity', () => {
    const units = normalizeActivityTimeline([
      msg({ id: 'u1', role: 'user', content: 'edit' }),
      msg({ id: 'r1', role: 'assistant', content: '', thinking: 'plan' }),
      msg({
        id: 'f1',
        role: 'tool',
        kind: 'trace',
        content: '',
        fileEdits: [{ tool: 'edit_file', path: '/tmp/a.ts', operation: 'update', status: 'done' }],
      }),
    ]);

    expect(units.map((unit) => unit.type)).toEqual(['message', 'activity', 'activity']);
    expect(units[1].type === 'activity' ? units[1].messages.map((message) => message.id) : []).toEqual(['r1']);
    expect(units[2].type === 'activity' ? units[2].messages.map((message) => message.id) : []).toEqual(['f1']);
    expect(units[1].type === 'activity' ? units[1].items.map((item) => item.type) : []).toEqual(['reasoning']);
    expect(units[2].type === 'activity' ? units[2].items.map((item) => item.type) : []).toEqual(['file_edit']);
  });

  it('classifies tool events and media attachments as structured activity items', () => {
    const units = normalizeActivityTimeline([
      msg({ id: 'u1', role: 'user', content: 'chart' }),
      msg({
        id: 't1',
        role: 'tool',
        kind: 'trace',
        content: 'Using web_search',
        toolEvents: [{ phase: 'end', call_id: 'call-1', name: 'web_search', result: 'ok' }],
        mediaAttachments: [{ url: '/api/media/chart.svg', name: 'chart.svg', kind: 'image' }],
      }),
    ]);

    expect(units[1].type === 'activity' ? units[1].items.map((item) => item.type) : []).toEqual(['tool', 'media']);
    expect(units[1].type === 'activity' ? units[1].turnLatencyMs : undefined).toBeUndefined();
  });

  it('creates media evidence from message attachments', () => {
    const message = msg({
      id: 'm1',
      role: 'tool',
      mediaAttachments: [{ path: '/tmp/chart.svg', name: 'chart.svg', kind: 'image' }],
    });

    expect(activityEvidenceFromMessageMedia(message)).toEqual([
      {
        id: 'm1:media:0:/tmp/chart.svg',
        attachment: { path: '/tmp/chart.svg', name: 'chart.svg', kind: 'image' },
        caption: 'chart.svg',
        source: 'media',
      },
    ]);
  });
});
