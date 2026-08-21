import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import WindowModalBackdrop from './WindowModalBackdrop';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'danger' | 'normal';
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
  variant = 'normal',
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="window-modal-viewport fixed inset-0 z-[9999] flex items-center justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <WindowModalBackdrop />
      <div
        data-confirm-dialog
        className="relative w-[360px] rounded-2xl border border-black/5 bg-white p-6 shadow-lg dark:border-white/10 dark:bg-[#242424]"
      >
        <h3 className="mb-2 text-[16px] font-semibold text-[#29261b] dark:text-[#f1ede5]">
          {title}
        </h3>
        <p className="mb-6 text-[14px] leading-relaxed text-[#656358] dark:text-[#aaa59c]">
          {message}
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-[13px] font-medium text-[#656358] transition-colors hover:bg-[#f5f3ee] dark:text-[#c7c2b9] dark:hover:bg-[#33322f]"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'px-4 py-2 rounded-lg text-[13px] font-medium text-white transition-colors',
              variant === 'danger'
                ? 'bg-red-500 hover:bg-red-600'
                : 'bg-[#d97757] hover:bg-[#c8664a]'
            )}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
