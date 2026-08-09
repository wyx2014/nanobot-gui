import { ArrowDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ThinkingOrb, type OrbState } from 'thinking-orbs';
import { cn } from '@/lib/utils';
import { formatTaskDuration, normalizeTaskTimestamp } from '@/utils/taskDuration';

export type GenerationPhase = 'generating' | 'thinking' | 'working' | 'searching';

interface GenerationStatusBarProps {
  phase: GenerationPhase;
  startedAt?: number | null;
  elapsedMs?: number;
  tokenCount?: number;
  tokenCountEstimated?: boolean;
  className?: string;
}

export function formatGenerationDuration(durationMs: number): string {
  return formatTaskDuration(durationMs);
}

export function formatGenerationTokens(tokenCount: number): string {
  const value = Math.max(0, Math.round(tokenCount));
  if (value < 1_000) return `${value} tokens`;
  if (value < 1_000_000) {
    return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k tokens`;
  }
  return `${(value / 1_000_000).toFixed(1)}m tokens`;
}

const PHASE_PRESENTATION = {
  generating: {
    label: 'Generating...',
    orbState: 'composing',
    color: 'text-[#b7633e]',
  },
  thinking: {
    label: 'Thinking...',
    orbState: 'solving',
    color: 'text-[#8c664f]',
  },
  working: {
    label: 'Working...',
    orbState: 'working',
    color: 'text-[#6f6b60]',
  },
  searching: {
    label: 'Searching...',
    orbState: 'searching',
    color: 'text-[#4a7db5]',
  },
} satisfies Record<GenerationPhase, {
  label: string;
  orbState: OrbState;
  color: string;
}>;

export default function GenerationStatusBar({
  phase,
  startedAt = null,
  elapsedMs: sharedElapsedMs,
  tokenCount = 0,
  tokenCountEstimated = false,
  className,
}: GenerationStatusBarProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (sharedElapsedMs !== undefined || startedAt == null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [sharedElapsedMs, startedAt]);

  const startedAtMs = normalizeTaskTimestamp(startedAt);
  const elapsedMs = sharedElapsedMs !== undefined
    ? Math.max(0, sharedElapsedMs)
    : startedAtMs !== undefined
      ? Math.max(0, now - startedAtMs)
      : 0;
  const presentation = PHASE_PRESENTATION[phase];

  return (
    <div
      role="status"
      aria-live="polite"
      data-generation-status
      data-generation-phase={phase}
      className={cn(
        'relative -mx-3 mb-1 flex min-h-7 items-center justify-between gap-4 bg-gradient-to-t from-[#fbfaf7] via-[#fbfaf7]/70 to-transparent px-4 text-[13px]',
        className,
      )}
    >
      <div
        className={cn(
          'inline-flex min-w-0 items-center gap-2 font-semibold',
          presentation.color,
        )}
      >
        <ThinkingOrb state={presentation.orbState} size={20} aria-label="" className="shrink-0" />
        <span>{presentation.label}</span>
      </div>

      <div className="inline-flex shrink-0 items-center gap-2 text-[#8b887c]">
        <span className="tabular-nums">{formatGenerationDuration(elapsedMs)}</span>
        <span aria-hidden className="text-[#b4b0a6]">·</span>
        <ArrowDown className="h-3.5 w-3.5 text-[#9b978d]" strokeWidth={1.8} aria-hidden />
        <span className="tabular-nums">
          {tokenCountEstimated && tokenCount > 0 ? '~' : ''}
          {formatGenerationTokens(tokenCount)}
        </span>
      </div>
    </div>
  );
}
