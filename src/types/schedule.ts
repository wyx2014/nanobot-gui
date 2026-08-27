/**
 * Scheduled Task Types
 */

export type ScheduleFrequency =
  | 'once'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'weekdays'
  | 'custom'
  | 'manual';
export type ScheduledTaskStatus = 'active' | 'paused' | 'completed';
export type ScheduledRunStatus = 'running' | 'completed' | 'error';
export type ScheduleRunResultType = 'conversation' | 'none';
export type ScheduleRunUnavailableReason = 'legacy' | 'missing';

export interface ScheduleConfig {
  frequency: ScheduleFrequency;
  /** ISO timestamp for a one-time schedule. */
  at?: string;
  /** Execution time (hour:minute). For hourly, only minute is used. */
  time?: { hour: number; minute: number };
  /** Day of week for 'weekly' frequency (0=Sunday, 1=Monday, ..., 6=Saturday) */
  dayOfWeek?: number;
  /** Day of month for 'monthly' frequency (1-31). */
  dayOfMonth?: number;
  /** IANA timezone used by recurring schedules and retained for display. */
  timezone?: string;
  /** Canonical cron expression for schedules that do not fit the simple presets. */
  cronExpression?: string;
  /** Canonical interval for schedules created through chat or other clients. */
  everyMs?: number;
}

/** Shared input shape used by the editor, templates, and gateway mutations. */
export interface ScheduleTaskDraft {
  name: string;
  description?: string;
  prompt: string;
  schedule: ScheduleConfig;
  skillName?: string;
  workspacePath?: string;
}

export interface ScheduledTask {
  id: string;
  name: string;
  /** Optional description / purpose of the task */
  description?: string;
  prompt: string;
  schedule: ScheduleConfig;
  status: ScheduledTaskStatus;
  /** Optional skill binding */
  skillName?: string;
  /** Optional workspace path */
  workspacePath?: string;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
  /** Recent run history (max 20) */
  runs: ScheduledTaskRun[];
  totalRuns: number;
}

export interface ScheduledTaskRun {
  id: string;
  runId?: string;
  scheduledTaskId: string;
  /** Associated conversation ID for viewing results */
  conversationId?: string;
  /** Backend session key for this run. New runs use a per-run cron session. */
  sessionKey?: string;
  /** Explicit gateway contract. A session key alone must not be treated as availability. */
  resultType?: ScheduleRunResultType;
  conversationAvailable?: boolean;
  unavailableReason?: ScheduleRunUnavailableReason;
  startedAt: number;
  completedAt?: number;
  status: ScheduledRunStatus;
  error?: string;
  /** Timestamp when the user opened this run's conversation. */
  viewedAt?: number;
}
