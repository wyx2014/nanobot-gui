import { beforeEach, describe, expect, it, vi } from 'vitest';

const notificationMocks = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));

vi.mock('@/lib/ipc-factory', () => ({
  notificationBridge: notificationMocks,
}));

import { useSettingsStore } from '@/stores/settingsStore';
import { initNotifications, notifyTaskCompleted } from './notifications';

describe('desktop notification preference', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    notificationMocks.isPermissionGranted.mockResolvedValue(true);
    notificationMocks.sendNotification.mockResolvedValue({ shown: true });
    useSettingsStore.setState({ desktopNotificationsEnabled: true });
    await initNotifications();
  });

  it('does not send completion notifications when the setting is disabled', async () => {
    useSettingsStore.setState({ desktopNotificationsEnabled: false });

    await notifyTaskCompleted('测试任务', 'chat-1');

    expect(notificationMocks.sendNotification).not.toHaveBeenCalled();
  });

  it('sends completion notifications when permission and the setting allow it', async () => {
    await notifyTaskCompleted('测试任务', 'chat-1');

    expect(notificationMocks.sendNotification).toHaveBeenCalledOnce();
  });
});
