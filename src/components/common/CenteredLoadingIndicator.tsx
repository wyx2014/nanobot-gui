import ThinkingOrb from '@/components/common/ModalAwareThinkingOrb';
import { cn } from '@/lib/utils';

interface CenteredLoadingIndicatorProps {
  label: string;
  className?: string;
  testId?: string;
}

export default function CenteredLoadingIndicator({
  label,
  className,
  testId,
}: CenteredLoadingIndicatorProps) {
  return (
    <div
      data-testid={testId}
      className={cn('flex min-h-[45vh] items-center justify-center', className)}
      role="status"
      aria-live="polite"
    >
      <div className="inline-flex items-center gap-2.5 text-[13px] text-[#88857b] dark:text-[#aaa69e]">
        <ThinkingOrb state="solving" size={64} style={{ width: 32, height: 32 }} aria-label="" />
        <span>{label}</span>
      </div>
    </div>
  );
}
