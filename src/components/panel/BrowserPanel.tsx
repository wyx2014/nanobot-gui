import { useEffect, useMemo } from 'react';
import {
  ExternalLink,
  Globe2,
  Hand,
  Pause,
  RefreshCw,
  Square,
  X,
} from 'lucide-react';

import { getNanobotClient } from '@/core/nanobotClient';
import { useI18n } from '@/i18n';
import { shellBridge } from '@/lib/ipc-factory';
import { cn } from '@/lib/utils';
import { isWindows } from '@/utils/platform';
import { useBrowserStore } from '@/stores/browserStore';
import { Button } from '@/components/ui/button';

interface BrowserPanelProps {
  chatId: string;
}

export default function BrowserPanel({ chatId }: BrowserPanelProps) {
  const { t } = useI18n();
  const session = useBrowserStore((state) => state.sessions[chatId]);
  const closePanel = useBrowserStore((state) => state.closePanel);
  const frame = session?.frame;
  const status = session?.status ?? 'stopped';
  const imageUrl = useMemo(
    () => frame
      ? `data:${frame.mimeType};base64,${frame.imageBase64}`
      : null,
    [frame],
  );

  const control = (action: 'pause' | 'resume' | 'stop' | 'capture') => {
    try {
      getNanobotClient().browserControl(chatId, action);
    } catch (error) {
      console.warn('[BrowserPanel] browser control unavailable:', error);
    }
  };

  const openExternal = () => {
    if (!frame?.url) return;
    try {
      const parsed = new URL(frame.url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
      void shellBridge.open(parsed.toString());
    } catch {
      // Ignore incomplete browser URLs such as about:blank.
    }
  };

  useEffect(() => {
    // Agent-driven browser actions already publish a frame after each visible
    // mutation. Poll only while the user has taken control; polling while the
    // Agent is running competes with its Playwright calls and makes the mirror
    // look as if the page is constantly refreshing.
    if (!session?.open || status !== 'user_control') return;
    const timer = window.setInterval(() => control('capture'), 3_000);
    return () => window.clearInterval(timer);
    // ``control`` is deliberately excluded: it is a small transport command
    // and the interval lifecycle is keyed only by visible session state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, session?.open, status]);

  const actions = session?.actions.slice(-6).reverse() ?? [];
  const running = status === 'running' || status === 'starting';
  const userControl = status === 'user_control';

  return (
    <section data-browser-surface className="flex h-full min-h-0 flex-col bg-[#f5f3ee]" aria-label={t.panel.browserTitle}>
      <header className={cn(
        'flex h-12 shrink-0 items-center gap-2 border-b border-[#e5e2db] px-3',
        isWindows() ? 'mt-10' : 'mt-7',
      )}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-[#625f55] shadow-sm ring-1 ring-[#e5e2db]">
            <Globe2 className="h-3.5 w-3.5" />
            <span
              className={cn(
                'absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-[#f5f3ee]',
                running ? 'bg-emerald-500' : userControl ? 'bg-amber-500' : 'bg-[#aaa69c]',
              )}
            />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[#29261b]">{t.panel.browserTitle}</div>
            <div className="truncate text-[10.5px] text-[#8b887c]">
              {frame?.title || frame?.url || session?.message || t.panel.browserWaiting}
            </div>
          </div>
        </div>
        {frame?.url ? (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={openExternal}
            title={t.panel.browserOpenExternal}
            aria-label={t.panel.browserOpenExternal}
            className="text-[#706d63]"
          >
            <ExternalLink />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => control('capture')}
          title={t.panel.browserRefresh}
          aria-label={t.panel.browserRefresh}
          className="text-[#706d63]"
        >
          <RefreshCw />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => closePanel(chatId)}
          title={t.panel.browserClose}
          aria-label={t.panel.browserClose}
          className="text-[#706d63]"
        >
          <X />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div data-browser-frame className="relative flex min-h-[220px] flex-1 items-center justify-center overflow-hidden bg-[#24231f]">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={frame?.title || t.panel.browserTitle}
              className="h-full w-full object-contain"
              draggable={false}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 px-8 text-center text-[#a8a59d]">
              <Globe2 className="h-8 w-8 opacity-60" />
              <p className="text-[12px] leading-5">{t.panel.browserWaiting}</p>
            </div>
          )}
          {userControl ? (
            <div className="absolute inset-x-3 bottom-3 rounded-xl border border-amber-200/80 bg-amber-50/95 px-3 py-2.5 shadow-lg backdrop-blur">
              <div className="flex items-start gap-2 text-[11.5px] leading-5 text-amber-900">
                <Hand className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{t.panel.browserUserControlHint}</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-[#e5e2db] bg-[#faf9f6] px-3 py-3">
          <div className="flex gap-2">
            {userControl ? (
              <Button
                size="sm"
                onClick={() => control('resume')}
                className="h-8 flex-1 bg-[#2f6f52] text-[12px] hover:bg-[#285f47] active:bg-[#1f513b]"
              >
                <Hand className="h-3.5 w-3.5" />
                {t.panel.browserResume}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => control('pause')}
                disabled={!running}
                className="h-8 flex-1 border-[#ddd8cd] bg-white text-[12px]"
              >
                <Pause className="h-3.5 w-3.5" />
                {t.panel.browserPause}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => control('stop')}
              disabled={status === 'stopped'}
              className="h-8 border-[#ddd8cd] bg-white px-3 text-[12px] text-[#8a4137]"
            >
              <Square className="h-3 w-3 fill-current" />
              {t.panel.browserStop}
            </Button>
          </div>

          {actions.length ? (
            <div className="mt-3">
              <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-[#9a968c]">
                {t.panel.browserActions}
              </div>
              <div className="max-h-24 space-y-1 overflow-y-auto pr-1">
                {actions.map((action) => (
                  <div
                    key={action.id}
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[11px] text-[#656158]"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <span className="truncate">{action.label}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
