export function formatSidebarConversationTime(
  updatedAt: number,
  now = Date.now(),
  isEnglish = false,
): string {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return '';
  const elapsedMs = Math.max(0, now - updatedAt);
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return isEnglish ? 'Just now' : '刚刚';
  if (minutes < 60) return isEnglish ? `${minutes} min ago` : `${minutes}分钟前`;

  const hours = Math.floor(elapsedMs / 3_600_000);
  if (hours < 24) return isEnglish ? `${hours} hr ago` : `${hours}小时前`;

  const days = Math.floor(elapsedMs / 86_400_000);
  if (days < 30) return isEnglish ? `${days} days ago` : `${days}天前`;

  const months = Math.floor(days / 30);
  if (days < 365) return isEnglish ? `${months} mo ago` : `${months}个月前`;

  const years = Math.floor(days / 365);
  return isEnglish ? `${years} yr ago` : `${years}年前`;
}
