import type { ToolDefinition, ToolResult, ToolResultContent } from '../../types';
import { mcpManager } from '../mcp/client';
import { analyzeCommand, type ConfirmationInfo, type DangerLevel } from './commandSafety';
import { checkReadPath, checkWritePath, checkListPath } from './pathSafety';
import { getI18n } from '../../i18n';
import { truncateToolResult } from '../context/truncation';
import { useSettingsStore } from '../../stores/settingsStore';

/**
 * Extract text-only representation from a ToolResult.
 * For string results, returns as-is. For rich content arrays, extracts text blocks.
 */
export function toolResultToString(result: ToolResult): string {
  if (typeof result === 'string') return result;
  return result
    .filter((c): c is Extract<ToolResultContent, { type: 'text' }> => c.type === 'text')
    .map((c) => c.text)
    .join('\n') || '[image]';
}

/**
 * Check if a ToolResult contains image content.
 */
export function toolResultHasImages(result: ToolResult): boolean {
  if (typeof result === 'string') return false;
  return result.some((c) => c.type === 'image');
}

class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  remove(name: string): void {
    this.tools.delete(name);
  }

  async execute(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `Error: Unknown tool "${name}"`;
    }
    try {
      return await tool.execute(input);
    } catch (err) {
      return `Error executing tool "${name}": ${err instanceof Error ? err.message : String(err)}`;
    }
  }
}

export const toolRegistry = new ToolRegistry();

/**
 * Playwright browser tools that overlap with ruyi-browser-bridge.
 * When ruyi-browser-bridge is connected, these are filtered out to avoid
 * the LLM accidentally launching a separate Chromium instance.
 */
const PLAYWRIGHT_BROWSER_TOOLS = new Set([
  'playwright__browser_tabs',
  'playwright__browser_tab_open',
  'playwright__browser_navigate',
  'playwright__browser_click',
  'playwright__browser_type',
  'playwright__browser_select_option',
  'playwright__browser_take_screenshot',
  'playwright__browser_snapshot',
  'playwright__browser_run_code',
  'playwright__browser_wait_for',
  'playwright__browser_tab_close',
  'playwright__browser_press_key',
  'playwright__browser_scroll',
  'playwright__browser_drag',
  'playwright__browser_hover',
  'playwright__browser_handle_dialog',
  'playwright__browser_file_upload',
]);

/**
 * Get all available tools: builtin tools + MCP tools
 * Deduplicates by tool name — builtin tools take priority over MCP tools
 * Filters out conflicting playwright browser tools when ruyi-browser-bridge is connected
 */
const COMPUTER_USE_TOOLS = new Set(['computer']);

export function getAllTools(): ToolDefinition[] {
  const builtinTools = toolRegistry.getAll();
  const mcpTools = mcpManager.listTools();
  const toolMap = new Map<string, ToolDefinition>();

  // Check if ruyi-browser-bridge is connected — if so, filter out playwright browser tools
  const hasBrowserBridge = mcpManager.isConnected('ruyi-browser-bridge');

  // Hide computer use tools when disabled — prevents LLM from calling them and getting errors
  const computerUseEnabled = useSettingsStore.getState().computerUseEnabled;

  // Builtin tools first (as base)
  for (const tool of builtinTools) {
    if (!computerUseEnabled && COMPUTER_USE_TOOLS.has(tool.name)) continue;
    toolMap.set(tool.name, tool);
  }

  // MCP tools — can override builtin tools with same name
  for (const tool of mcpTools) {
    // Skip playwright browser tools when ruyi-browser-bridge is active
    if (hasBrowserBridge && PLAYWRIGHT_BROWSER_TOOLS.has(tool.name)) {
      continue;
    }

    // Add the prefixed name (always available)
    toolMap.set(tool.name, tool);

    // If this MCP tool has a corresponding builtin tool, it overrides the bare name
    if (tool.name.includes('__')) {
      const parts = tool.name.split('__');
      const baseName = parts[parts.length - 1];
      if (toolRegistry.has(baseName)) {
        // MCP version takes precedence for the bare name (e.g., brave-search__web_search overrides web_search)
        toolMap.set(baseName, tool);
      }
    }
  }
  return Array.from(toolMap.values());
}

/**
 * Callback type for command confirmation
 */
export type CommandConfirmCallback = (info: ConfirmationInfo) => Promise<boolean>;

/**
 * Callback type for file permission requests
 */
export type FilePermissionCallback = (request: {
  path: string;
  capability: 'read' | 'write';
  toolName: string;
}) => Promise<boolean>;

/**
 * Map of file-related tools to their path extraction logic
 */
