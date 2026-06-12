import { describe, expect, it } from 'vitest';
import type { Message } from '@/types';
import { normalizeFileEditToolTraces } from './toolTraceMerge';

function trace(partial: Partial<Message> & Pick<Message, 'id'>): Message {
  return {
    id: partial.id,
    role: 'tool',
    kind: 'trace',
    content: '',
    timestamp: 1,
    loopId: 'loop-1',
    ...partial,
  };
}

describe('normalizeFileEditToolTraces', () => {
  it('removes file-edit tool hints covered by file_edit activity', () => {
    const messages = normalizeFileEditToolTraces([
      trace({
        id: 'tool-1',
        content: 'Using edit_file',
        traces: ['Using edit_file'],
        toolEvents: [
          { phase: 'start', call_id: 'call-1', name: 'edit_file', arguments: { path: '/tmp/a.ts' } },
        ],
      }),
      trace({
        id: 'file-1',
        fileEdits: [
          {
            call_id: 'call-1',
            tool: 'edit_file',
            path: '/tmp/a.ts',
            operation: 'edit',
            phase: 'end',
            status: 'done',
            added: 2,
            deleted: 1,
          },
        ],
      }),
    ]);

    expect(messages.map((message) => message.id)).toEqual(['file-1']);
    expect(messages[0].fileEdits).toHaveLength(1);
  });

  it('keeps non-file-edit tool hints', () => {
    const messages = normalizeFileEditToolTraces([
      trace({
        id: 'tool-1',
        content: 'Using web_search',
        traces: ['Using web_search'],
        toolEvents: [
          { phase: 'start', call_id: 'call-1', name: 'web_search', arguments: { q: 'nanobot' } },
        ],
      }),
      trace({
        id: 'file-1',
        fileEdits: [
          {
            call_id: 'call-2',
            tool: 'edit_file',
            path: '/tmp/a.ts',
            operation: 'edit',
            phase: 'end',
            status: 'done',
            added: 1,
            deleted: 0,
          },
        ],
      }),
    ]);

    expect(messages.map((message) => message.id)).toEqual(['tool-1', 'file-1']);
  });

  it('merges repeated file edit trace rows with the same call id', () => {
    const messages = normalizeFileEditToolTraces([
      trace({
        id: 'file-start',
        fileEdits: [
          {
            call_id: 'call-1',
            tool: 'edit_file',
            path: '/tmp/a.ts',
            operation: 'edit',
            phase: 'start',
            status: 'editing',
            added: 0,
            deleted: 0,
          },
        ],
      }),
      trace({
        id: 'file-end',
        fileEdits: [
          {
            call_id: 'call-1',
            tool: 'edit_file',
            path: '/tmp/a.ts',
            operation: 'edit',
            phase: 'end',
            status: 'done',
            added: 3,
            deleted: 1,
          },
        ],
      }),
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('file-start');
    expect(messages[0].fileEdits?.[0]).toMatchObject({ status: 'done', added: 3, deleted: 1 });
  });
});

