import { useMemo, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Message } from '@/types';
import MessageBubble from './MessageBubble';
import TaskNarrativeTimeline from './TaskNarrativeTimeline';
import {
  createActivityTimelineProjector,
  normalizeActivityTimeline,
  type ChatDisplayUnit,
} from '@/core/nanobot/activityTimeline';

interface ThreadMessagesProps {
  messages: Message[];
  isStreaming?: boolean;
  scrollElement?: HTMLDivElement | null;
  onEditUserMessage?: (message: Message, newContent: string) => void;
  onRegenerateAssistant?: (message: Message) => void;
}

export type DisplayUnit = ChatDisplayUnit;

export function buildDisplayUnits(messages: Message[]): DisplayUnit[] {
  return normalizeActivityTimeline(messages);
}

export function assistantCopyFlags(units: DisplayUnit[]): boolean[] {
  const flags = new Array<boolean>(units.length).fill(true);
  let hasLaterUnitBeforeUser = false;
  for (let i = units.length - 1; i >= 0; i -= 1) {
    const unit = units[i];
    if (unit.type === 'message' && unit.message.role === 'user') {
      hasLaterUnitBeforeUser = false;
      continue;
    }
    if (unit.type === 'message' && unit.message.role === 'assistant') {
      flags[i] = !hasLaterUnitBeforeUser;
    }
    hasLaterUnitBeforeUser = true;
  }
  return flags;
}

export default function ThreadMessages({
  messages,
  isStreaming = false,
  scrollElement = null,
  onEditUserMessage,
  onRegenerateAssistant,
}: ThreadMessagesProps) {
  const [projector] = useState(createActivityTimelineProjector);
  const units = useMemo(() => projector.project(messages), [messages, projector]);
  const copyFlags = useMemo(() => assistantCopyFlags(units), [units]);
  const liveActivityTimelineIndices = useMemo(
    () => isStreaming ? currentActivityTimelineIndices(units) : new Set<number>(),
    [isStreaming, units],
  );
  // TanStack Virtual intentionally exposes imperative measurement functions.
  // It is safe here because they are consumed within this component only.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: units.length,
    getScrollElement: () => scrollElement,
    estimateSize: () => 180,
    overscan: 6,
  });
  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div
      className="relative w-full"
      style={{ height: `${virtualizer.getTotalSize()}px` }}
    >
      {virtualItems.map((virtualItem) => {
        const index = virtualItem.index;
        const unit = units[index];
        const prev = units[index - 1];
        const next = units[index + 1];
        const marginTop = index > 0 ? marginAfterPrevUnit(prev) : '';
        const hasBodyBelow =
          unit.type === 'activity'
          && next?.type === 'message'
          && next.message.role === 'assistant';

        return (
          <div
            key={unitKey(unit, index)}
            data-index={index}
            ref={virtualizer.measureElement}
            className={`absolute left-0 w-full ${marginTop}`}
            style={{ transform: `translateY(${virtualItem.start}px)` }}
          >
            {unit.type === 'activity' ? (
              <TaskNarrativeTimeline
                messages={unit.messages}
                isActive={liveActivityTimelineIndices.has(index)}
                hasBodyBelow={hasBodyBelow}
              />
            ) : (
              <MessageBubble
                message={unit.message}
                showAssistantCopyAction={
                  unit.message.role === 'assistant'
                    ? copyFlags[index]
                    : true
                }
                onEditUserMessage={onEditUserMessage}
                onRegenerateAssistant={onRegenerateAssistant}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function currentActivityTimelineIndices(units: DisplayUnit[]): Set<number> {
  const indices = new Set<number>();
  let markedCurrentActivity = false;
  for (let i = units.length - 1; i >= 0; i -= 1) {
    const unit = units[i];
    if (unit.type === 'activity') {
      if (!markedCurrentActivity) {
        indices.add(i);
        markedCurrentActivity = true;
      }
      continue;
    }
    if (unit.message.role === 'assistant' && unit.message.isStreaming) continue;
    if (unit.message.role === 'user') break;
  }
  return indices;
}

function unitKey(unit: DisplayUnit, index: number): string {
  if (unit.type === 'activity') {
    const anchor = unit.messages[0]?.id;
    return anchor != null ? `activity-${anchor}` : `activity-idx-${index}`;
  }
  return unit.message.id;
}

function marginAfterPrevUnit(prev: DisplayUnit): string {
  if (prev.type === 'activity') return 'mt-4';
  const p = prev.message;
  const denseP =
    p.kind === 'trace'
    || (
      p.role === 'assistant'
      && typeof p.content === 'string'
      && p.content.trim().length === 0
      && (!!p.thinking || !!p.reasoningStreaming)
    );
  return denseP ? 'mt-2' : 'mt-5';
}
