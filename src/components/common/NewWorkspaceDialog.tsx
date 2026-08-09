import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { osBridge, fsBridge } from '@/lib/ipc-factory';
import { useI18n } from '@/i18n';

interface NewWorkspaceDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (path: string) => void;
}

/**
 * Shared "create a new workspace" dialog: asks for a name, creates a folder
 * under ~/Documents/TpaRuyi Projects, then reports the path back. Used by the
 * composer's folder selector and the sidebar "workspaces" header "+" button so
 * both entries behave identically.
 */
export default function NewWorkspaceDialog({ open, onClose, onCreated }: NewWorkspaceDialogProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setSaving(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  if (!open) return null;

  const create = async () => {
    const trimmedName = name.trim();
    if (!trimmedName || saving) return;
    setSaving(true);
    try {
      const documentsPath = await osBridge.documentDir();
      const sep = documentsPath.includes('\\') ? '\\' : '/';
      const safeName = trimmedName.replace(/[\\/:*?"<>|]/g, '-');
      const newWorkspacePath = `${documentsPath}${sep}TpaRuyi Projects${sep}${safeName}`;
      await fsBridge.mkdir(newWorkspacePath, { recursive: true });
      onCreated(newWorkspacePath);
      onClose();
    } catch (err) {
      console.error('Failed to create workspace:', err);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/20 px-4 backdrop-blur-[1px] animate-in fade-in duration-150 dark:bg-black/45"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[500px] overflow-hidden rounded-[20px] border border-[#e6e1d8] bg-white shadow-[0_16px_48px_rgba(0,0,0,0.16)] dark:border-[#3a3a3a] dark:bg-[#262626] dark:shadow-[0_16px_48px_rgba(0,0,0,0.5)]">
        <div className="flex items-start justify-between px-7 pb-4 pt-6">
          <div>
            <h2 className="text-[22px] font-semibold leading-tight text-[#242424] dark:text-[#ece8e1]">
              {t.folder.nameProject}
            </h2>
            <p className="mt-2.5 whitespace-nowrap text-[15px] font-medium text-[#8d8d8d] dark:text-[#a3a099]">
              {t.folder.nameProjectHint}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg text-[#4b4b4b] transition-colors hover:bg-[#f3f1ed] dark:text-[#b8b5ae] dark:hover:bg-[#333]"
            aria-label={t.common.cancel}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-7 py-4">
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void create();
              else if (event.key === 'Escape') onClose();
            }}
            className="h-12 w-full rounded-[15px] border border-[#e5e2dc] bg-white px-3.5 text-[17px] font-medium text-[#242424] outline-none focus:border-[#d7d1c7] focus:ring-4 focus:ring-[#e7edf5] dark:border-[#444] dark:bg-[#1f1f1f] dark:text-[#ece8e1] dark:focus:border-[#5a5a5a] dark:focus:ring-[#33445c]"
          />
        </div>

        <div className="flex justify-end gap-3 px-7 pb-6">
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-[12px] border border-[#e8e5df] bg-white px-6 text-[15px] font-semibold text-[#242424] transition-colors hover:bg-[#f8f6f2] dark:border-[#3a3a3a] dark:bg-[#2c2c2c] dark:text-[#ece8e1] dark:hover:bg-[#383838]"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={() => void create()}
            disabled={!name.trim() || saving}
            className="h-10 rounded-[12px] bg-[#1f2024] px-6 text-[15px] font-semibold text-white transition-colors hover:bg-[#111214] disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#e8e5de] dark:text-[#242424] dark:hover:bg-[#f2efe9] dark:disabled:opacity-40"
          >
            {t.common.save}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
