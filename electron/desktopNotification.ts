export interface DesktopNotificationInput {
  title: string;
  body?: string;
  conversationId?: string;
  scheduleTaskId?: string;
  runId?: string;
}

export interface DesktopNotificationResult {
  shown: boolean;
  reason?: 'unsupported' | 'invalid' | 'active-window';
}

export interface NativeNotificationLike {
  on(event: 'click', listener: () => void): unknown;
  show(): void;
}

export interface DesktopNotificationDependencies {
  supported: boolean;
  /** Suppress background-style notifications while the owning app window is
   * already visible and focused. */
  activeWindow?: boolean;
  create(options: { title: string; body?: string }): NativeNotificationLike;
  activate(target: Pick<DesktopNotificationInput, 'conversationId' | 'scheduleTaskId' | 'runId'>): void;
}

const MAX_TITLE_LENGTH = 80;
const MAX_BODY_LENGTH = 240;

function compactText(value: unknown, maxLength: number): string {
  const text = typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim()
    : '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

/** Normalize renderer input before handing it to an operating-system API. */
export function normalizeDesktopNotificationInput(
  input: string | DesktopNotificationInput,
): DesktopNotificationInput | null {
  const raw = typeof input === 'string' ? { title: input } : input;
  const title = compactText(raw?.title, MAX_TITLE_LENGTH);
  if (!title) return null;
  const body = compactText(raw.body, MAX_BODY_LENGTH);
  const conversationId = compactText(raw.conversationId, 160);
  const scheduleTaskId = compactText(raw.scheduleTaskId, 160);
  const runId = compactText(raw.runId, 160);
  return {
    title,
    ...(body ? { body } : {}),
    ...(conversationId ? { conversationId } : {}),
    ...(scheduleTaskId ? { scheduleTaskId } : {}),
    ...(runId ? { runId } : {}),
  };
}

/** Deliver one native notification and wire its click action to the app. */
export function showDesktopNotification(
  input: string | DesktopNotificationInput,
  dependencies: DesktopNotificationDependencies,
): DesktopNotificationResult {
  if (!dependencies.supported) return { shown: false, reason: 'unsupported' };
  const normalized = normalizeDesktopNotificationInput(input);
  if (!normalized) return { shown: false, reason: 'invalid' };
  if (dependencies.activeWindow) return { shown: false, reason: 'active-window' };

  const notification = dependencies.create({
    title: normalized.title,
    ...(normalized.body ? { body: normalized.body } : {}),
  });
  notification.on('click', () => dependencies.activate({
    ...(normalized.conversationId ? { conversationId: normalized.conversationId } : {}),
    ...(normalized.scheduleTaskId ? { scheduleTaskId: normalized.scheduleTaskId } : {}),
    ...(normalized.runId ? { runId: normalized.runId } : {}),
  }));
  notification.show();
  return { shown: true };
}
