import type { ScheduledTask } from '@/types/schedule';

/** A viewed, successfully completed one-time task is retained only as history. */
export function isArchivedOneTimeTask(task: ScheduledTask): boolean {
  if (task.schedule.frequency !== 'once' || task.status !== 'completed') return false;
  const latestRun = task.runs.reduce<(typeof task.runs)[number] | undefined>(
    (latest, run) => (!latest || run.startedAt > latest.startedAt ? run : latest),
    undefined,
  );
  return latestRun?.status === 'completed' && Boolean(latestRun.viewedAt);
}
