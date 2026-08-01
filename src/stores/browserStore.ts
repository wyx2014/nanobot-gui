import { create } from 'zustand';
import type { InboundEvent } from '@/core/types';

export type BrowserStatus = 'starting' | 'running' | 'user_control' | 'stopped' | 'error';

export interface BrowserFrame {
  browserSessionId: string;
  backend: string;
  url?: string;
  title?: string;
  imageBase64: string;
  mimeType: 'image/jpeg' | 'image/png';
  capturedAt: number;
  actionId?: string;
}

export interface BrowserAction {
  id: string;
  label: string;
  toolName: string;
  status: 'running' | 'completed' | 'error';
  timestamp: number;
}

export interface BrowserSessionView {
  status: BrowserStatus;
  message?: string;
  frame?: BrowserFrame;
  actions: BrowserAction[];
  open: boolean;
  dismissed: boolean;
  updatedAt: number;
}

interface BrowserState {
  sessions: Record<string, BrowserSessionView>;
  handleEvent: (event: Extract<
    InboundEvent,
    { event: 'browser_frame' | 'browser_status' | 'browser_action' }
  >) => void;
  closePanel: (chatId: string) => void;
  openPanel: (chatId: string) => void;
  clearSession: (chatId: string) => void;
}

const emptySession = (): BrowserSessionView => ({
  status: 'stopped',
  actions: [],
  open: false,
  dismissed: false,
  updatedAt: Date.now(),
});

function retainRecentSessions(
  sessions: Record<string, BrowserSessionView>,
  activeChatId: string,
): Record<string, BrowserSessionView> {
  const entries = Object.entries(sessions);
  if (entries.length <= 8) return sessions;
  const removable = entries
    .filter(([chatId]) => chatId !== activeChatId)
    .sort((left, right) => left[1].updatedAt - right[1].updatedAt);
  const next = { ...sessions };
  for (const [chatId] of removable.slice(0, entries.length - 8)) {
    delete next[chatId];
  }
  return next;
}

export const useBrowserStore = create<BrowserState>((set) => ({
  sessions: {},

  handleEvent: (event) => {
    set((state) => {
      const current = state.sessions[event.chat_id] ?? emptySession();
      let next: BrowserSessionView;

      if (event.event === 'browser_frame') {
        next = {
          ...current,
          frame: {
            browserSessionId: event.browser_session_id,
            backend: event.backend,
            ...(event.url ? { url: event.url } : {}),
            ...(event.title ? { title: event.title } : {}),
            imageBase64: event.image_base64,
            mimeType: event.mime_type,
            capturedAt: event.captured_at,
            ...(event.action_id ? { actionId: event.action_id } : {}),
          },
          open: current.dismissed ? current.open : true,
        };
      } else if (event.event === 'browser_status') {
        next = {
          ...current,
          status: event.status,
          message: event.message,
        };
      } else {
        const actions = [
          ...current.actions.filter((action) => action.id !== event.action_id),
          {
            id: event.action_id,
            label: event.label,
            toolName: event.tool_name,
            status: event.status,
            timestamp: event.timestamp,
          },
        ].slice(-30);
        next = { ...current, actions };
      }

      next.updatedAt = Date.now();
      return {
        sessions: retainRecentSessions({
          ...state.sessions,
          [event.chat_id]: next,
        }, event.chat_id),
      };
    });
  },

  closePanel: (chatId) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [chatId]: {
          ...(state.sessions[chatId] ?? emptySession()),
          open: false,
          dismissed: true,
          updatedAt: Date.now(),
        },
      },
    }));
  },

  openPanel: (chatId) => {
    set((state) => ({
      sessions: {
        ...state.sessions,
        [chatId]: {
          ...(state.sessions[chatId] ?? emptySession()),
          open: true,
          dismissed: false,
          updatedAt: Date.now(),
        },
      },
    }));
  },

  clearSession: (chatId) => {
    set((state) => {
      const sessions = { ...state.sessions };
      delete sessions[chatId];
      return { sessions };
    });
  },
}));
