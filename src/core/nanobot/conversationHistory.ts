import {
  fetchSessionRuntimeSnapshot,
  fetchThreadResource,
  fetchWebuiThread,
} from '@/core/api';
import type {
  ThreadResource,
  ThreadRuntimeSnapshot,
  UIMessage,
} from '@/core/types';

export interface ConversationHistoryResult {
  source: 'thread-resource' | 'webui-thread';
  resource: ThreadResource | null;
  runtimeSnapshot: ThreadRuntimeSnapshot | null;
  messages: UIMessage[];
}

/** Load canonical history, falling back to the durable WebUI transcript.
 *
 * A damaged or temporarily unavailable read-model projection must not make a
 * persisted conversation appear empty. Runtime snapshot failure is isolated
 * from transcript loading because the transcript remains useful on its own.
 */
export async function loadConversationHistory(
  token: string,
  sessionKey: string,
  base: string,
  messageLimit: number,
): Promise<ConversationHistoryResult> {
  let canonicalError: unknown;
  try {
    const resource = await fetchThreadResource(
      token,
      sessionKey,
      base,
      { messageLimit },
    );
    if (resource) {
      return {
        source: 'thread-resource',
        resource,
        runtimeSnapshot: null,
        messages: resource.messages,
      };
    }
  } catch (error) {
    canonicalError = error;
  }

  try {
    const [thread, runtimeSnapshot] = await Promise.all([
      fetchWebuiThread(
        token,
        sessionKey,
        base,
        { limit: messageLimit, direction: 'latest' },
      ),
      fetchSessionRuntimeSnapshot(token, sessionKey, base).catch(() => null),
    ]);
    if (!thread && canonicalError) throw canonicalError;
    return {
      source: 'webui-thread',
      resource: null,
      runtimeSnapshot,
      messages: thread?.messages ?? [],
    };
  } catch (fallbackError) {
    throw canonicalError ?? fallbackError;
  }
}
