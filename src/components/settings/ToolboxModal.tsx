import { useEffect, useState, useRef } from 'react';
import { useSettingsStore, type ToolboxTab } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useI18n } from '@/i18n';
import { Search, Sparkles, Server, Wrench, Plus, Upload, Wand2, PenLine, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fsBridge, osBridge, dialogBridge } from '@/lib/ipc-factory';
import { joinPath, normalizeSeparators } from '@/utils/pathUtils';
import { ITEM_NAME_RE } from '@/utils/validation';
import SkillsSection from '../customize/SkillsSection';
import MCPSection from '../customize/MCPSection';

export default function ToolboxView() {
  const {
    activeToolboxTab,
    toolboxSearchQuery,
    closeToolbox,
    setActiveToolboxTab,
    setToolboxSearchQuery,
  } = useSettingsStore();
  const setPendingInput = useChatStore((s) => s.setPendingInput);
  const startNewConversation = useChatStore((s) => s.startNewConversation);
  const refresh = useDiscoveryStore((s) => s.refresh);
  const { t } = useI18n();

  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [mcpAddFormOpen, setMcpAddFormOpen] = useState(false);
  const [manualCreateTrigger, setManualCreateTrigger] = useState(0);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    if (!showCreateMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        createMenuRef.current && !createMenuRef.current.contains(e.target as Node) &&
        createButtonRef.current && !createButtonRef.current.contains(e.target as Node)
      ) {
        setShowCreateMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCreateMenu]);

  // Close dropdown and reset manual-create trigger when switching tabs
  useEffect(() => {
    setShowCreateMenu(false);
    setManualCreateTrigger(0);
  }, [activeToolboxTab]);

  const handleAICreate = () => {
    startNewConversation();
    setPendingInput(t.toolbox.aiCreateSkillPrompt);
    closeToolbox();
  };

  // Handler for uploading a file (Skills)
  const handleUploadFile = async () => {
    setShowCreateMenu(false);

    const expectedFileName = 'SKILL.md';
    const targetFolder = 'skills';

    try {
      const filePath = await dialogBridge.open({
        filters: [{ name: 'Markdown', extensions: ['md'] }],
        multiple: false,
      });

      if (!filePath) return;

      const pathStr = filePath as string;
      const content = await fsBridge.readTextFile(pathStr);

      // Extract name from parent directory or filename
      const parts = normalizeSeparators(pathStr).split('/');
      const fileName = parts[parts.length - 1];
      let rawName: string;

      if (fileName.toUpperCase() === expectedFileName) {
        // Use parent directory name
        rawName = parts[parts.length - 2] || fileName.replace(/\.md$/i, '');
      } else {
        // Use filename without extension
        rawName = fileName.replace(/\.md$/i, '');
      }

      // Normalize: lowercase, spaces/underscores → hyphens, strip invalid chars
      const name = rawName
        .toLowerCase()
        .replace(/[\s_]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/^-+|-+$/g, '');

      if (!name || !ITEM_NAME_RE.test(name)) {
        console.warn('[Upload] Invalid name after normalization:', rawName, '→', name);
        return;
      }

      // Write to ~/.ruyi/skills/{name}/SKILL.md
      const home = await osBridge.homeDir();
      const targetDir = joinPath(home, '.ruyi', targetFolder, name);

      await fsBridge.mkdir(targetDir, { recursive: true });

      const targetPath = joinPath(targetDir, expectedFileName);
      await fsBridge.writeTextFile(targetPath, content);

      // Refresh discovery
      await refresh();
    } catch (err) {
      console.error('Upload file failed:', err);
    }
  };

  // Handler for MCP manual add
  const handleMCPManualAdd = () => {
    setShowCreateMenu(false);
    setMcpAddFormOpen(true);
  };

  // Handler for manual create (opens blank editor in SkillsSection)
  const handleManualCreate = () => {
    setShowCreateMenu(false);
    setManualCreateTrigger((c) => c + 1);
  };

  // Get the create button label based on active tab
  const getCreateButtonLabel = () => {
    switch (activeToolboxTab) {
      case 'skills': return t.toolbox.createSkill;
      case 'mcp': return t.toolbox.createMCP;
      default: return t.toolbox.createSkill;
    }
  };

  const navItems: { id: ToolboxTab; label: string; icon: typeof Sparkles }[] = [
    { id: 'skills', label: t.toolbox.skills, icon: Sparkles },
    { id: 'mcp', label: t.toolbox.mcp, icon: Server },
  ];

  const renderContent = () => {
    switch (activeToolboxTab) {
      case 'skills':
        return <SkillsSection manualCreateTrigger={manualCreateTrigger} />;
      case 'mcp':
        return <MCPSection showAddForm={mcpAddFormOpen} onAddFormChange={setMcpAddFormOpen} />;
      default:
        return null;
    }
  };

  const isMCPTab = activeToolboxTab === 'mcp';

  return (
    <div className="h-full bg-[#faf8f5] flex flex-col">
      {/* Header */}
      <div className="shrink-0 flex items-center px-6 py-4 border-b border-[#e8e4dd]">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-[#d97757]/10 flex items-center justify-center">
            <Wrench className="h-4 w-4 text-[#d97757]" />
          </div>
          <h2 className="text-lg font-semibold text-[#29261b]">{t.toolbox.title}</h2>
        </div>
      </div>

      {/* Body - Left/Right Layout */}
      <div className="flex-1 flex min-h-0">
        {/* Left Navigation */}
        <nav className="w-[180px] shrink-0 border-r border-[#e8e4dd] py-4 px-3">
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeToolboxTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveToolboxTab(item.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left',
                    isActive
                      ? 'bg-white text-[#29261b] shadow-sm'
                      : 'text-[#656358] hover:text-[#29261b] hover:bg-white/50'
                  )}
                >
                  <Icon className={cn(
                    'h-4 w-4 shrink-0',
                    isActive ? 'text-[#d97757]' : 'text-[#888579]'
                  )} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Right Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Search bar */}
          <div className="shrink-0 px-5 py-3 border-b border-[#e8e4dd]">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#656358]" />
                <input
                  type="text"
                  placeholder={t.toolbox.searchPlaceholder}
                  value={toolboxSearchQuery}
                  onChange={(e) => setToolboxSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-[#e8e4dd] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757] text-[#29261b]"
                />
                {toolboxSearchQuery && (
                  <button
                    onClick={() => setToolboxSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#656358] hover:text-[#29261b]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="relative">
                <button
                  ref={createButtonRef}
                  onClick={() => {
                    if (isMCPTab) {
                      // MCP: direct action, no dropdown needed
                      handleMCPManualAdd();
                    } else {
                      setShowCreateMenu(!showCreateMenu);
                    }
                  }}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-[#d97757] hover:bg-[#c96747] rounded-lg transition-colors"
                >
                  <Plus className="h-4 w-4" />
                  <span>{getCreateButtonLabel()}</span>
                  {!isMCPTab && (
                    <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showCreateMenu && 'rotate-180')} />
                  )}
                </button>

                {/* Dropdown Menu (Skills/Agents only) */}
                {showCreateMenu && !isMCPTab && (
                  <div
                    ref={createMenuRef}
                    className="absolute z-50 top-full right-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-[#e8e4dd] py-1"
                  >
                    <button
                      onClick={() => {
                        setShowCreateMenu(false);
                        handleAICreate();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#29261b] hover:bg-[#f0ede6] transition-colors"
                    >
                      <Wand2 className="h-4 w-4 text-[#d97757]" />
                      <span>{t.toolbox.createWithAbu}</span>
                    </button>
                    <button
                      onClick={handleManualCreate}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#29261b] hover:bg-[#f0ede6] transition-colors"
                    >
                      <PenLine className="h-4 w-4 text-[#888579]" />
                      <span>{t.toolbox.createManually}</span>
                    </button>
                    <button
                      onClick={handleUploadFile}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#29261b] hover:bg-[#f0ede6] transition-colors"
                    >
                      <Upload className="h-4 w-4 text-[#888579]" />
                      <span>{t.toolbox.uploadFile}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-hidden">
            {renderContent()}
          </div>
        </div>
      </div>

    </div>
  );
}
