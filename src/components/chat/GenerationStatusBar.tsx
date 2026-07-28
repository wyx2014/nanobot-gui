import { ArrowDown, BrainCircuit, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export type GenerationPhase = 'generating' | 'thinking';

interface GenerationStatusBarProps {
  phase: GenerationPhase;
  startedAt?: number | null;
  tokenCount?: number;
  className?: string;
}

function timestampMs(value: number): number {
  return value > 1_000_000_000_000 ? value : value * 1000;
}

export function formatGenerationDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
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
    Icon: Sparkles,
    color: 'text-[#b7633e]',
  },
  thinking: {
    label: 'Thinking...',
    Icon: BrainCircuit,
    color: 'text-[#8c664f]',
  },
} satisfies Record<GenerationPhase, {
  label: string;
  Icon: typeof Sparkles;
  color: string;
}>;

export default function GenerationStatusBar({
  phase,
  startedAt = null,
  tokenCount = 0,
  className,
}: GenerationStatusBarProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt == null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const elapsedMs = startedAt != null
    ? Math.max(0, now - timestampMs(startedAt))
    : 0;
  const presentation = PHASE_PRESENTATION[phase];
  const Icon = presentation.Icon;

  return (
    <div
      role="status"
      aria-live="polite"
      data-generation-phase={phase}
      className={cn(
        'mb-2 flex min-h-8 items-center justify-between gap-4 px-1 text-[13px]',
        className,
      )}
    >
      <div
        className={cn(
          'inline-flex min-w-0 items-center gap-2 font-semibold',
          presentation.color,
          'generation-status-breathe',
        )}
      >
        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />
        <span>{presentation.label}</span>
      </div>

      <div className="inline-flex shrink-0 items-center gap-2 text-[#8b887c]">
        <span className="tabular-nums">{formatGenerationDuration(elapsedMs)}</span>
        <span aria-hidden className="text-[#b4b0a6]">·</span>
        <ArrowDown className="h-3.5 w-3.5 text-[#9b978d]" strokeWidth={1.8} aria-hidden />
        <span className="tabular-nums">{formatGenerationTokens(tokenCount)}</span>
      </div>
    </div>
  );
}
