import type { Message } from '../../types';
import type { LLMAdapter } from '../llm/adapter';
import { getAllTools } from '../tools/registry';
import { useSettingsStore, getEffectiveModel } from '../../stores/settingsStore';
import { useChatStore } from '../../stores/chatStore';
import { matchesToolName, parseToolPatterns } from '../skill/toolFilter';
import { prepareContextMessages, trimOldScreenshots } from '../context/contextManager';
import { compressContextIfNeeded } from '../context/contextCompressor';
import { identifyRounds, RECENT_ROUNDS_TO_KEEP } from '../context/contextUtils';
import { getBuiltinSearchConfig } from '../capabilities';
import { buildSystemPrompt } from '../agent/orchestrator';
import { formatTodosForPrompt } from '../agent/todoManager';
import { skillLoader } from '../skill/loader';
import { substituteVariables } from '../skill/preprocessor';
import { type ToolDefinition } from '../../types';

export class ContextEngine {
  private conversationId: string;
  private adapter: LLMAdapter;
  private settings;

  constructor(conversationId: string, adapter: LLMAdapter) {
    this.conversationId = conversationId;
    this.adapter = adapter;
    this.settings = useSettingsStore.getState();
  }

  public async buildEffectivePrompt(
    route: any,
    baseSystemPrompt: string,
    historyMessages: Message[],
    turnCount: number,
    options: {
      maxOutputTokens: number;
      contextWindowSize: number;
      signal: AbortSignal;
    }
  ) {
    const { tools, inputValidators } = this.resolveTools(route);

    // Initial system prompt construction using existing orchestrator logic
    const basePrompt = await buildSystemPrompt(
      route,
      baseSystemPrompt,
      this.conversationId
    );

    // Dynamic per-turn sections for situational awareness
    const dynamicCapabilities = this.buildDynamicCapabilities(tools);
    const todoState = formatTodosForPrompt(this.conversationId);
    
    const conv = useChatStore.getState().conversations[this.conversationId];
    const activeSkillContent = this.loadActiveSkillContent(
      conv?.activeSkills,
      conv?.activeSkillArgs
    );

    // Combine into final effective system prompt
    const effectiveSystemPrompt = [
      basePrompt,
      dynamicCapabilities,
      activeSkillContent,
      todoState,
    ].filter(Boolean).join('\n\n');

    console.log('[AgentV2:Context] Effective System Prompt Length:', effectiveSystemPrompt.length);
    if (effectiveSystemPrompt.length > 5000) {
      console.log('[AgentV2:Context] WARNING: Extremely large system prompt detected!');
    }

    // Context compression and management
    let messagesForContext = historyMessages;
    if (turnCount >= 3) {
      messagesForContext = await this.handleCompression(
        historyMessages,
        effectiveSystemPrompt,
        options
      );
    }

    // Trim old screenshots and prepare final message list
    const trimmed = trimOldScreenshots(messagesForContext);
    const preparedMessages = prepareContextMessages(
      trimmed,
      effectiveSystemPrompt,
      options.contextWindowSize,
      options.maxOutputTokens
    );

    return {
      preparedMessages,
      effectiveSystemPrompt,
      tools,
      inputValidators,
    };
  }

  private resolveTools(route: any) {
    const builtinWebSearch = getBuiltinSearchConfig(this.settings.provider, this.settings.useBuiltinWebSearch);
    let tools = getAllTools();
    let inputValidators = new Map<string, (input: Record<string, unknown>) => boolean>();

    if (route.type === 'skill' && route.skill?.allowedTools) {
      const patterns = route.skill.allowedTools;
      const { inputValidators: validators } = parseToolPatterns(patterns);
      inputValidators = validators;
      tools = tools.filter(t => patterns.some((pattern: string) => matchesToolName(t.name, pattern)));
    }
    if (route.type === 'agent' && route.definition) {
      const def = route.definition;
      if (def.tools?.length > 0) tools = tools.filter(t => new Set(def.tools).has(t.name));
      if (def.disallowedTools?.length > 0) tools = tools.filter(t => !new Set(def.disallowedTools).has(t.name));
    }
    if (builtinWebSearch) tools = tools.filter(t => t.name !== 'web_search');

    return { tools, inputValidators };
  }

  /** Ported from legacy agentLoop: descriptions of currently available MCP tools */
  private buildDynamicCapabilities(tools: ToolDefinition[]): string {
    const mcpTools = tools.filter(t => t.name.includes('__'));
    if (mcpTools.length === 0) return '';

    const byServer = new Map<string, string[]>();
    for (const t of mcpTools) {
      const [server, toolName] = t.name.split('__', 2);
      if (!byServer.has(server)) byServer.set(server, []);
      byServer.get(server)!.push(toolName);
    }
    const lines = Array.from(byServer.entries()).map(
      ([server, toolNames]) => `- ${server}: ${toolNames.join(', ')}`
    );
    return `## 当前已连接的 MCP 工具\n${lines.join('\n')}`;
  }

  /** Ported from legacy agentLoop: skill instructions with variable substitution */
  private loadActiveSkillContent(
    activeSkills: string[] | undefined,
    activeSkillArgs?: Record<string, string>
  ): string {
    if (!activeSkills || activeSkills.length === 0) return '';
    const skillContents = activeSkills
      .map(name => {
        const s = skillLoader.getSkill(name);
        if (!s) return null;
        const args = activeSkillArgs?.[name] ?? '';
        const processed = substituteVariables(s.content, args, s.skillDir, this.conversationId);
        return `### ${s.name}\n${processed}`;
      })
      .filter((s): s is string => s !== null);
    if (skillContents.length === 0) return '';
    return `## Active Skill Instructions\n${skillContents.join('\n\n')}`;
  }

  private async handleCompression(
    history: Message[],
    systemPrompt: string,
    options: { contextWindowSize: number; maxOutputTokens: number; signal: AbortSignal }
  ): Promise<Message[]> {
    const chatStore = useChatStore.getState();
    const conv = chatStore.conversations[this.conversationId];
    const cache = conv?.contextCache;

    if (cache && cache.messageCountAtCompression <= history.length) {
      const rounds = identifyRounds(history);
      const newMessages = history.slice(cache.summarizedRange[1]);
      return [...(rounds[0] ?? []), cache.summaryMessage, ...newMessages];
    }

    try {
      const compressionResult = await compressContextIfNeeded(
        history,
        systemPrompt,
        options.contextWindowSize,
        options.maxOutputTokens,
        {
          adapter: this.adapter,
          model: getEffectiveModel(this.settings),
          apiKey: this.settings.apiKey,
          baseUrl: this.settings.baseUrl || undefined,
          signal: options.signal,
        }
      );

      if (compressionResult.compressed) {
        const summaryMsg = compressionResult.messages.find(m => m.id.startsWith('context-summary-'));
        if (summaryMsg) {
          const rounds = identifyRounds(history);
          const recentMsgCount = rounds.slice(-RECENT_ROUNDS_TO_KEEP).flat().length;
          chatStore.setContextCache(this.conversationId, {
            summaryMessage: summaryMsg,
            summarizedRange: [rounds[0].length, history.length - recentMsgCount],
            messageCountAtCompression: history.length,
          });
        }
        return compressionResult.messages;
      }
    } catch { /* ignore compression errors */ }

    return history;
  }
}
