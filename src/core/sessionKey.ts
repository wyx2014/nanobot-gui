const SESSION_KEY_PREFIXES = ['websocket:', 'cron:'] as const;

export function conversationIdToSessionKey(conversationId: string): string {
  return SESSION_KEY_PREFIXES.some((prefix) => conversationId.startsWith(prefix))
    ? conversationId
    : `websocket:${conversationId}`;
}
