/**
 * User Input Queue — mid-task user message injection
 *
 * Allows users to send additional instructions while the agent loop is running.
 * The agent checks this queue at the start of each loop iteration and incorporates
 * new messages into the conversation context.
 */

/** Queued user input entry */
interface QueuedInput {
  id: string;
  text: string;
  timestamp: number;
}

// Per-conversation input queues
const inputQueues = new Map<string, QueuedInput[]>();

// Listeners for queue state changes
const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach(fn => fn());
}

/**
 * Enqueue a user message for a running conversation.
 * The agent loop will pick this up at the next iteration.
 */
export function enqueueUserInput(conversationId: string, text: string): void {
  if (!text.trim()) return;

  const queue = inputQueues.get(conversationId) ?? [];
  queue.push({
    id: `qi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    text: text.trim(),
    timestamp: Date.now(),
  });
  inputQueues.set(conversationId, queue);
  notifyListeners();
}

/**
 * Drain all queued inputs for a conversation.
 * Returns the queued messages and clears the queue.
 */
export function drainQueuedInputs(conversationId: string): QueuedInput[] {
  const queue = inputQueues.get(conversationId);
  if (!queue || queue.length === 0) return [];

  const items = [...queue];
  inputQueues.delete(conversationId);
  notifyListeners();
  return items;
}

/**
 * Check if there are pending inputs for a conversation
 */
export function hasQueuedInputs(conversationId: string): boolean {
  const queue = inputQueues.get(conversationId);
  return !!queue && queue.length > 0;
}

/**
 * Get the count of queued inputs for a conversation
 */
export function getQueuedInputCount(conversationId: string): number {
  return inputQueues.get(conversationId)?.length ?? 0;
}

/**
 * Clear the queue for a conversation (e.g. on cancel/reset)
 */
export function clearInputQueue(conversationId: string): void {
  inputQueues.delete(conversationId);
  notifyListeners();
}

/**
 * Subscribe to queue state changes (for useSyncExternalStore)
 */
export function subscribeToInputQueue(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Get a snapshot of all queue states (for useSyncExternalStore)
 */
export function getInputQueueSnapshot(): Map<string, number> {
  const snapshot = new Map<string, number>();
  for (const [convId, queue] of inputQueues) {
    if (queue.length > 0) {
      snapshot.set(convId, queue.length);
    }
  }
  return snapshot;
}
