import * as React from 'react';
import { ChevronDown, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MultiSelectOption {
  value: string;
  label: string;
}

export interface MultiSelectProps {
  values: Set<string>;
  onChange: (values: Set<string>) => void;
  options: MultiSelectOption[];
  placeholder?: string;
  className?: string;
}

export function MultiSelect({ values, onChange, options, placeholder, className }: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const toggleOption = (value: string) => {
    const next = new Set(values);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onChange(next);
  };

  const removeOption = (value: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(values);
    next.delete(value);
    onChange(next);
  };

  const selectedLabels = options
    .filter((opt) => values.has(opt.value));

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center justify-between w-full min-h-[36px] px-3 py-1.5 rounded-lg border border-[#e8e4dd] text-sm text-left transition-all bg-[#faf9f7]',
          'focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757]',
          'hover:border-[#d0cdc6]',
          open && 'ring-2 ring-[#d97757]/30 border-[#d97757]'
        )}
      >
        <div className="flex flex-wrap gap-1.5 items-center flex-1 mr-2 overflow-hidden">
          {selectedLabels.length > 0 ? (
            selectedLabels.map(opt => (
              <span key={opt.value} className="flex items-center gap-1 bg-white border border-[#e8e4dd] text-[#29261b] px-1.5 py-0.5 rounded-md text-xs font-medium leading-none shadow-sm">
                {opt.label}
                <div
                  onClick={(e) => removeOption(opt.value, e)}
                  className="hover:bg-[#f5f3ee] rounded-full p-0.5"
                >
                  <X className="h-3 w-3 text-[#b8b5ab]" />
                </div>
              </span>
            ))
          ) : (
            <span className="text-[#b8b5ab]">{placeholder ?? '...'}</span>
          )}
        </div>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-[#888579] transition-transform shrink-0',
            open && 'rotate-180'
          )}
        />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 py-1 bg-white border border-[#e8e4dd] rounded-xl shadow-lg max-h-60 overflow-auto">
          {options.length === 0 ? (
             <div className="px-3 py-2 text-sm text-[#b8b5ab]">No options available</div>
          ) : (
            options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  toggleOption(opt.value);
                }}
                className={cn(
                  'w-full px-3 py-2 text-sm text-left transition-colors flex items-center justify-between',
                  'hover:bg-[#f5f3ee]',
                  values.has(opt.value)
                    ? 'text-[#d97757] bg-[#d97757]/5'
                    : 'text-[#29261b]'
                )}
              >
                <span>{opt.label}</span>
                {values.has(opt.value) && <Check className="h-4 w-4 text-[#d97757]" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
