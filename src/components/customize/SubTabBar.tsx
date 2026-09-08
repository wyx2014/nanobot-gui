import { cn } from '@/lib/utils';
import type { ComponentType } from 'react';

interface SubTab {
  id: string;
  label: string;
  count?: number;
  icon?: ComponentType<{ className?: string }>;
}

interface SubTabBarProps {
  tabs: SubTab[];
  activeTab: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
}

export default function SubTabBar({ tabs, activeTab, onChange, ariaLabel, disabled }: SubTabBarProps) {
  return (
    <div data-skill-tabs role="group" aria-label={ariaLabel} className="flex flex-wrap items-center gap-1 p-1 bg-[#f0ede8] rounded-lg tracking-normal">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            type="button"
            aria-pressed={activeTab === tab.id}
            disabled={disabled}
            onClick={() => onChange(tab.id)}
            data-skill-tab
            data-active={activeTab === tab.id ? "true" : "false"}
            className={cn(
              'flex min-w-0 items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d97757]',
              activeTab === tab.id
                ? 'bg-white text-[#29261b] shadow-sm'
                : 'text-[#656358] hover:text-[#29261b] hover:bg-white/50'
            )}
          >
            {Icon && <Icon className="h-4 w-4 shrink-0" />}
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <span
                data-skill-tab-count
                data-active={activeTab === tab.id ? "true" : "false"}
                className={cn(
                  'min-w-[20px] rounded-full border border-transparent px-1.5 py-0.5 text-center text-[10px] font-medium transition-colors',
                  activeTab === tab.id
                    ? 'bg-[#d97757]/10 text-[#d97757]'
                    : 'bg-neutral-200/60 text-[#888579]'
                )}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
