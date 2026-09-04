import { memo, useMemo, useState } from 'react';
import type { Message } from '@/types';
import type { TurnLifecycleStatus } from '@/core/types';
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
  activeTurnElapsedMs?: number;
  latestTurnStatus?: TurnLifecycleStatus;
  onEditUserMessage?: (content: string) => void;
}

export type DisplayUnit = ChatDisplayUnit;

export function buildDisplayUnits(messages: Message[]): DisplayUnit[] {
  return normalizeActivityTimeline(messages);
}

export function lastAssistantReplyIndex(units: DisplayUnit[]): number {
  for (let i = units.length - 1; i >= 0; i -= 1) {
    const unit = units[i];
    if (unit.type === 'message' && unit.message.role === 'assistant') {
      return i;
    }
  }
  return -1;
}

function ThreadMessages({
  messages,
  isStreaming = false,
  activeTurnElapsedMs,
  latestTurnStatus,
  onEditUserMessage,
}: ThreadMessagesProps) {
  const [projector] = useState(createActivityTimelineProjector);
  const units = useMemo(() => projector.project(messages), [messages, projector]);
  const lastAssistantIndex = useMemo(() => lastAssistantReplyIndex(units), [units]);
  const liveActivityTimelineIndices = useMemo(
    () => isStreaming ? currentActivityTimelineIndices(units) : new Set<number>(),
    [isStreaming, units],
  );
  const latestTurnActivityIndices = useMemo(
    () => activityTimelineIndicesAfterLatestUser(units),
    [units],
  );

  // Chat rows have highly variable, late-settling heights (Markdown, tool steps,
  // tables, media). Keep them in document flow: transform-based virtualization
  // makes measured rows and the scroll anchor move on the same frames.
  return (
    <div className="flex w-full flex-col" data-thread-messages>
      {units.map((unit, index) => {
        const prev = units[index - 1];
        const next = units[index + 1];
        const marginTop = index > 0 ? marginAfterPrevUnit(prev) : '';
        const hasBodyBelow =
          unit.type === 'activity'
          && next?.type === 'message'
          && next.message.role === 'assistant';
        const isLiveActivity = liveActivityTimelineIndices.has(index);

        return (
          <div
            key={unitKey(unit, index)}
            data-index={index}
            data-thread-unit
            className={`w-full ${marginTop}`}
          >
            {unit.type === 'activity' ? (
              <TaskNarrativeTimeline
                messages={unit.messages}
                isActive={isLiveActivity}
                hasBodyBelow={hasBodyBelow}
                turnLatencyMs={unit.turnLatencyMs}
                activeElapsedMs={isLiveActivity ? activeTurnElapsedMs : undefined}
                turnStatus={latestTurnActivityIndices.has(index) ? latestTurnStatus : undefined}
              />
            ) : (
              <MessageBubble
                message={unit.message}
                showAssistantCopyAction={unit.message.role === 'assistant'}
                isLastAssistantReply={index === lastAssistantIndex}
                onEditUserMessage={onEditUserMessage}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default memo(ThreadMessages);

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

function activityTimelineIndicesAfterLatestUser(units: DisplayUnit[]): Set<number> {
  const indices = new Set<number>();
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index];
    if (unit.type === 'message' && unit.message.role === 'user') break;
    if (unit.type === 'activity') indices.add(index);
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
  if (prev.type === 'activity') return 'mt-3';
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
