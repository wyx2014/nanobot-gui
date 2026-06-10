import { notificationBridge } from '@/lib/ipc-factory';

let permissionGranted = false;

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
export async function notifyTaskCompleted(conversationTitle: string): Promise<void> {
  console.log('[Notification] Attempting to send completion notification, permission:', permissionGranted);

  if (!permissionGranted) {
    console.log('[Notification] Skipping - no permission');
    return;
  }

  try {
    console.log('[Notification] Sending notification for:', conversationTitle);
    await notificationBridge.sendNotification({
      title: '太资如意完成啦！',
      body: `「${conversationTitle}」已完成 ✨`,
    });
    console.log('[Notification] Notification sent successfully');
  } catch (err) {
    console.warn('[Notification] Failed to send:', err);
  }
}

/**
 * Send a scheduled task completion notification
 */
export async function notifyScheduledTaskCompleted(taskName: string): Promise<void> {
  if (!permissionGranted) return;
  try {
    await notificationBridge.sendNotification({
      title: '定时任务完成',
      body: `「${taskName}」已执行完成 ✨`,
    });
  } catch (err) {
    console.warn('[Notification] Failed to send:', err);
  }
}

/**
 * Send a scheduled task error notification
 */
export async function notifyScheduledTaskError(taskName: string): Promise<void> {
  if (!permissionGranted) return;
  try {
    await notificationBridge.sendNotification({
      title: '定时任务出错',
      body: `「${taskName}」执行出错了 😢`,
    });
  } catch (err) {
    console.warn('[Notification] Failed to send:', err);
  }
}

/**
 * Send an error notification
 */
export async function notifyTaskError(conversationTitle: string): Promise<void> {
  if (!permissionGranted) {
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
