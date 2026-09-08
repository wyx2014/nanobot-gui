import { useState } from 'react';
import { AlertCircle, FileText, RefreshCw } from 'lucide-react';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import ThinkingOrb from '@/components/common/ModalAwareThinkingOrb';
import NanobotDiagnosticsDialog from '@/components/sidebar/NanobotDiagnosticsDialog';

export default function GatewayStartupStatus({ error, onRetry }: {
  error?: string | null;
  onRetry?: () => void;
}) {
  const { t, locale } = useI18n();
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  return (
    <div data-chat-surface className="flex h-full min-h-[45vh] w-full items-center justify-center bg-[#fbfaf7] dark:bg-[#1f1f1f]">
      <div className="flex w-full max-w-lg flex-col items-center gap-4 px-6" role={error ? 'alert' : 'status'} aria-live="polite">
        {error ? <AlertCircle className="h-10 w-10 text-red-500" /> : (
          <ThinkingOrb state="solving" size={64} style={{ width: 44, height: 44 }} aria-label="" />
        )}
        <p className="text-[15px] font-medium leading-6 text-[#88857b] dark:text-[#aaa69e]">
          {error ? t.chat.gatewayStartFailed : t.chat.gatewayStarting}
        </p>
        {error && <>
          <p className="w-full break-words text-center text-sm text-muted-foreground">{error}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>
              <RefreshCw />{t.task.retryAction}
            </Button>}
            <Button size="sm" variant="ghost" onClick={() => setDiagnosticsOpen(true)}>
              <FileText />{t.chat.gatewayDiagnostics}
            </Button>
          </div>
        </>}
      </div>
      <NanobotDiagnosticsDialog open={diagnosticsOpen} onClose={() => setDiagnosticsOpen(false)} isEnglish={locale === 'en-US'} />
    </div>
  );
}
