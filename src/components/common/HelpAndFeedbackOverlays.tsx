import { useEffect, useState } from 'react';
import HelpManual from '@/components/settings/HelpManual';
import DiagnosticExportDialog from '@/components/settings/DiagnosticExportDialog';
import { useI18n } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';

export default function HelpAndFeedbackOverlays() {
  const { locale } = useI18n();
  const helpManualOpen = useSettingsStore((state) => state.helpManualOpen);
  const closeHelpManual = useSettingsStore((state) => state.closeHelpManual);
  const diagnosticsDialogOpen = useSettingsStore((state) => state.diagnosticsDialogOpen);
  const closeDiagnosticsDialog = useSettingsStore((state) => state.closeDiagnosticsDialog);
  const openDiagnosticsDialog = useSettingsStore((state) => state.openDiagnosticsDialog);
  const [menuRequest, setMenuRequest] = useState<string | null>(null);

  useEffect(() => window.ipc?.on('diagnostics:open-dialog', (id: string) => {
    setMenuRequest(id);
    openDiagnosticsDialog();
  }), [openDiagnosticsDialog]);
  useEffect(() => {
    if (diagnosticsDialogOpen && menuRequest) void window.ipc?.invoke('diagnostics:dialog-opened', menuRequest).catch(() => {});
  }, [diagnosticsDialogOpen, menuRequest]);

  return <>
    {helpManualOpen && <HelpManual onClose={closeHelpManual} />}
    {diagnosticsDialogOpen && <DiagnosticExportDialog isEnglish={locale === 'en-US'} onClose={closeDiagnosticsDialog} />}
  </>;
}
