import * as React from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from './input';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  ariaLabel?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptySearchLabel?: string;
  portalled?: boolean;
  portalLayer?: number;
  portalContainer?: () => HTMLElement | null;
  onOpenChange?: (open: boolean) => void;
  /** 'default' = full-width form field, 'inline' = compact for settings rows */
  variant?: 'default' | 'inline';
  className?: string;
}

export function Select({ value, onChange, options, ariaLabel, placeholder, searchPlaceholder, emptySearchLabel = 'No matches', portalled = false, portalLayer = 100, portalContainer, onOpenChange, variant = 'default', className }: SelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);
  const portalRef = React.useRef<HTMLDivElement>(null);
  const [portalStyle, setPortalStyle] = React.useState<React.CSSProperties>({});

  const selectedOption = options.find((opt) => opt.value === value);
  const isInline = variant === 'inline';
  const visibleOptions = searchPlaceholder
    ? options.filter((option) => `${option.label} ${option.description ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    : options;
  const changeOpen = React.useCallback((nextOpen: boolean) => {
    if (nextOpen) setQuery('');
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [onOpenChange]);

  React.useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !containerRef.current?.contains(target)
        && !portalRef.current?.contains(target)
      ) {
        changeOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') changeOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [changeOpen, open]);

  React.useLayoutEffect(() => {
    if (!open || !portalled) return;
    const placePortal = () => {
      const triggerRect = containerRef.current?.getBoundingClientRect();
      if (!triggerRect) return;
      const viewportPadding = 16;
      const gap = 6;
      const below = window.innerHeight - triggerRect.bottom - gap - viewportPadding;
      const above = triggerRect.top - gap - viewportPadding;
      const opensAbove = below < 240 && above > below;
      const width = Math.max(140, Math.min(triggerRect.width, window.innerWidth - viewportPadding * 2));
      const left = Math.min(
        Math.max(viewportPadding, triggerRect.left),
        Math.max(viewportPadding, window.innerWidth - viewportPadding - width),
      );
      setPortalStyle({
        zIndex: portalLayer,
        left,
        width,
        maxHeight: Math.max(120, Math.min(360, opensAbove ? above : below)),
        ...(opensAbove
          ? { bottom: window.innerHeight - triggerRect.top + gap, top: 'auto' }
          : { top: triggerRect.bottom + gap, bottom: 'auto' }),
      });
    };
    placePortal();
    window.addEventListener('resize', placePortal);
    window.addEventListener('scroll', placePortal, true);
    return () => {
      window.removeEventListener('resize', placePortal);
      window.removeEventListener('scroll', placePortal, true);
    };
  }, [open, portalLayer, portalled]);

  const trigger = (
    <button
      type="button"
      data-slot="select-trigger"
      aria-label={ariaLabel}
      aria-expanded={open}
      aria-haspopup="listbox"
      title={selectedOption?.label}
      onClick={() => changeOpen(!open)}
      className={cn(
        'flex min-w-0 items-center gap-2 rounded-lg border border-[var(--cowork-line)] bg-[var(--cowork-control)] text-[13px] text-left transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring hover:border-ring/50',
        open && 'ring-2 ring-ring/20 border-ring',
        isInline
          ? 'px-3 py-1.5'
          : 'w-full h-9 px-3 justify-between',
      )}
    >
      <span className={cn('min-w-0 truncate', !selectedOption ? 'text-[var(--cowork-muted)]' : 'text-[var(--cowork-ink)]')}>
        {selectedOption?.label ?? placeholder ?? '...'}
      </span>
      <ChevronDown
        className={cn(
          'h-3.5 w-3.5 text-[#888579] transition-transform shrink-0 dark:text-[#8a867c]',
          open && 'rotate-180'
        )}
      />
    </button>
  );

  const optionsList = (
    <>
      {searchPlaceholder && <div className="shrink-0 bg-white px-2 pb-1 pt-1 dark:bg-[#262624]">
        <Input aria-label={searchPlaceholder} placeholder={searchPlaceholder} value={query}
          onChange={(event) => setQuery(event.target.value)} autoFocus={portalled} />
      </div>}
      <div
        role="listbox"
        aria-label={ariaLabel}
        className="min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain py-1"
      >
        {visibleOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="option"
            aria-selected={opt.value === value}
            title={opt.label}
            onClick={() => {
              onChange(opt.value);
              changeOpen(false);
            }}
            className={cn(
              'flex w-full min-w-0 items-center gap-2 px-3 py-2 text-sm text-left transition-colors',
              'hover:bg-[#f5f3ee] dark:hover:bg-[#2d2d2c]',
              opt.value === value
                ? 'text-[#d97757] bg-[#d97757]/5'
                : 'text-[#29261b] dark:text-[#e5e1d9]'
            )}
          >
            {!isInline && <span className="w-4 shrink-0">
              {opt.value === value && <Check className="h-4 w-4 text-[#d97757]" />}
            </span>}
            <span className="min-w-0 flex-1">
              <span className="block truncate">{opt.label}</span>
              {opt.description && (
                <span className="mt-0.5 block truncate text-xs text-[#8b877e] dark:text-[#96928a]">
                  {opt.description}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
      {visibleOptions.length === 0 && <p role="status" className="px-3 py-2 text-sm text-[#888579]">{emptySearchLabel}</p>}
    </>
  );

  if (portalled) {
    return (
      <>
        <div ref={containerRef} className={cn('relative', !isInline && 'w-full', className)}>
          {trigger}
        </div>
        {open && createPortal(
          <div
            ref={portalRef}
            data-slot="select-content"
            data-select-portal="true"
            style={portalStyle}
            className="pointer-events-auto fixed flex min-w-[140px] flex-col overflow-hidden rounded-lg border border-[#e8e4dd] bg-white shadow-lg outline-none dark:border-[#3a3a3a] dark:bg-[#262624] dark:shadow-[0_8px_28px_rgba(0,0,0,0.5)]"
          >
            {optionsList}
          </div>,
          portalContainer?.() ?? document.body,
        )}
      </>
    );
  }

  return (
    <div ref={containerRef} className={cn('relative', !isInline && 'w-full', className)}>
      {trigger}
      {open && (
        <div data-slot="select-content" className={cn(
          'absolute z-50 top-full mt-1 flex max-h-60 flex-col overflow-hidden bg-white border border-[#e8e4dd] rounded-lg shadow-lg',
          'dark:bg-[#262624] dark:border-[#3a3a3a] dark:shadow-[0_8px_28px_rgba(0,0,0,0.5)]',
          isInline ? 'right-0 min-w-[140px]' : 'left-0 right-0',
        )}>
          {optionsList}
        </div>
      )}
    </div>
  );
}
