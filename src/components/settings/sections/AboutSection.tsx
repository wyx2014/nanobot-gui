import { shellBridge } from '@/lib/ipc-factory';
import { RefreshCw, Download, CheckCircle } from 'lucide-react';
import ruyiAvatar from '@/assets/ruyi-avatar.png';
import { APP_VERSION } from '@/utils/version';
import { useSettingsStore } from '@/stores/settingsStore';
import { checkForUpdate } from '@/core/updates/checker';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

export default function AboutSection() {
  const updateInfo = useSettingsStore((s) => s.updateInfo);
  const updateChecking = useSettingsStore((s) => s.updateChecking);
  const { t } = useI18n();

  const handleOpenLink = async (url: string) => {
    try {
      await shellBridge.open(url);
    } catch (e) {
      console.error('Failed to open link:', e);
    }
  };

  const handleCheckUpdate = () => {
    checkForUpdate(true);
  };

  return (
    <div className="space-y-6">
      {/* Logo & name */}
      <div className="flex flex-col items-center text-center space-y-3">
        <img src={ruyiAvatar} alt="太资如意" className="w-20 h-20 rounded-2xl" />
        <div>
          <h4 className="text-2xl font-bold text-[#29261b]">{t.common.appName}</h4>
          <p className="text-sm text-[#656358]">{t.common.appSlogan}</p>
        </div>
      </div>

      {/* Version info */}
      <div className="space-y-1">
        <div className="flex justify-between items-center py-3 border-b border-[#e8e4dd]">
          <span className="text-sm text-[#656358]">{t.updates.currentVersion}</span>
          <span className="text-sm font-semibold text-[#29261b]">
            v{APP_VERSION}
          </span>
        </div>
      </div>

      {/* Update card */}
      {updateInfo ? (
        <div className="rounded-xl border border-[#d97757]/30 bg-[#d97757]/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-[#d97757]">{t.updates.newVersionAvailable}</span>
            <span className="text-sm font-mono font-semibold text-[#29261b]">v{updateInfo.version}</span>
          </div>
          {updateInfo.releaseNotes && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-[#656358]">{t.updates.releaseNotes}</span>
              <p className="text-sm text-[#3d3929] whitespace-pre-line">{updateInfo.releaseNotes}</p>
            </div>
          )}
          {updateInfo.downloadUrl && (
            <button
              onClick={() => handleOpenLink(updateInfo.downloadUrl)}
              className="flex items-center gap-2 w-full justify-center py-2 px-4 rounded-lg bg-[#d97757] text-white text-sm font-medium hover:bg-[#c4684a] transition-colors"
            >
              <Download className="h-4 w-4" />
              {t.updates.downloadUpdate}
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 py-3 text-sm text-[#656358]">
          <CheckCircle className="h-4 w-4 text-green-500" />
          <span>{t.updates.upToDate}</span>
        </div>
      )}

      {/* Check for updates button */}
      <button
        onClick={handleCheckUpdate}
        disabled={updateChecking}
        className={cn(
          'flex items-center gap-2 w-full justify-center py-2.5 px-4 rounded-lg border border-[#e8e4dd] text-sm font-medium transition-colors',
          updateChecking
            ? 'text-[#888579] cursor-not-allowed'
            : 'text-[#3d3929] hover:bg-[#f0ede6]'
        )}
      >
        <RefreshCw className={cn('h-4 w-4', updateChecking && 'animate-spin')} />
        {updateChecking ? t.updates.checking : t.updates.checkForUpdates}
      </button>

      {/* Footer */}
      <div className="text-center space-y-2 pt-4">
        <p className="text-sm text-[#656358]">
          Made with ❤️ by Yark Wang
        </p>
        <p className="text-xs text-[#888579]">
          © 2026 {t.common.appName}. All rights reserved.
        </p>
      </div>
    </div>
  );
}
