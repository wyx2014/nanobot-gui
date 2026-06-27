import { useState, useRef, useEffect } from 'react';
import { Folder, FolderOpen, ChevronDown, Check, X, Notebook, Search, ChevronRight, Plus } from 'lucide-react';
import { dialogBridge, fsBridge, osBridge } from '@/lib/ipc-factory';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { projectNameFromPath, visibleProjectPath } from '@/core/workspace';

export interface FolderSelectorProps {
  currentPath: string | null;
  recentPaths: string[];
  onSelect: (path: string) => void;
  onClear?: () => void;
  className?: string;
  variant?: 'default' | 'pill';
}

/** Get the folder name from a full path */
function getFolderName(path: string): string {
  return projectNameFromPath(path);
}

export default function FolderSelector({
  currentPath,
  recentPaths,
  onSelect,
  onClear,
  className,
  variant = 'default',
}: FolderSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewProjectSubmenu, setShowNewProjectSubmenu] = useState(false);
  const [isNameDialogOpen, setIsNameDialogOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Close dropdown on escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } else {
      setSearchQuery('');
      setShowNewProjectSubmenu(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isNameDialogOpen) {
      setTimeout(() => {
        nameInputRef.current?.focus();
        nameInputRef.current?.select();
      }, 50);
    }
  }, [isNameDialogOpen]);

  const handleOpenDialog = async () => {
    setIsOpen(false);
    try {
      const selected = await dialogBridge.open({
        directory: true,
        multiple: false,
        title: t.folder.selectWorkspaceFolder,
        properties: ['openDirectory'],
      });
      if (selected) {
        onSelect(selected as string);
      }
    } catch (err) {
      console.error('Failed to open folder dialog:', err);
    }
  };

  const handleCreateBlankProject = async () => {
    setIsOpen(false);
    setShowNewProjectSubmenu(false);
    setNewProjectName(t.folder.defaultProjectName);
    setIsNameDialogOpen(true);
  };

  const handleSaveBlankProject = async () => {
    const trimmedName = newProjectName.trim();
    if (!trimmedName) return;

    try {
      const documentsPath = await osBridge.documentDir();
      const sep = documentsPath.includes('\\') ? '\\' : '/';
      const safeName = trimmedName.replace(/[\\/:*?"<>|]/g, '-');
      const newProjectPath = `${documentsPath}${sep}TpaRuyi Projects${sep}${safeName}`;

      await fsBridge.mkdir(newProjectPath, { recursive: true });
      setIsNameDialogOpen(false);
      onSelect(newProjectPath);
    } catch (err) {
      console.error('Failed to create blank project:', err);
    }
  };

  const handleSelectRecent = (path: string) => {
    setIsOpen(false);
    onSelect(path);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(false);
    onClear?.();
  };

  const visibleRecentPaths = recentPaths
    .map(visibleProjectPath)
    .filter((path): path is string => !!path);

  const filteredPaths = visibleRecentPaths.filter(path => {
    const name = getFolderName(path).toLowerCase();
    const p = path.toLowerCase();
    const q = searchQuery.toLowerCase();
    return name.includes(q) || p.includes(q);
  });

  return (
    <div ref={dropdownRef} className={cn('relative', className)}>
      {/* Trigger Button */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => {
            // First time use: no recent paths and no current path
            // Directly open folder dialog instead of showing dropdown
            if (!currentPath && recentPaths.length === 0) {
              handleOpenDialog();
            } else {
              setIsOpen(!isOpen);
            }
          }}
          className={cn(
            variant === 'pill'
              ? 'flex items-center gap-1.5 py-1 text-[12.5px] text-[#656358] hover:text-[#29261b] transition-colors font-medium cursor-pointer'
              : cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 text-[13px] rounded-lg transition-colors',
                  currentPath
                    ? 'text-[#29261b] bg-[#d97757]/10 hover:bg-[#d97757]/20'
                    : 'text-[#656358] hover:text-[#29261b] hover:bg-[#e8e5de]'
                )
          )}
        >
          {variant === 'pill' ? (
            <Notebook className="h-3.5 w-3.5 text-[#656358]" />
          ) : currentPath ? (
            <FolderOpen className="h-3.5 w-3.5 text-[#d97757]" />
          ) : (
            <Folder className="h-3.5 w-3.5" />
          )}
          <span className="max-w-[150px] truncate">
            {currentPath ? getFolderName(currentPath) : (variant === 'pill' ? t.folder.chooseProject : t.folder.loadFolder)}
          </span>
          {variant !== 'pill' && (
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 transition-transform',
                isOpen && 'rotate-180'
              )}
            />
          )}
        </button>

        {/* Clear button (only when folder selected and not in pill variant) */}
        {variant !== 'pill' && currentPath && onClear && (
          <button
            onClick={handleClear}
            className="flex items-center justify-center text-[#656358] hover:text-red-600 hover:bg-[#f5f3ee] rounded-lg transition-colors cursor-pointer w-6 h-6"
            title={t.folder.clearWorkspace}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Dropdown Menu — opens upward to avoid bottom overflow */}
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1.5 w-72 bg-white rounded-2xl border border-[#e8e4dd] shadow-[0_4px_20px_rgba(0,0,0,0.08)] py-1.5 z-50 flex flex-col animate-in fade-in slide-in-from-bottom-1 duration-150">
          {/* Search bar */}
          <div className="px-3.5 py-1.5 border-b border-[#f0ede6] flex items-center gap-2">
            <Search className="h-4 w-4 text-[#8a867c] shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder={t.folder.searchProject}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-transparent text-[13px] border-none outline-none placeholder:text-[#8a867c] text-[#29261b] font-medium"
            />
          </div>

          {/* List area */}
          <div className="py-1 max-h-[200px] overflow-y-auto">
            {filteredPaths.length > 0 ? (
              filteredPaths.map((path) => (
                <button
                  key={path}
                  onClick={() => handleSelectRecent(path)}
                  className="w-full flex items-center justify-between px-3.5 py-2 text-left hover:bg-[#f5f3ee] transition-colors group cursor-pointer"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <Notebook
                      className={cn(
                        'h-4 w-4 shrink-0',
                        path === currentPath ? 'text-[#d97757]' : 'text-[#656358]'
                      )}
                    />
                    <span
                      className={cn(
                        'text-[13px] truncate flex-1',
                        path === currentPath ? 'text-[#29261b] font-medium' : 'text-[#3d3929]'
                      )}
                    >
                      {getFolderName(path)}
                    </span>
                  </div>
                  {path === currentPath && (
                    <Check className="h-4 w-4 text-[#d97757] shrink-0 ml-2" />
                  )}
                </button>
              ))
            ) : (
              <div className="px-3.5 py-4 text-center text-[12.5px] text-[#888579]">
                {t.folder.noProjectsFound}
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-[#f0ede6] my-1" />

          {/* New project option with chevron */}
          <div
            className="relative"
            onMouseEnter={() => setShowNewProjectSubmenu(true)}
            onMouseLeave={() => setShowNewProjectSubmenu(false)}
          >
            <button
              onClick={() => setShowNewProjectSubmenu(!showNewProjectSubmenu)}
              className={cn(
                "w-full flex items-center justify-between px-3.5 py-2 text-left hover:bg-[#f5f3ee] transition-colors text-[13px] text-[#29261b] font-medium cursor-pointer",
                showNewProjectSubmenu && "bg-[#f5f3ee]"
              )}
            >
              <div className="flex items-center gap-2.5">
                <Plus className="h-4 w-4 text-[#656358] shrink-0" />
                <span>{t.folder.newProject}</span>
              </div>
              <ChevronRight className="h-4 w-4 text-[#888579] shrink-0" />
            </button>

            {/* Submenu */}
            {showNewProjectSubmenu && (
              <div className="absolute bottom-0 left-full w-44 bg-white rounded-xl border border-[#e8e4dd] shadow-[0_4px_20px_rgba(0,0,0,0.08)] py-1.5 z-[60] flex flex-col animate-in fade-in slide-in-from-left-1 duration-150">
                <button
                  onClick={handleCreateBlankProject}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#f5f3ee] text-[13px] text-[#29261b] font-medium transition-colors cursor-pointer"
                >
                  <Plus className="h-4 w-4 text-[#656358] shrink-0" />
                  <span>{t.folder.createBlankProject}</span>
                </button>
                <button
                  onClick={handleOpenDialog}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#f5f3ee] text-[13px] text-[#29261b] font-medium transition-colors cursor-pointer"
                >
                  <Folder className="h-4 w-4 text-[#656358] shrink-0" />
                  <span>{t.folder.useExistingFolder}</span>
                </button>
              </div>
            )}
          </div>

          {/* Do not use project option */}
          {onClear && (
            <>
              <div className="border-t border-[#f0ede6] my-1" />
              <button
                onClick={handleClear}
                className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left hover:bg-[#f5f3ee] text-[13px] text-[#29261b] font-medium transition-colors cursor-pointer"
              >
                <X className="h-4 w-4 text-[#656358] shrink-0" />
                <span>{t.folder.dontUseProject}</span>
              </button>
            </>
          )}
        </div>
      )}

      {isNameDialogOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/10 px-4">
          <div className="w-full max-w-[460px] rounded-[20px] bg-white shadow-[0_16px_48px_rgba(0,0,0,0.16)] border border-[#e6e1d8] overflow-hidden">
            <div className="flex items-start justify-between px-7 pt-6 pb-4">
              <div>
                <h2 className="text-[22px] leading-tight font-semibold text-[#242424]">
                  {t.folder.nameProject}
                </h2>
                <p className="mt-2.5 text-[15px] font-medium text-[#8d8d8d]">
                  {t.folder.nameProjectHint}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsNameDialogOpen(false)}
                className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg text-[#4b4b4b] hover:bg-[#f3f1ed] transition-colors"
                aria-label={t.common.cancel}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="border-t border-[#eeeeee] px-7 py-5">
              <input
                ref={nameInputRef}
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleSaveBlankProject();
                  } else if (event.key === 'Escape') {
                    setIsNameDialogOpen(false);
                  }
                }}
                className="w-full h-12 rounded-[15px] border border-[#e5e2dc] bg-white px-3.5 text-[17px] font-medium text-[#242424] outline-none focus:border-[#d7d1c7] focus:ring-4 focus:ring-[#e7edf5]"
              />
            </div>

            <div className="flex justify-end gap-3 px-7 pb-7">
              <button
                type="button"
                onClick={() => setIsNameDialogOpen(false)}
                className="h-12 rounded-[14px] border border-[#e8e5df] bg-white px-7 text-[16px] font-semibold text-[#242424] hover:bg-[#f8f6f2] transition-colors"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={handleSaveBlankProject}
                disabled={!newProjectName.trim()}
                className="h-12 rounded-[14px] bg-[#1f2024] px-7 text-[16px] font-semibold text-white hover:bg-[#111214] disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
              >
                {t.common.save}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
