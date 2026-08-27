import { notificationBridge } from '@/lib/ipc-factory';
import { format, getI18n } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';

let permissionGranted = false;

function canSendNotification(): boolean {
  return permissionGranted && useSettingsStore.getState().desktopNotificationsEnabled;
}

/**
 * Initialize notification permissions on app startup
 */
export async function initNotifications(): Promise<boolean> {
  try {
    console.log('[Notification] Checking permission...');
    permissionGranted = await notificationBridge.isPermissionGranted();
    console.log('[Notification] Permission granted:', permissionGranted);

    if (!permissionGranted) {
      console.log('[Notification] Requesting permission...');
      const permission = await notificationBridge.requestPermission();
      console.log('[Notification] Permission result:', permission);
      permissionGranted = permission === 'granted';
    }

    console.log('[Notification] Final permission state:', permissionGranted);
    return permissionGranted;
  } catch (err) {
    console.warn('[Notification] Failed to initialize:', err);
    return false;
  }
}

/**
 * Send a task completion notification
 */
export async function notifyTaskCompleted(
  conversationTitle: string,
  conversationId?: string,
): Promise<void> {
  if (!canSendNotification()) return;

  try {
    await notificationBridge.sendNotification({
      title: '任务已完成',
      body: conversationTitle.trim()
        ? `「${conversationTitle.trim()}」已成功完成，您可以在当前会话中查看结果。`
        : '任务已成功完成，您可以在当前会话中查看结果。',
      ...(conversationId ? { conversationId } : {}),
    });
  } catch (err) {
    console.warn('[Notification] Failed to send:', err);
  }
}

/**
 * Send a scheduled task completion notification
 */
export async function notifyScheduledTaskCompleted(
  taskName: string,
  scheduleTaskId?: string,
  runId?: string,
): Promise<void> {
  if (!canSendNotification()) return;
  try {
    const t = getI18n();
    await notificationBridge.sendNotification({
      title: t.schedule.title,
      body: format(t.schedule.taskCompleted, { name: taskName }),
      ...(scheduleTaskId && runId ? { scheduleTaskId, runId } : {}),
    });
  } catch (err) {
    console.warn('[Notification] Failed to send:', err);
  }
}

/**
 * Send a scheduled task error notification
 */
export async function notifyScheduledTaskError(
  taskName: string,
  scheduleTaskId?: string,
  runId?: string,
): Promise<void> {
  if (!canSendNotification()) return;
  try {
    const t = getI18n();
    await notificationBridge.sendNotification({
      title: t.schedule.title,
      body: format(t.schedule.taskError, { name: taskName }),
      ...(scheduleTaskId && runId ? { scheduleTaskId, runId } : {}),
    });
  } catch (err) {
    console.warn('[Notification] Failed to send:', err);
  }
}

/**
 * Send an error notification
 */
export async function notifyTaskError(conversationTitle: string): Promise<void> {
  if (!canSendNotification()) {
    return;
  }

  try {
    await notificationBridge.sendNotification({
      title: '哎呀出错了',
      body: `「${conversationTitle}」执行出错了 😢`,
    });
  } catch (err) {
    console.warn('[Notification] Failed to send:', err);
  }
}
