import { useScheduleStore } from '../../stores/scheduleStore';
import { useChatStore } from '../../stores/chatStore';
import { useToastStore } from '../../stores/toastStore';
import { sendNanobotMessage } from '../nanobot/chatBridge';
import {
  notifyScheduledTaskCompleted,
  notifyScheduledTaskError,
} from '../../utils/notifications';
import { getI18n, format } from '../../i18n';
import type { ScheduledTask } from '../../types/schedule';

const TICK_INTERVAL_MS = 60_000; // 60 seconds

class SchedulerEngine {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private runningTasks = new Set<string>();

  start() {
    if (this.intervalId) return;
    console.log('[Scheduler] Engine started');
    // Run an initial tick immediately to catch missed tasks
    this.tick();
    this.intervalId = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('[Scheduler] Engine stopped');
    }
  }

  private tick() {
    const store = useScheduleStore.getState();
    const dueTasks = store.getDueTasks(Date.now());

    for (const task of dueTasks) {
      if (!this.runningTasks.has(task.id)) {
        // Mark as running synchronously to prevent next tick from double-starting
        this.runningTasks.add(task.id);
        this.executeTask(task);
      }
    }
  }

  private async executeTask(task: ScheduledTask) {
    console.log(`[Scheduler] Executing task: ${task.name} (${task.id})`);

    const chatStore = useChatStore.getState();
    const scheduleStore = useScheduleStore.getState();

    // Create a new conversation for this run (skipActivate to avoid disturbing user)
    const conversationId = chatStore.createConversation(
      task.workspacePath ?? null,
      { scheduledTaskId: task.id, skipActivate: true }
    );

    // Set conversation title
    const timeStr = new Date().toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    chatStore.renameConversation(conversationId, `[定时] ${task.name} - ${timeStr}`);

    // Start run tracking
    const runId = scheduleStore.startRun(task.id, conversationId);

    // Build the prompt
    let prompt = task.prompt;
    if (task.skillName) {
      prompt = `/${task.skillName} ${prompt}`;
    }

    try {
      await sendNanobotMessage(conversationId, prompt);
      useScheduleStore.getState().completeRun(task.id, runId);
      notifyScheduledTaskCompleted(task.name);
      const t = getI18n();
      useToastStore.getState().addToast({
        type: 'success',
        title: format(t.schedule.taskCompleted, { name: task.name }),
      });
      console.log(`[Scheduler] Task completed: ${task.name}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      useScheduleStore.getState().errorRun(task.id, runId, errorMsg);
      notifyScheduledTaskError(task.name);
      const t = getI18n();
      useToastStore.getState().addToast({
        type: 'error',
        title: format(t.schedule.taskError, { name: task.name }),
        message: errorMsg.slice(0, 100),
      });
      console.error(`[Scheduler] Task error: ${task.name}`, err);
    } finally {
      this.runningTasks.delete(task.id);
    }
  }

  async runNow(taskId: string) {
    const store = useScheduleStore.getState();
    const task = store.tasks[taskId];
    if (!task) {
      console.warn(`[Scheduler] Task not found: ${taskId}`);
      return;
    }
    if (this.runningTasks.has(taskId)) {
      console.warn(`[Scheduler] Task already running: ${taskId}`);
      return;
    }
    await this.executeTask(task);
  }

  isTaskRunning(taskId: string): boolean {
    return this.runningTasks.has(taskId);
  }
}

// Singleton instance
export const schedulerEngine = new SchedulerEngine();
