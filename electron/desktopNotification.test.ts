import { describe, expect, it, vi } from 'vitest';
import {
  normalizeDesktopNotificationInput,
  showDesktopNotification,
  type NativeNotificationLike,
} from './desktopNotification';

describe('desktop notifications', () => {
  it('normalizes whitespace and bounds operating-system text', () => {
    const result = normalizeDesktopNotificationInput({
      title: '  TPACowork   任务完成  ',
      body: `结果  ${'很长'.repeat(200)}`,
      conversationId: ' chat-1 ',
    });

    expect(result?.title).toBe('TPACowork 任务完成');
    expect(result?.body?.length).toBeLessThanOrEqual(240);
    expect(result?.conversationId).toBe('chat-1');
  });

  it('shows a supported notification and activates its conversation on click', () => {
    let click: (() => void) | undefined;
    const native = {
      on: vi.fn((_event: 'click', listener: () => void) => {
        click = listener;
      }),
      show: vi.fn(),
    } satisfies NativeNotificationLike;
    const activate = vi.fn();

    expect(showDesktopNotification(
      { title: '任务完成', body: '长江电力分析已完成', conversationId: 'chat-1' },
      {
        supported: true,
        create: vi.fn(() => native),
        activate,
      },
    )).toEqual({ shown: true });
    expect(native.show).toHaveBeenCalledOnce();

    click?.();
    expect(activate).toHaveBeenCalledWith('chat-1');
  });

  it('does not create a notification on unsupported systems', () => {
    const create = vi.fn();
    expect(showDesktopNotification('任务完成', {
      supported: false,
      create,
      activate: vi.fn(),
    })).toEqual({ shown: false, reason: 'unsupported' });
    expect(create).not.toHaveBeenCalled();
  });
});
