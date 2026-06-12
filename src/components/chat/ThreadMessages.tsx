import { useMemo } from 'react';
import type { Message } from '@/types';
import MessageBubble from './MessageBubble';
import AgentActivityCluster from './AgentActivityCluster';
import { normalizeActivityTimeline, type ChatDisplayUnit } from '@/core/nanobot/activityTimeline';

interface ThreadMessagesProps {
  messages: Message[];
  isStreaming?: boolean;
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
}: ThreadMessagesProps) {
  const units = useMemo(() => buildDisplayUnits(messages), [messages]);
  const copyFlags = useMemo(() => assistantCopyFlags(units), [units]);
  const liveActivityClusterIndices = useMemo(
    () => isStreaming ? currentActivityClusterIndices(units) : new Set<number>(),
    [isStreaming, units],
  );

  return (
    <div className="flex w-full flex-col">
      {units.map((unit, index) => {
        const prev = units[index - 1];
        const next = units[index + 1];
        const marginTop = index > 0 ? marginAfterPrevUnit(prev) : '';
        const hasBodyBelow =
          unit.type === 'activity'
          && next?.type === 'message'
          && next.message.role === 'assistant';

        return (
          <div key={unitKey(unit, index)} className={marginTop}>
            {unit.type === 'activity' ? (
              <AgentActivityCluster
                activityMessages={unit.messages}
                activityItems={unit.items}
                turnLatencyMs={unit.turnLatencyMs}
                isActive={liveActivityClusterIndices.has(index)}
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
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function currentActivityClusterIndices(units: DisplayUnit[]): Set<number> {
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
