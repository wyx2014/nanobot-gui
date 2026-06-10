import { cn } from '@/lib/utils';

interface SubTab {
  id: string;
  label: string;
  count?: number;
}

interface SubTabBarProps {
  tabs: SubTab[];
  activeTab: string;
  onChange: (id: string) => void;
}

export default function SubTabBar({ tabs, activeTab, onChange }: SubTabBarProps) {
  return (
    <div className="flex items-center gap-1 p-1 bg-[#f0ede8] rounded-lg">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
            activeTab === tab.id
              ? 'bg-white text-[#29261b] shadow-sm'
              : 'text-[#656358] hover:text-[#29261b] hover:bg-white/50'
          )}
        >
          <span>{tab.label}</span>
          {tab.count !== undefined && (
            <span className={cn(
              'text-[10px] min-w-[18px] text-center px-1 py-0.5 rounded-full',
              activeTab === tab.id
                ? 'bg-[#d97757]/10 text-[#d97757]'
                : 'bg-neutral-200/60 text-[#888579]'
            )}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
