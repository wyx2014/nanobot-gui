export function normalizeTaskTimestamp(value?: number | null): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return value >= 1_000_000_000_000 ? value : value * 1000;
}

export function formatTaskDuration(durationMs: number): string {
  const totalSeconds = durationMs > 0
    ? Math.max(1, Math.round(durationMs / 1000))
    : 0;
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m${seconds}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${minutes}m${seconds}s`;
}
