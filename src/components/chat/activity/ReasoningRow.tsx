import { useEffect, useRef, useState } from 'react';
import { Check, CircleDashed } from 'lucide-react';
import { cn } from '@/lib/utils';
import MarkdownRenderer from '../MarkdownRenderer';
import { ActivityStep } from './ActivityStep';

export function ReasoningRow({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <ActivityStep
      marker={<ReasoningMarker streaming={streaming} />}
      active={streaming}
      tone={streaming ? 'active' : 'success'}
      label={streaming ? 'Thinking...' : 'Thought'}
    >
      {text.trim() ? (
        <div className="min-w-0 text-[12.5px] italic text-[#656358]">
          <MarkdownRenderer content={text} />
        </div>
      ) : null}
    </ActivityStep>
  );
}

function ReasoningMarker({ streaming }: { streaming: boolean }) {
  const wasStreamingRef = useRef(streaming);
  const [justCompleted, setJustCompleted] = useState(false);

  useEffect(() => {
    if (wasStreamingRef.current && !streaming) {
      setJustCompleted(true);
      const timeout = window.setTimeout(() => setJustCompleted(false), 650);
      wasStreamingRef.current = streaming;
      return () => window.clearTimeout(timeout);
    }
    wasStreamingRef.current = streaming;
    return undefined;
  }, [streaming]);

  if (streaming) {
    return (
      <CircleDashed
        className="h-3.5 w-3.5 shrink-0 animate-spin text-[#8b887c]"
        strokeWidth={1.8}
        aria-hidden
      />
    );
  }
  return (
    <span
      className={cn(
        'grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border border-emerald-500/30 text-emerald-600',
        'bg-emerald-500/[0.04] transition-[border-color,background-color,box-shadow,transform] duration-300 ease-out',
        justCompleted && 'animate-in fade-in-0 zoom-in-75 shadow-[0_0_0_3px_rgba(16,185,129,0.10)] motion-reduce:animate-none',
      )}
      aria-hidden
    >
      <Check className="h-2.5 w-2.5 stroke-[2.4]" />
    </span>
  );
}
