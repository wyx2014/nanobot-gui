/**
 * Only block the transcript while the selected conversation has never been
 * hydrated. A refresh for the conversation already on screen must leave its
 * messages visible while new runtime events arrive.
 */
export function shouldShowConversationLoading(
  activeConversationId: string | null | undefined,
  hydratedConversationId: string | null,
): boolean {
  return Boolean(
    activeConversationId
    && hydratedConversationId !== activeConversationId,
  );
}
