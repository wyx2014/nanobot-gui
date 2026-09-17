import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ComposerSelectionChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  children: ReactNode;
}

export default function ComposerSelectionChip({
  icon,
  children,
  className,
  ...props
}: ComposerSelectionChipProps) {
  return (
    <button
      {...props}
      type="button"
      data-composer-action
      className={cn(
        'group/selection inline-flex h-8 max-w-[min(220px,100%)] shrink-0 items-center gap-1.5 rounded-xl bg-[#f0efec] px-2.5 text-[13px] font-medium text-[#29261b] transition-colors hover:bg-[#e8e6e1] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
    >
      <span className="relative h-4 w-4 shrink-0" aria-hidden="true">
        <span
          data-composer-selection-icon
          className="absolute inset-0 transition-opacity group-hover/selection:opacity-0 group-focus-visible/selection:opacity-0"
        >
          {icon}
        </span>
        <X
          data-composer-selection-remove
          className="absolute inset-0 h-4 w-4 opacity-0 transition-opacity group-hover/selection:opacity-100 group-focus-visible/selection:opacity-100"
        />
      </span>
      <span className="truncate">{children}</span>
    </button>
  );
}
