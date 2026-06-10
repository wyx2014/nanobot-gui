import { useState, useEffect } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

interface ThinkingIndicatorProps {
  className?: string;
  showText?: boolean;
}

export default function ThinkingIndicator({ className, showText = true }: ThinkingIndicatorProps) {
  const { t } = useI18n();
  const thinkingStartTime = useChatStore((s) => s.thinkingStartTime);
  const [elapsed, setElapsed] = useState<string>('0.0s');

  useEffect(() => {
    if (!thinkingStartTime) {
      setElapsed('0.0s');
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const diff = Math.max(0, (now - thinkingStartTime) / 1000);
      setElapsed(diff.toFixed(1) + 's');
    };

    updateTimer();
    const timer = setInterval(updateTimer, 100);
    return () => clearInterval(timer);
  }, [thinkingStartTime]);

  return (
    <div className={cn("flex items-center gap-3 py-2 animate-in", className)}>
      <div className="flex items-center gap-1">
        <span className="typing-dot w-1.5 h-1.5 rounded-full bg-[#d97757]/60" />
        <span className="typing-dot w-1.5 h-1.5 rounded-full bg-[#d97757]/60" />
        <span className="typing-dot w-1.5 h-1.5 rounded-full bg-[#d97757]/60" />
      </div>
      {showText && (
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#656358] font-medium">{t.chat.thinking}</span>
          <span className="text-[11px] text-[#656358]/50 font-mono tabular-nums bg-[#f5f3ee] px-1.5 py-0.5 rounded border border-[#706b5710]">
            {elapsed}
          </span>
        </div>
      )}
    </div>
  );
}
