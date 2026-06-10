import { useState, useEffect } from 'react';
import { useI18n } from '@/i18n';
import { X, Minus } from 'lucide-react';

interface CloseDialogProps {
  open: boolean;
  onQuit: () => void;
  onMinimize: () => void;
  onCancel: () => void;
  onCloseActionChange: (action: 'ask' | 'minimize' | 'quit') => void;
}

export default function CloseDialog({
  open,
  onQuit,
  onMinimize,
  onCancel,
  onCloseActionChange,
}: CloseDialogProps) {
  const { t } = useI18n();
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const handleQuit = () => {
    if (remember) onCloseActionChange('quit');
    onQuit();
  };

  const handleMinimize = () => {
    if (remember) onCloseActionChange('minimize');
    onMinimize();
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-[#faf8f5] rounded-2xl shadow-2xl ring-1 ring-black/8 w-[400px] p-7 animate-in zoom-in-95 duration-150">
        <h3 className="text-[16px] font-semibold text-[#29261b] mb-1.5">
          {t.windowClose.title}
        </h3>
        <p className="text-[13.5px] text-[#8a8578] leading-relaxed mb-6">
          {t.windowClose.message}
        </p>

        {/* Action buttons */}
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={handleMinimize}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[13.5px] font-medium border border-[#e0ddd6] bg-white text-[#3d3929] hover:bg-[#f0ede6] transition-colors"
          >
            <Minus className="h-4 w-4" />
            {t.windowClose.minimize}
          </button>
          <button
            onClick={handleQuit}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[13.5px] font-medium bg-[#d97757] text-white hover:bg-[#c96747] transition-colors"
          >
            <X className="h-4 w-4" />
            {t.windowClose.quit}
          </button>
        </div>

        {/* Remember choice checkbox */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="w-4 h-4 rounded border-[#d5d1c9] text-[#d97757] focus:ring-[#d97757] accent-[#d97757]"
          />
          <span className="text-[13px] text-[#8a8578]">
            {t.windowClose.rememberChoice}
          </span>
        </label>
      </div>
    </div>
  );
}
