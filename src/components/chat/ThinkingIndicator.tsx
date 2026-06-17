import { useChatStore } from '@/stores/chatStore';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

interface ThinkingIndicatorProps {
  className?: string;
  showText?: boolean;
}

export default function ThinkingIndicator({ className, showText = true }: ThinkingIndicatorProps) {
  const { t } = useI18n();
  useChatStore((s) => s.thinkingStartTime);

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
        </div>
      )}
    </div>
  );
}
