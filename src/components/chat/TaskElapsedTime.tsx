import { memo, useEffect, useRef, useState } from 'react';
import { useVisualActivity } from '@/components/common/useVisualActivity';
import { formatTaskDuration, normalizeTaskTimestamp } from '@/utils/taskDuration';

interface TaskElapsedTimeProps {
  startedAt?: number | null;
  elapsedMs?: number;
  className?: string;
  prefix?: string;
  hideZero?: boolean;
}

export default memo(function TaskElapsedTime({
  startedAt,
  elapsedMs,
  className,
  prefix = '',
  hideZero = false,
}: TaskElapsedTimeProps) {
  const start = normalizeTaskTimestamp(startedAt);
  if (start === undefined) {
    return <span className={className}>{durationLabel(elapsedMs ?? 0, prefix, hideZero)}</span>;
  }
  return <LiveElapsedTime startedAt={start} className={className} prefix={prefix} hideZero={hideZero} />;
});

function durationLabel(duration: number, prefix: string, hideZero: boolean): string {
  return hideZero && duration <= 0 ? '' : `${prefix}${formatTaskDuration(Math.max(0, duration))}`;
}

function LiveElapsedTime({ startedAt: start, className, prefix, hideZero }: {
  startedAt: number;
  className?: string;
  prefix: string;
  hideZero: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const active = useVisualActivity(ref);
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const current = Date.now();
      setNow(current);
      // The label rounds to seconds. Wake only at its next visible change.
      const elapsed = Math.max(0, current - start);
      const nextChange = (Math.floor(elapsed / 1_000 + 0.5) + 0.5) * 1_000;
      timer = setTimeout(tick, Math.max(16, start + nextChange - current));
    };
    tick();
    return () => clearTimeout(timer);
  }, [active, start]);

  return <span ref={ref} className={className}>{durationLabel(now - start, prefix, hideZero)}</span>;
}
