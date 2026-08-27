/**
 * Block the transcript for every real history request. Cached hydration may
 * make a request fast, but it must not suppress loading while a slow remote
 * refresh is still pending.
 */
export function shouldShowConversationLoading(
  activeConversationId: string | null | undefined,
  hydratedConversationId: string | null,
  historyLoading: boolean,
): boolean {
  return Boolean(
    activeConversationId
    && (
      historyLoading
      || hydratedConversationId !== activeConversationId
    ),
  );
}
