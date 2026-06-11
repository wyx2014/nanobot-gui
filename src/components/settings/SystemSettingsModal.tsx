import { SettingsView } from './SettingsView';
import { useSettingsStore } from '@/stores/settingsStore';
import { useCallback } from 'react';

export default function SystemSettingsView() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setViewMode = useSettingsStore((s) => s.setViewMode);
  const setModel = useSettingsStore((s) => s.setModel);

  const onToggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const onBackToChat = useCallback(() => {
    setViewMode('chat');
  }, [setViewMode]);

  const onModelNameChange = useCallback((modelName: string | null) => {
    if (modelName) setModel(modelName);
  }, [setModel]);

  return (
    <SettingsView
      theme={theme}
      onToggleTheme={onToggleTheme}
      onBackToChat={onBackToChat}
      onModelNameChange={onModelNameChange}
    />
  );
}
