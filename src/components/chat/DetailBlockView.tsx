import { useState, useMemo, useEffect } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n';
import type { DetailBlock } from '@/types/execution';

interface DetailBlockViewProps {
  block: DetailBlock;
  onToggle: () => void;
  onLoadMore?: () => void;
}

/**
 * DetailBlockView - Collapsible content area for tool input/output
 * Supports multiple types: script, result, error, list, json, diff, table
 * Uses local state for toggle with optional store sync via onToggle.
 */
export default function DetailBlockView({ block, onToggle, onLoadMore }: DetailBlockViewProps) {
  const { locale } = useI18n();
  // Local expanded state — syncs with block.isExpanded from store when available
  const [localExpanded, setLocalExpanded] = useState(block.isExpanded);

  // Sync from external state changes (e.g. store updates during live execution)
  useEffect(() => {
    setLocalExpanded(block.isExpanded);
  }, [block.isExpanded]);

  const handleToggle = () => {
    setLocalExpanded((prev) => !prev);
    onToggle(); // Also try store update (may be no-op for persisted snapshots)
  };
  const isZh = locale.startsWith('zh');

  // Style based on block type
  const styles = useMemo(() => {
    switch (block.type) {
      case 'error':
        return {
          labelBg: 'bg-red-100',
          labelText: 'text-red-600',
          contentBg: 'bg-red-50',
          borderColor: 'border-red-200',
        };
      case 'script':
        return {
          labelBg: 'bg-[#e8e5de]',
          labelText: 'text-[#656358]',
          contentBg: 'bg-[#f5f3ee]',
          borderColor: 'border-[#e8e5de]',
        };
      case 'list':
        return {
          labelBg: 'bg-blue-50',
          labelText: 'text-blue-600',
          contentBg: 'bg-blue-50/50',
          borderColor: 'border-blue-100',
        };
      case 'json':
        return {
          labelBg: 'bg-purple-50',
          labelText: 'text-purple-600',
          contentBg: 'bg-purple-50/50',
          borderColor: 'border-purple-100',
        };
      default:
        return {
          labelBg: 'bg-[#e8e5de]',
          labelText: 'text-[#8b887c]',
          contentBg: 'bg-[#f5f3ee]',
          borderColor: 'border-[#e8e5de]',
        };
    }
  }, [block.type]);

  // Render content based on type
  const renderContent = () => {
    switch (block.type) {
      case 'list':
        return renderListContent();
      case 'json':
        return renderJsonContent();
      case 'table':
        return renderTableContent();
      default:
        return renderTextContent();
    }
  };

  // Render plain text/code content
  const renderTextContent = () => (
    <>
      {/* Language tag */}
      {block.language && (
        <div className="px-3 py-1.5 text-[11px] text-[#8b887c] bg-[#edeae4] border-b border-[#e8e5de]">
          {block.language}
        </div>
      )}

      {/* Content area */}
      <pre className={cn(
        'px-3 py-2 text-[12px] font-mono whitespace-pre-wrap break-all overflow-x-auto max-h-[300px] overflow-y-auto',
        block.type === 'error' ? 'text-red-600' : 'text-[#656358]'
      )}>
        {block.content}
      </pre>

      {/* Load more button */}
      {block.isTruncated && onLoadMore && (
        <div className="px-3 py-2 border-t border-[#e8e5de]">
          <button
            onClick={onLoadMore}
            className="text-[11px] text-[#d97757] hover:underline"
          >
            {isZh ? '查看更多' : 'Show more'} ({(block.fullContentLength || 0) - block.content.length} {isZh ? '字符' : 'chars'})
          </button>
        </div>
      )}
    </>
  );

  // Render list content (e.g., search results)
  const renderListContent = () => {
    if (!block.parsedItems || block.parsedItems.length === 0) {
      return renderTextContent();
    }

    return (
      <div className="divide-y divide-[#e8e5de]">
        {block.parsedItems.slice(0, 5).map((item, index) => (
          <div key={index} className="px-3 py-2 hover:bg-[#edeae4] transition-colors">
            <div className="flex items-start gap-2">
              {item.icon && <span className="text-sm">{item.icon}</span>}
              <div className="flex-1 min-w-0">
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[13px] text-[#656358] hover:text-[#d97757] font-medium flex items-center gap-1"
                  >
                    {item.title}
                    <ExternalLink className="h-3 w-3 opacity-50" />
                  </a>
                ) : (
                  <div className="text-[13px] text-[#656358] font-medium">{item.title}</div>
                )}
                {item.description && (
                  <div className="text-[11px] text-[#8b887c] mt-0.5 line-clamp-2">
                    {item.description}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
        {block.parsedItems.length > 5 && (
          <div className="px-3 py-2 text-[11px] text-[#8b887c]">
            {isZh ? `还有 ${block.parsedItems.length - 5} 项...` : `${block.parsedItems.length - 5} more items...`}
          </div>
        )}
      </div>
    );
  };

  // Render JSON content with syntax highlighting
  const renderJsonContent = () => {
    let formattedJson = block.content;
    try {
      const parsed = JSON.parse(block.content);
      formattedJson = JSON.stringify(parsed, null, 2);
    } catch {
      // If parsing fails, show as-is
    }

    return (
      <pre className="px-3 py-2 text-[12px] text-[#656358] font-mono whitespace-pre-wrap break-all overflow-x-auto max-h-[300px] overflow-y-auto">
        {formattedJson}
      </pre>
    );
  };

  // Render table content
  const renderTableContent = () => {
    if (!block.tableData) {
      return renderTextContent();
    }

    const { headers, rows } = block.tableData;

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="bg-[#edeae4]">
              {headers.map((header, i) => (
                <th key={i} className="px-3 py-1.5 text-left text-[#656358] font-medium border-b border-[#e8e5de]">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map((row, i) => (
              <tr key={i} className="hover:bg-[#f5f3ee]">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-1.5 text-[#656358] border-b border-[#e8e5de]">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 10 && (
          <div className="px-3 py-2 text-[11px] text-[#8b887c] border-t border-[#e8e5de]">
            {isZh ? `还有 ${rows.length - 10} 行...` : `${rows.length - 10} more rows...`}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mt-1">
      {/* Label button */}
      <button
        onClick={handleToggle}
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px]',
          'transition-colors',
          styles.labelBg,
          styles.labelText,
          'hover:opacity-80'
        )}
      >
        {localExpanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {block.label}
        {block.isTruncated && !localExpanded && (
          <span className="text-[10px] opacity-70">
            ({block.fullContentLength} {isZh ? '字符' : 'chars'})
          </span>
        )}
        {block.type === 'list' && block.parsedItems && (
          <span className="text-[10px] opacity-70">
            ({block.parsedItems.length})
          </span>
        )}
      </button>

      {/* Expanded content */}
      {localExpanded && (
        <div className={cn(
          'mt-2 rounded-lg overflow-hidden border',
          styles.contentBg,
          styles.borderColor
        )}>
          {renderContent()}
        </div>
      )}
    </div>
  );
}
