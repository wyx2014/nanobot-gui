import { SettingsView } from './SettingsView';
import { useSettingsStore } from '@/stores/settingsStore';
import { useCallback } from 'react';

export default function SystemSettingsView() {
  const setViewMode = useSettingsStore((s) => s.setViewMode);
  const setModel = useSettingsStore((s) => s.setModel);

  const onBackToChat = useCallback(() => {
    setViewMode('chat');
  }, [setViewMode]);

  const onModelNameChange = useCallback((modelName: string | null) => {
    if (modelName) setModel(modelName);
  }, [setModel]);

  return (
    <SettingsView
      onBackToChat={onBackToChat}
      onModelNameChange={onModelNameChange}
    />
  );
}
