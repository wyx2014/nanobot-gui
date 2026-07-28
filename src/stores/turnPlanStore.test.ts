import { beforeEach, describe, expect, it } from 'vitest';
import { useTurnPlanStore } from './turnPlanStore';
import type { Message } from '@/types';
import type { TurnPlanResource } from '@/core/types';

function plan(
  revision: number,
  status: TurnPlanResource['status'] = 'running',
  turnId = 'turn-1',
): TurnPlanResource {
  return {
    id: `plan:${turnId}`,
    turn_id: turnId,
    kind: 'dynamic',
    owner: 'agent',
    policy: 'required',
    execution: 'serial',
    status,
    revision,
    active_step_ids: status === 'running' ? ['research'] : [],
    steps: [
      {
        id: 'research',
        title: '完成研究',
        status: status === 'completed' ? 'completed' : 'running',
      },
      {
        id: 'delivery',
        title: '交付报告',
        status: status === 'completed' ? 'completed' : 'pending',
      },
    ],
  };
}

describe('turnPlanStore', () => {
  beforeEach(() => {
    useTurnPlanStore.setState({
      planByConversation: {},
      currentTurnByConversation: {},
    });
  });

  it('keeps the latest authoritative revision', () => {
    const store = useTurnPlanStore.getState();
    store.applyPlan('chat-1', plan(2, 'completed'));
    store.applyPlan('chat-1', plan(1, 'running'));

    expect(useTurnPlanStore.getState().planByConversation['chat-1']?.revision).toBe(2);
    expect(useTurnPlanStore.getState().planByConversation['chat-1']?.status).toBe('completed');
  });

  it('accepts a terminal correction at the same revision', () => {
    const store = useTurnPlanStore.getState();
    store.applyPlan('chat-1', plan(7, 'running'));
    store.applyPlan('chat-1', plan(7, 'completed'));

    expect(useTurnPlanStore.getState().planByConversation['chat-1']).toMatchObject({
      revision: 7,
      status: 'completed',
      active_step_ids: [],
      steps: [
        { id: 'research', status: 'completed' },
        { id: 'delivery', status: 'completed' },
      ],
    });
  });

  it('does not reopen a terminal plan at the same revision', () => {
    const store = useTurnPlanStore.getState();
    store.applyPlan('chat-1', plan(7, 'completed'));
    store.applyPlan('chat-1', plan(7, 'running'));

    expect(useTurnPlanStore.getState().planByConversation['chat-1']?.status).toBe('completed');
  });

  it('hydrates one latest legacy snapshot when no resource exists', () => {
    const messages: Message[] = [
      {
        id: 'user',
        role: 'user',
        content: '研究公司',
        timestamp: Date.now(),
      },
      {
        id: 'plan-1',
        role: 'tool',
        content: '',
        timestamp: Date.now(),
        agentUI: {
          kind: 'task_progress',
          turn_id: 'turn-1',
          revision: 1,
          steps: [
            { id: 'research', title: '完成研究', status: 'running' },
            { id: 'delivery', title: '交付报告', status: 'pending' },
          ],
        },
      },
      {
        id: 'plan-2',
        role: 'tool',
        content: '',
        timestamp: Date.now(),
        agentUI: {
          kind: 'task_progress',
          turn_id: 'turn-1',
          revision: 2,
          steps: [
            { id: 'research', title: '完成研究', status: 'completed' },
            { id: 'delivery', title: '交付报告', status: 'running' },
          ],
        },
      },
    ];

    useTurnPlanStore.getState().hydrateLegacyMessages('chat-1', 'chat-1', messages, 'turn-1');

    const hydrated = useTurnPlanStore.getState().planByConversation['chat-1'];
    expect(hydrated?.revision).toBe(2);
    expect(hydrated?.active_step_ids).toEqual(['delivery']);
  });

  it('clears a deleted conversation', () => {
    useTurnPlanStore.getState().applyPlan('chat-1', plan(1));
    useTurnPlanStore.getState().clearConversation('chat-1');

    expect(useTurnPlanStore.getState().planByConversation['chat-1']).toBeUndefined();
    expect(useTurnPlanStore.getState().currentTurnByConversation['chat-1']).toBeUndefined();
  });

  it('replaces the previous plan when a new turn restarts revision at one', () => {
    const store = useTurnPlanStore.getState();
    store.activateTurn('chat-1', 'turn-1');
    store.applyPlan('chat-1', plan(8, 'completed', 'turn-1'));

    store.activateTurn('chat-1', 'turn-2');
    expect(useTurnPlanStore.getState().planByConversation['chat-1']).toBeUndefined();

    store.applyPlan('chat-1', plan(1, 'running', 'turn-2'));
    const current = useTurnPlanStore.getState().planByConversation['chat-1'];
    expect(current?.turn_id).toBe('turn-2');
    expect(current?.revision).toBe(1);
  });

  it('rejects a late plan event from the previous turn', () => {
    const store = useTurnPlanStore.getState();
    store.activateTurn('chat-1', 'turn-2');
    store.applyPlan('chat-1', plan(1, 'running', 'turn-2'));
    store.applyPlan('chat-1', plan(99, 'completed', 'turn-1'));

    expect(useTurnPlanStore.getState().planByConversation['chat-1']).toMatchObject({
      turn_id: 'turn-2',
      revision: 1,
      status: 'running',
    });
  });

  it('rejects legacy plan messages owned by another conversation', () => {
    const messages: Message[] = [{
      id: 'foreign-plan',
      role: 'tool',
      content: '',
      timestamp: Date.now(),
      agentUI: {
        kind: 'task_progress',
        turn_id: 'turn-a',
        revision: 1,
        steps: [{ id: 'research', title: 'A 会话计划', status: 'running' }],
      },
    }];

    useTurnPlanStore.getState().hydrateLegacyMessages(
      'chat-b',
      'chat-a',
      messages,
      'chat-b',
    );

    expect(useTurnPlanStore.getState().planByConversation['chat-b']).toBeUndefined();
    expect(useTurnPlanStore.getState().currentTurnByConversation['chat-b']).toBeUndefined();
  });

  it('repairs a stale cached turn from correctly scoped canonical history', () => {
    const store = useTurnPlanStore.getState();
    store.activateTurn('chat-b', 'turn-a');
    store.applyPlan('chat-b', plan(9, 'completed', 'turn-a'));

    const messages: Message[] = [{
      id: 'chat-b-plan',
      role: 'tool',
      content: '',
      timestamp: Date.now(),
      agentUI: {
        kind: 'task_progress',
        turn_id: 'turn-b',
        revision: 2,
        steps: [{ id: 'research', title: 'B 会话计划', status: 'running' }],
      },
    }];

    store.hydrateLegacyMessages('chat-b', 'chat-b', messages, 'chat-b');

    expect(useTurnPlanStore.getState().currentTurnByConversation['chat-b']).toBe('turn-b');
    expect(useTurnPlanStore.getState().planByConversation['chat-b']).toMatchObject({
      turn_id: 'turn-b',
      revision: 2,
      steps: [{ title: 'B 会话计划' }],
    });
  });
});