const FILE_TOOL_PATH_MAP: Record<string, (input: Record<string, unknown>) => { path: string; capability: 'read' | 'write' } | null> = {
  read_file:      (i) => i.path ? { path: i.path as string, capability: 'read' } : null,
  list_directory: (i) => i.path ? { path: i.path as string, capability: 'read' } : null,
  write_file:     (i) => i.path ? { path: i.path as string, capability: 'write' } : null,
  edit_file:      (i) => i.path ? { path: i.path as string, capability: 'write' } : null,
  search_files:   (i) => i.path ? { path: i.path as string, capability: 'read' } : null,
  find_files:     (i) => i.path ? { path: i.path as string, capability: 'read' } : null,
};

/**
 * Execute a tool by name, checking both builtin and MCP tools
 * With optional dangerous command confirmation and file permission callbacks
 */
export async function executeAnyTool(
  name: string,
  input: Record<string, unknown>,
  onRequireConfirmation?: CommandConfirmCallback,
  onRequireFilePermission?: FilePermissionCallback
): Promise<ToolResult> {
  const t = getI18n();
  console.log(`[Registry] executeAnyTool: name=${name}, input=`, JSON.stringify(input));

  // Safety check for run_command tool
  if (name === 'run_command') {
    const command = input.command as string;
    if (command) {
      const analysis = analyzeCommand(command);

      // Block dangerous commands
      if (analysis.level === 'block') {
        return `Error: ${t.commandConfirm.blocked}: ${analysis.reason}`;
      }

      // Require confirmation for warn/danger level commands
      if (analysis.level === 'danger' || analysis.level === 'warn') {
        if (onRequireConfirmation) {
          const confirmed = await onRequireConfirmation({
            command,
            level: analysis.level,
            reason: analysis.reason,
          });
          if (!confirmed) {
            return t.commandConfirm.userCancelled;
          }
        }
      }
    }
  }

  // File permission check for file-related tools
  const pathExtractor = FILE_TOOL_PATH_MAP[name];
  if (pathExtractor) {
    const pathInfo = pathExtractor(input);
    if (pathInfo) {
      // Use the appropriate check function based on capability
      const checkFn = pathInfo.capability === 'write'
        ? checkWritePath
        : (name === 'list_directory' ? checkListPath : checkReadPath);

      const pathCheck = await checkFn(pathInfo.path);

      if (!pathCheck.allowed) {
        if (pathCheck.needsPermission && pathCheck.permissionPath) {
          // Needs user permission — ask via callback
          if (onRequireFilePermission) {
            const granted = await onRequireFilePermission({
              path: pathCheck.permissionPath,
              capability: pathCheck.capability || pathInfo.capability,
              toolName: name,
            });
            if (!granted) {
              return `[${t.toolErrors.userDeniedAccess} ${pathCheck.permissionPath}]`;
            }
            // Permission granted — re-check (should now pass since authorizeWorkspace was called)
            const recheck = await checkFn(pathInfo.path);
            if (!recheck.allowed) {
              return `Error: ${recheck.reason || t.toolErrors.pathAccessDenied}`;
            }
          } else {
            // No callback available (shouldn't happen in normal flow)
            return `Error: ${t.toolErrors.needsAuthorization} ${pathCheck.permissionPath}`;
          }
        } else {
          // Hard blocked
          return `Error: ${pathCheck.reason}`;
        }
      }
    }
  }

  // Determine actual tool to run, respecting MCP overrides
  const mcpTools = mcpManager.listTools();

  // 1. Check if name is an MCP tool override (e.g., "web_search" -> "brave-search__web_search")
  for (const mcpTool of mcpTools) {
    if (mcpTool.name.endsWith(`__${name}`)) {
      const parts = mcpTool.name.split('__');
      const serverName = parts[0];
      const toolName = parts[parts.length - 1];
      if (mcpManager.isConnected(serverName)) {
        console.log(`[Tools] Executing MCP override: ${mcpTool.name} for ${name}`);
        const result = await mcpManager.callTool(serverName, toolName, input);
        return truncateToolResult(name, result);
      }
    }
  }

  // 2. Check builtin tools
  if (toolRegistry.has(name)) {
    const result = await toolRegistry.execute(name, input);
    // Only truncate string results; rich content (images) passes through
    if (typeof result === 'string') {
      return truncateToolResult(name, result);
    }
    return result;
  }

  if (name.includes('__')) {
    const [serverName, toolName] = name.split('__', 2);
    if (mcpManager.isConnected(serverName)) {
      const result = await mcpManager.callTool(serverName, toolName, input);
      return truncateToolResult(name, result);
    } else {
      console.warn(`[Registry] MCP server "${serverName}" is not connected. Connected servers:`, mcpManager.getConnectedServers());
    }
  }

  return `Error: Unknown tool "${name}" (Disconnected or not found). Connected MCP servers: ${mcpManager.getConnectedServers().join(', ') || 'none'}`;
}

// Re-export types for convenience
export type { ConfirmationInfo, DangerLevel };
