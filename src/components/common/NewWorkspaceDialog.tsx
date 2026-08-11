import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { osBridge, fsBridge } from '@/lib/ipc-factory';
import { useI18n } from '@/i18n';
import { USER_PROJECTS_DIRECTORY_NAME } from '@/config/appDirectories';

interface NewWorkspaceDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (path: string) => void;
}

/**
 * Shared "create a new workspace" dialog: asks for a name, creates a folder
 * under ~/Documents/TPACowork Projects, then reports the path back. Used by the
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
      const newWorkspacePath = `${documentsPath}${sep}${USER_PROJECTS_DIRECTORY_NAME}${sep}${safeName}`;
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
      <div className="flex w-[480px] max-h-[85vh] flex-col bg-white rounded-2xl shadow-xl overflow-hidden dark:border dark:border-[#3a3a3a] dark:bg-[#262626]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 shrink-0 dark:border-white/10">
          <div>
            <h2 className="text-[16px] font-semibold text-[#29261b] dark:text-[#ece8e1]">
              {t.folder.nameProject}
            </h2>
            <p className="mt-0.5 text-[12.5px] font-medium text-[#8d8d8d] dark:text-[#a3a099]">
              {t.folder.nameProjectHint}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors dark:text-[#b8b5ae] dark:hover:bg-[#333]"
            aria-label={t.common.cancel}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4 overflow-auto flex-1">
          <input
            ref={inputRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              // Confirming an IME candidate with Enter must not submit the
              // form; only a real Enter should create the workspace.
              if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                void create();
              } else if (event.key === 'Escape') {
                onClose();
              }
            }}
            placeholder={t.folder.nameProjectHint}
            className="w-full h-10 px-3 bg-white border border-[#e8e4dd] rounded-lg text-sm text-[#29261b] focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757] dark:border-[#444] dark:bg-[#1f1f1f] dark:text-[#ece8e1] dark:focus:border-[#d97757] dark:focus:ring-[#d97757]/30 dark:placeholder:text-[#77746d]"
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-neutral-100 shrink-0 dark:border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-[13px] text-[#3d3929] hover:bg-[#f5f3ee] transition-colors dark:text-[#ece8e1] dark:hover:bg-[#333]"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={() => void create()}
            disabled={!name.trim() || saving}
            className="px-4 py-2 rounded-lg text-[13px] font-medium bg-[#d97757] text-white hover:bg-[#c8664a] transition-colors disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t.common.save}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
