import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppNavigationHistory,
  type AppNavigationAvailability,
  type AppNavigationLocation,
} from '@/core/navigation/appNavigationHistory';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';

function currentLocation(): AppNavigationLocation {
  const viewMode = useSettingsStore.getState().viewMode;
  return {
    viewMode,
    conversationId: viewMode === 'chat'
      ? useChatStore.getState().activeConversationId
      : null,
  };
}

export function useAppNavigationHistory(enabled: boolean): AppNavigationAvailability & {
  goBack: () => void;
  goForward: () => void;
} {
  const historyRef = useRef<AppNavigationHistory | null>(null);
  const applyingRef = useRef(false);
  const [availability, setAvailability] = useState<AppNavigationAvailability>({
    canGoBack: false,
    canGoForward: false,
  });

  if (!historyRef.current) {
    historyRef.current = new AppNavigationHistory(currentLocation());
  }

  const refreshAvailability = useCallback(() => {
    const next = historyRef.current?.availability() ?? {
      canGoBack: false,
      canGoForward: false,
    };
    setAvailability((current) => (
      current.canGoBack === next.canGoBack && current.canGoForward === next.canGoForward
        ? current
        : next
    ));
  }, []);

  useEffect(() => {
    const history = historyRef.current;
    if (!history) return;

    history.reset(currentLocation());
    refreshAvailability();
    if (!enabled) return;

    let active = true;
    let recordScheduled = false;
    const scheduleRecord = () => {
      if (applyingRef.current || recordScheduled) return;
      recordScheduled = true;
      queueMicrotask(() => {
        recordScheduled = false;
        if (!active || applyingRef.current) return;
        history.record(currentLocation());
        refreshAvailability();
      });
    };

    const unsubscribeSettings = useSettingsStore.subscribe((state, previous) => {
      if (state.viewMode !== previous.viewMode) scheduleRecord();
    });
    const unsubscribeChat = useChatStore.subscribe((state, previous) => {
      if (state.activeConversationId !== previous.activeConversationId) scheduleRecord();
    });

    return () => {
      active = false;
      unsubscribeSettings();
      unsubscribeChat();
    };
  }, [enabled, refreshAvailability]);

  const navigate = useCallback((direction: 'back' | 'forward') => {
    const history = historyRef.current;
    if (!history) return;

    let target = direction === 'back' ? history.back() : history.forward();
    while (
      target?.viewMode === 'chat'
      && target.conversationId
      && !useChatStore.getState().conversations[target.conversationId]
    ) {
      target = direction === 'back' ? history.back() : history.forward();
    }

    if (!target) {
      refreshAvailability();
      return;
    }

    applyingRef.current = true;
    try {
      if (target.viewMode === 'chat') {
        if (target.conversationId) {
          useChatStore.getState().switchConversation(target.conversationId);
        } else {
          useChatStore.getState().startNewConversation();
        }
      }
      useSettingsStore.getState().setViewMode(target.viewMode);
    } finally {
      applyingRef.current = false;
    }
    refreshAvailability();
  }, [refreshAvailability]);

  const goBack = useCallback(() => navigate('back'), [navigate]);
  const goForward = useCallback(() => navigate('forward'), [navigate]);

  return {
    ...availability,
    goBack,
    goForward,
  };
}
