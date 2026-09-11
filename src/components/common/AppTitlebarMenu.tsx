import { useEffect, useRef } from 'react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useI18n } from '@/i18n';
import { windowBridge, type EditCommand } from '@/lib/ipc-factory';
import { useSettingsStore } from '@/stores/settingsStore';

const triggerClassName =
  'window-titlebar-no-drag flex h-7 items-center rounded-md px-2 text-[13px] font-normal text-[#625f57] outline-none transition-colors hover:bg-[#e7e4de] hover:text-[#29261b] focus-visible:bg-[#e7e4de] data-[state=open]:bg-[#dfdcd5] data-[state=open]:text-[#29261b] dark:text-[#cbc7bf] dark:hover:bg-white/10 dark:hover:text-white dark:focus-visible:bg-white/10 dark:data-[state=open]:bg-white/12 dark:data-[state=open]:text-white';

const contentClassName =
  'min-w-[210px] rounded-lg border-[#d7d4cd] bg-[#fffefa] p-1 shadow-md dark:border-white/12 dark:bg-[#2a2a2a]';

const itemClassName =
  'min-h-0 rounded-md px-2.5 py-1.5 text-[13px] text-[#34312b] focus:bg-[#ece9e3] dark:text-[#eeeae2] dark:focus:bg-white/10';

function Shortcut({ children }: { children: string }) {
  return (
    <span className="ml-auto pl-8 text-[12px] text-[#98958d] dark:text-[#8f8b83]">
      {children}
    </span>
  );
}

function EditMenuItem({
  command,
  label,
  shortcut,
  onSelect,
}: {
  command: EditCommand;
  label: string;
  shortcut: string;
  onSelect: (command: EditCommand) => void;
}) {
  return (
    <DropdownMenuItem
      className={itemClassName}
      onSelect={() => onSelect(command)}
    >
      <span>{label}</span>
      <Shortcut>{shortcut}</Shortcut>
    </DropdownMenuItem>
  );
}

export default function AppTitlebarMenu() {
  const { locale } = useI18n();
  const openHelpManual = useSettingsStore((state) => state.openHelpManual);
  const openDiagnosticsDialog = useSettingsStore((state) => state.openDiagnosticsDialog);
  const isEnglish = locale === 'en-US';
  const lastEditTargetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const rememberEditTarget = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (
        target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target.isContentEditable
      ) {
        lastEditTargetRef.current = target;
      }
    };
    document.addEventListener('focusin', rememberEditTarget);
    return () => document.removeEventListener('focusin', rememberEditTarget);
  }, []);

  const performEditCommand = (command: EditCommand) => {
    // Radix temporarily focuses the menu. Restore the editor/input that owned
    // focus before invoking Electron so cut/paste/undo target the user's text.
    window.setTimeout(() => {
      const target = lastEditTargetRef.current;
      if (target?.isConnected) target.focus();
      void windowBridge.performEditCommand(command);
    }, 0);
  };

  const openDiagnosticsFromMenu = () => {
    // Radix dispatches onSelect synchronously before releasing the menu's body
    // pointer lock. Open the dialog after that cleanup has completed.
    window.setTimeout(openDiagnosticsDialog, 0);
  };

  const labels = isEnglish
    ? {
        edit: 'Edit',
        undo: 'Undo',
        cut: 'Cut',
        copy: 'Copy',
        paste: 'Paste',
        selectAll: 'Select All',
        window: 'Window',
        closeWindow: 'Close Window',
        help: 'Help',
        docs: 'User Guide',
        logs: 'Open Logs Folder',
        diagnostics: 'Export Diagnostics',
      }
    : {
        edit: '编辑(E)',
        undo: '撤销',
        cut: '剪切',
        copy: '复制',
        paste: '粘贴',
        selectAll: '全选',
        window: '窗口(W)',
        closeWindow: '关闭窗口',
        help: '帮助(H)',
        docs: '使用文档',
        logs: '打开日志目录',
        diagnostics: '导出诊断包',
      };

  return (
    <nav
      data-app-titlebar-menu
      aria-label={isEnglish ? 'Application menu' : '应用菜单'}
      className="window-titlebar-no-drag absolute top-1 flex h-7 items-center gap-0.5"
      style={{ left: 124 }}
    >
      <DropdownMenu>
        <DropdownMenuTrigger className={triggerClassName} accessKey="e">
          {labels.edit}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={3} className={contentClassName}>
          <EditMenuItem command="undo" label={labels.undo} shortcut="Ctrl+Z" onSelect={performEditCommand} />
          <DropdownMenuSeparator className="my-1 bg-[#e3e0da] dark:bg-white/10" />
          <EditMenuItem command="cut" label={labels.cut} shortcut="Ctrl+X" onSelect={performEditCommand} />
          <EditMenuItem command="copy" label={labels.copy} shortcut="Ctrl+C" onSelect={performEditCommand} />
          <EditMenuItem command="paste" label={labels.paste} shortcut="Ctrl+V" onSelect={performEditCommand} />
          <DropdownMenuSeparator className="my-1 bg-[#e3e0da] dark:bg-white/10" />
          <EditMenuItem command="selectAll" label={labels.selectAll} shortcut="Ctrl+A" onSelect={performEditCommand} />
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger className={triggerClassName} accessKey="w">
          {labels.window}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={3} className={contentClassName}>
          <DropdownMenuItem
            className={itemClassName}
            onSelect={() => void windowBridge.closeWindow()}
          >
            <span>{labels.closeWindow}</span>
            <Shortcut>Alt+F4</Shortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger className={triggerClassName} accessKey="h">
          {labels.help}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={3} className={contentClassName}>
          <DropdownMenuItem
            className={itemClassName}
            onSelect={openHelpManual}
          >
            {labels.docs}
          </DropdownMenuItem>
          <DropdownMenuItem
            className={itemClassName}
            onSelect={() => void windowBridge.openLogsDirectory()}
          >
            {labels.logs}
          </DropdownMenuItem>
          <DropdownMenuSeparator className="my-1 bg-[#e3e0da] dark:bg-white/10" />
          <DropdownMenuItem
            className={itemClassName}
            onSelect={openDiagnosticsFromMenu}
          >
            {labels.diagnostics}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
