import type { SearchResult } from '@/types';
import { ExternalLink } from 'lucide-react';
import { shellBridge } from '@/lib/ipc-factory';
import { cn } from '@/lib/utils';

interface SourceCardProps {
  result: SearchResult;
  index: number;
  isHighlighted?: boolean;
}

/** Compact source row — favicon placeholder + title + domain, industry-standard minimal style */
export default function SourceCard({ result, index, isHighlighted }: SourceCardProps) {
  const handleClick = () => {
    shellBridge.open(result.url);
  };

  return (
    <button
      onClick={handleClick}
      data-source-index={index}
      className={cn(
        "flex items-center gap-2 w-full text-left px-2 py-1.5 rounded-md transition-all group",
        isHighlighted
          ? "bg-[#d97757]/8"
          : "hover:bg-[#f5f3ee]"
      )}
    >
      {/* Index number */}
      <span className="shrink-0 text-[11px] text-[#888579] w-4 text-right tabular-nums">
        {index}
      </span>

      {/* Favicon placeholder — small colored dot derived from domain */}
      <span className="shrink-0 w-4 h-4 rounded-sm bg-[#e8e4dd] flex items-center justify-center text-[9px] font-medium text-[#656358] uppercase">
        {(result.source || result.title)?.[0] || '?'}
      </span>

      {/* Title + domain */}
      <span className="flex-1 min-w-0 truncate text-[13px] text-[#29261b] group-hover:text-[#d97757] transition-colors">
        {result.title}
      </span>

      {/* Domain */}
      {result.source && (
        <span className="shrink-0 text-[11px] text-[#888579] hidden sm:inline">
          {result.source}
        </span>
      )}

      <ExternalLink className="h-3 w-3 text-[#888579] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
    </button>
  );
}
