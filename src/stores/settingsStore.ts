import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LLMProvider, ApiFormat, ProviderCapabilities } from '../types';
import type { WebSearchProviderType } from '../core/search/providers';
import { setLanguage, initLanguage, type LanguageSetting } from '@/i18n';
import type { UpdateInfo } from '@/core/updates/checker';
// Provider config type
type ProviderConfig = {
  name: string;
  baseUrl: string;
  format: ApiFormat;
  models: { id: string; label: string }[];
  capabilities?: ProviderCapabilities;
};

// Single source of truth for all provider configurations
export const PROVIDER_CONFIGS = {
  volcengine: {
    name: '火山引擎 (Volcengine)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    format: 'openai-compatible',
    models: [
      { id: 'doubao-seed-2-0-pro-260215', label: 'Doubao Seed 2.0 Pro' },
      { id: 'doubao-seed-code-preview-251028', label: 'Doubao Seed Code Preview' },
      { id: 'doubao-seed-translation-250915', label: 'Doubao Seed Translation' },
      { id: 'doubao-seed-1-6-vision-250815', label: 'Doubao Seed 1.6 Vision' },
      { id: 'doubao-seed-1-6-flash-250828', label: 'Doubao Seed 1.6 Flash' },
    ],
    capabilities: {
      webSearch: { type: 'tool', toolSpec: { type: 'web_search', web_search: { enable: true } } },
    },
  },
  bailian: {
    name: '阿里百炼 (Bailian)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    format: 'openai-compatible',
    models: [
      { id: 'qwen-max', label: 'Qwen Max' },
      { id: 'qwen-plus', label: 'Qwen Plus' },
      { id: 'qwen-turbo', label: 'Qwen Turbo' },
      { id: 'qwen-long', label: 'Qwen Long' },
    ],
    capabilities: {
      webSearch: { type: 'parameter', paramName: 'enable_search', paramValue: true },
      imageGen: true,
    },
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    format: 'anthropic',
    models: [
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ],
    capabilities: {
      webSearch: { type: 'tool', toolSpec: { type: 'web_search_20250305', name: 'web_search', max_uses: 5 } },
    },
  },
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    format: 'openai-compatible',
    models: [
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    ],
    capabilities: {
      imageGen: true,
    },
  },
  deepseek: {
    name: '深度求索 (DeepSeek)',
    baseUrl: 'https://api.deepseek.com',
    format: 'openai-compatible',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek V3.2' },
      { id: 'deepseek-reasoner', label: 'DeepSeek R1' },
    ],
  },
  moonshot: {
    name: '月之暗面 (Moonshot)',
    baseUrl: 'https://api.moonshot.cn',
    format: 'openai-compatible',
    models: [
      { id: 'moonshot-v1-8k', label: 'Moonshot v1 8K' },
      { id: 'moonshot-v1-32k', label: 'Moonshot v1 32K' },
      { id: 'moonshot-v1-128k', label: 'Moonshot v1 128K' },
    ],
    capabilities: {
      webSearch: { type: 'tool', toolSpec: { type: 'builtin_function', function: { name: '$web_search' } } },
    },
  },
  zhipu: {
    name: '智谱 AI (Zhipu)',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    format: 'openai-compatible',
    models: [
      { id: 'glm-5', label: 'GLM-5' },
      { id: 'glm-4.7', label: 'GLM-4.7' },
      { id: 'glm-4.7-flash', label: 'GLM-4.7 Flash (免费)' },
      { id: 'glm-4.6v', label: 'GLM-4.6V' },
    ],
    capabilities: {
      webSearch: { type: 'tool', toolSpec: { type: 'web_search', web_search: { enable: true, search_engine: 'search_pro' } } },
      imageGen: true,
    },
  },
  siliconflow: {
    name: '硅基流动 (SiliconFlow)',
    baseUrl: 'https://api.siliconflow.cn',
    format: 'openai-compatible',
    models: [
      { id: 'deepseek-ai/DeepSeek-V3.2', label: 'DeepSeek V3.2' },
      { id: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen 2.5 72B' },
      { id: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B' },
    ],
    capabilities: {
      imageGen: true,
    },
  },
  qiniu: {
    name: '七牛云 (Qiniu)',
    baseUrl: 'https://api.qnaigc.com',
    format: 'openai-compatible',
    models: [
      { id: 'deepseek/deepseek-v3.2-251201', label: 'DeepSeek V3.2' },
      { id: 'deepseek-r1-0528', label: 'DeepSeek R1-0528' },
      { id: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5' },
      { id: 'moonshotai/kimi-k2-thinking', label: 'Kimi K2 Thinking' },
      { id: 'minimax/minimax-m2.5', label: 'Minimax M2.5' },
      { id: 'minimax/minimax-m2.1', label: 'Minimax M2.1' },
      { id: 'z-ai/glm-5', label: 'GLM 5' },
      { id: 'qwen3-max', label: 'Qwen3 Max' },
      { id: 'doubao-seed-2.0-pro', label: 'Doubao Seed 2.0 Pro' },
      { id: 'doubao-seed-2.0-code', label: 'Doubao Seed 2.0 Code' },
    ],
  },
  minimax: {
    name: 'MiniMax',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    format: 'anthropic',
    models: [
      { id: 'minimax-m2.5-highspeed', label: 'MiniMax M2.5 HighSpeed' },
      { id: 'minimax-m2.5', label: 'MiniMax M2.5' },
      { id: 'minimax-m2.1', label: 'MiniMax M2.1' },
    ],
  },
  local: { name: '本地模型 (Local)', baseUrl: '', format: 'openai-compatible', models: [] },
  custom: { name: '自定义 API', baseUrl: '', format: 'openai-compatible', models: [] },
} as Record<LLMProvider, ProviderConfig>;

/** Returns the list of providers available for the current edition */
export function getAvailableProviders(): LLMProvider[] {
  return Object.keys(PROVIDER_CONFIGS) as LLMProvider[];
}

// Derived from PROVIDER_CONFIGS — keeps existing consumers unchanged
export const AVAILABLE_MODELS = Object.fromEntries(
  Object.entries(PROVIDER_CONFIGS).map(([k, v]) => [k, v.models])
) as Record<LLMProvider, { id: string; label: string }[]>;

// View mode for main area
export type ViewMode = 'chat' | 'schedule' | 'toolbox' | 'settings';

// System settings tabs
export type SystemSettingsTab = 'general' | 'ai-services' | 'sandbox' | 'about';

// Toolbox tabs (Skills, MCP)
export type ToolboxTab = 'skills' | 'mcp';

interface SettingsState {
  provider: LLMProvider;
  apiFormat: ApiFormat;
  model: string;
  customModel: string;
  apiKey: string;
  baseUrl: string;
  theme: 'dark' | 'light';
  showSettings: boolean;
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  // New: Advanced LLM parameters
  temperature: number;
  enableThinking: boolean;
  thinkingBudget: number;
  // Context window settings
  maxOutputTokens: number;
  contextWindowSize: number;
  // Image generation settings
  imageGenApiKey: string;
  imageGenBaseUrl: string;
  imageGenModel: string;
  // Web search settings
  useBuiltinWebSearch: boolean;
  webSearchProvider: WebSearchProviderType;
  webSearchApiKey: string;
  webSearchBaseUrl: string;
  // New: Language setting
  language: LanguageSetting;
  // System settings tab
  activeSystemTab: SystemSettingsTab;
  // Toolbox tab
  activeToolboxTab: ToolboxTab;
  toolboxSearchQuery: string;
  installingItem: string | null;
  // View mode
  viewMode: ViewMode;
  // Workspace access (legacy persisted key: sandboxEnabled)
  sandboxEnabled: boolean;
  // Network isolation
  networkIsolationEnabled: boolean;
  networkWhitelist: string[];
  allowPrivateNetworks: boolean;
  // Window close behavior
  closeAction: 'ask' | 'minimize' | 'quit';
  // Update checker state
  updateInfo: UpdateInfo | null;
  updateChecking: boolean;
  lastUpdateCheck: number;
  // User profile
  userNickname: string;
  userAvatar: string; // data URI or empty
  // Guide
  guideShown: boolean; // true after user has dismissed the guide
  // Behavior sensor
  behaviorSensorEnabled: boolean;
  // Computer Use (screenshot + keyboard/mouse simulation)
  computerUseEnabled: boolean;
  // New: Embedding settings
  embeddingProvider: 'local' | 'openai' | 'openai-compatible';
  embeddingModel: string;
  embeddingDimensions: number;
  embeddingApiKey: string;
  embeddingBaseUrl: string;
  // New: Agent Loop v2 (controlled rollout)
  enableAgentV2: boolean;
}

interface SettingsActions {
  setProvider: (provider: LLMProvider) => void;
  setApiFormat: (format: ApiFormat) => void;
  setModel: (model: string) => void;
  setCustomModel: (model: string) => void;
  setApiKey: (key: string) => void;
  setBaseUrl: (url: string) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  toggleSettings: () => void;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  setRightPanelCollapsed: (collapsed: boolean) => void;
  // New actions
  setTemperature: (temp: number) => void;
  setEnableThinking: (enabled: boolean) => void;
  setThinkingBudget: (budget: number) => void;
  setMaxOutputTokens: (tokens: number) => void;
  setContextWindowSize: (size: number) => void;
  // Image generation actions
  setImageGenApiKey: (key: string) => void;
  setImageGenBaseUrl: (url: string) => void;
  setImageGenModel: (model: string) => void;
  // Web search actions
  setUseBuiltinWebSearch: (enabled: boolean) => void;
  setWebSearchProvider: (provider: WebSearchProviderType) => void;
  setWebSearchApiKey: (key: string) => void;
  setWebSearchBaseUrl: (url: string) => void;
  // Language action
  setLanguage: (lang: LanguageSetting) => void;
  // System settings modal actions
  openSystemSettings: (tab?: SystemSettingsTab) => void;
  closeSystemSettings: () => void;
  setActiveSystemTab: (tab: SystemSettingsTab) => void;
  // Toolbox modal actions
  openToolbox: (tab?: ToolboxTab) => void;
  closeToolbox: () => void;
  setActiveToolboxTab: (tab: ToolboxTab) => void;
  setToolboxSearchQuery: (query: string) => void;
  setInstallingItem: (itemId: string | null) => void;
  // View mode action
  setViewMode: (mode: ViewMode) => void;
  // Unified provider switch (sets provider + format + baseUrl + model atomically)
  switchProvider: (provider: LLMProvider) => void;
  // Workspace access (legacy persisted key: sandboxEnabled)
  setSandboxEnabled: (enabled: boolean) => void;
  // Network isolation
  setNetworkIsolationEnabled: (enabled: boolean) => void;
  setNetworkWhitelist: (whitelist: string[]) => void;
  setAllowPrivateNetworks: (allow: boolean) => void;
  // Window close behavior
  setCloseAction: (action: 'ask' | 'minimize' | 'quit') => void;
  // Update checker actions
  setUpdateInfo: (info: UpdateInfo | null) => void;
  setUpdateChecking: (checking: boolean) => void;
  setLastUpdateCheck: (time: number) => void;
  // User profile actions
  setUserNickname: (nickname: string) => void;
  setUserAvatar: (avatar: string) => void;
  setGuideShown: (shown: boolean) => void;
  setBehaviorSensorEnabled: (enabled: boolean) => void;
  setComputerUseEnabled: (enabled: boolean) => void;
  // New embedding actions
  setEmbeddingProvider: (provider: 'local' | 'openai' | 'openai-compatible') => void;
  setEmbeddingModel: (model: string) => void;
  setEmbeddingDimensions: (dims: number) => void;
  setEmbeddingApiKey: (key: string) => void;
  setEmbeddingBaseUrl: (url: string) => void;
  setEnableAgentV2: (enabled: boolean) => void;
}

/** Returns the effective model ID to use for API calls */
export function getEffectiveModel(state: SettingsState): string {
  if (state.model === '__custom__') {
    if (state.customModel) return state.customModel;
    // Fallback: use current provider's first model
    return AVAILABLE_MODELS[state.provider]?.[0]?.id || AVAILABLE_MODELS.anthropic[0].id;
  }
  return state.model;
}

/** Check if a model ID belongs to the current provider */
export function isModelCompatible(modelId: string, provider: LLMProvider): boolean {
  if (provider === 'custom') return true; // custom provider accepts any model
  const models = AVAILABLE_MODELS[provider];
  if (!models) return false;
  return models.some((m) => m.id === modelId);
}

/**
 * Resolve an agent's model field into the actual model ID to use.
 * - 'inherit' / empty / undefined → use global effective model
 * - model belongs to current provider → use as-is
 * - model does NOT belong to current provider → fall back to global effective model
 */
export function resolveAgentModel(agentModel: string | undefined, state: SettingsState): string {
  const globalModel = getEffectiveModel(state);
  if (!agentModel || agentModel === 'inherit') return globalModel;
  // If using custom provider, trust the agent's model as-is
  if (state.provider === 'custom') return agentModel;
  // Check compatibility with current provider
  if (isModelCompatible(agentModel, state.provider)) return agentModel;
  // Incompatible → fall back to global
  return globalModel;
}

export type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      provider: 'qiniu' as LLMProvider,
      apiFormat: 'openai-compatible' as ApiFormat,
      model: 'deepseek/deepseek-v3.2-251201',
      customModel: '',
      apiKey: '',
      baseUrl: 'https://api.qnaigc.com',
      theme: 'dark',
      showSettings: false,
      sidebarCollapsed: false,
      rightPanelCollapsed: false,
      // New defaults
      temperature: 0.7,
      enableThinking: false,
      thinkingBudget: 10000,
      maxOutputTokens: 8192,
      contextWindowSize: 200000,
      // Image generation defaults
      imageGenApiKey: '',
      imageGenBaseUrl: '',
      imageGenModel: 'dall-e-3',
      // Web search defaults
      useBuiltinWebSearch: true,
      webSearchProvider: 'brave' as WebSearchProviderType,
      webSearchApiKey: '',
      webSearchBaseUrl: '',
      // Language default
      language: 'system' as LanguageSetting,
      // System settings defaults
      activeSystemTab: 'ai-services' as SystemSettingsTab,
      // Toolbox defaults
      activeToolboxTab: 'skills' as ToolboxTab,
      toolboxSearchQuery: '',
      installingItem: null,
      viewMode: 'chat' as ViewMode,
      sandboxEnabled: true,
      networkIsolationEnabled: false,
      networkWhitelist: [],
      allowPrivateNetworks: true,
      closeAction: 'ask' as 'ask' | 'minimize' | 'quit',
      // Update checker defaults (updateInfo and updateChecking are ephemeral)
      updateInfo: null,
      updateChecking: false,
      lastUpdateCheck: 0,
      // User profile defaults
      userNickname: '',
      userAvatar: '',
      guideShown: false,
      behaviorSensorEnabled: false,
      computerUseEnabled: false,
      // Embedding settings
      embeddingProvider: 'local' as const,
      embeddingModel: 'hf:ggml-org/embeddinggemma-300m-qat-q8_0-GGUF/embeddinggemma-300m-qat-Q8_0.gguf',
      embeddingDimensions: 768,
      embeddingApiKey: '',
      embeddingBaseUrl: '',
      enableAgentV2: true,

      setProvider: (provider) => set({ provider }),
      setApiFormat: (apiFormat) => set({ apiFormat }),
      setModel: (model) => set({ model }),
      setCustomModel: (model) => set({ customModel: model }),
      setApiKey: (key) => set({ apiKey: key }),
      setBaseUrl: (url) => set({ baseUrl: url }),
      setTheme: (theme) => set({ theme }),
      toggleSettings: () => set((s) => ({ showSettings: !s.showSettings })),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      toggleRightPanel: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
      setRightPanelCollapsed: (collapsed) => set({ rightPanelCollapsed: collapsed }),
      // New actions
      setTemperature: (temperature) => set({ temperature }),
      setEnableThinking: (enableThinking) => set({ enableThinking }),
      setThinkingBudget: (thinkingBudget) => set({ thinkingBudget }),
      setMaxOutputTokens: (maxOutputTokens) => set({ maxOutputTokens }),
      setContextWindowSize: (contextWindowSize) => set({ contextWindowSize }),
      // Image generation actions
      setImageGenApiKey: (imageGenApiKey) => set({ imageGenApiKey }),
      setImageGenBaseUrl: (imageGenBaseUrl) => set({ imageGenBaseUrl }),
      setImageGenModel: (imageGenModel) => set({ imageGenModel }),
      // Web search actions
      setUseBuiltinWebSearch: (useBuiltinWebSearch) => set({ useBuiltinWebSearch }),
      setWebSearchProvider: (webSearchProvider) => set({ webSearchProvider }),
      setWebSearchApiKey: (webSearchApiKey) => set({ webSearchApiKey }),
      setWebSearchBaseUrl: (webSearchBaseUrl) => set({ webSearchBaseUrl }),
      // Language action - updates both store and i18n module
      setLanguage: (lang) => {
        setLanguage(lang);
        set({ language: lang });
      },
      // System settings actions
      openSystemSettings: (tab) =>
        set((s) => ({
          viewMode: 'settings' as ViewMode,
          activeSystemTab: tab ?? s.activeSystemTab,
        })),
      closeSystemSettings: () =>
        set({ viewMode: 'chat' as ViewMode }),
      setActiveSystemTab: (tab) => set({ activeSystemTab: tab }),
      // Toolbox actions
      openToolbox: (tab) =>
        set(() => ({
          viewMode: 'toolbox' as ViewMode,
          activeToolboxTab: tab ?? 'skills',
          toolboxSearchQuery: '',
        })),
      closeToolbox: () =>
        set({
          viewMode: 'chat' as ViewMode,
          installingItem: null,
          toolboxSearchQuery: '',
        }),
      setActiveToolboxTab: (tab) => set({ activeToolboxTab: tab, toolboxSearchQuery: '' }),
      setToolboxSearchQuery: (query) => set({ toolboxSearchQuery: query }),
      setInstallingItem: (itemId) => set({ installingItem: itemId }),
      setViewMode: (viewMode) => set({ viewMode }),
      setSandboxEnabled: (sandboxEnabled) => set({ sandboxEnabled }),
      setNetworkIsolationEnabled: (networkIsolationEnabled) => set({ networkIsolationEnabled }),
      setNetworkWhitelist: (networkWhitelist) => set({ networkWhitelist }),
      setAllowPrivateNetworks: (allowPrivateNetworks) => set({ allowPrivateNetworks }),
      setCloseAction: (closeAction) => set({ closeAction }),
      // Update checker actions
      setUpdateInfo: (updateInfo) => set({ updateInfo }),
      setUpdateChecking: (updateChecking) => set({ updateChecking }),
      setLastUpdateCheck: (lastUpdateCheck) => set({ lastUpdateCheck }),
      // User profile actions
      setUserNickname: (userNickname) => set({ userNickname }),
      setUserAvatar: (userAvatar) => set({ userAvatar }),
      setGuideShown: (guideShown) => set({ guideShown }),
      setBehaviorSensorEnabled: (behaviorSensorEnabled) => set({ behaviorSensorEnabled }),
      setComputerUseEnabled: (computerUseEnabled) => set({ computerUseEnabled }),
      setEmbeddingProvider: (embeddingProvider) => set({ embeddingProvider }),
      setEmbeddingModel: (embeddingModel) => set({ embeddingModel }),
      setEmbeddingDimensions: (embeddingDimensions) => set({ embeddingDimensions }),
      setEmbeddingApiKey: (embeddingApiKey) => set({ embeddingApiKey }),
      setEmbeddingBaseUrl: (embeddingBaseUrl) => set({ embeddingBaseUrl }),
      setEnableAgentV2: (enableAgentV2) => set({ enableAgentV2 }),
      switchProvider: (p) => {
        const config = PROVIDER_CONFIGS[p];
        if (p === 'custom') {
          set({ provider: p, apiFormat: config.format, baseUrl: '', model: '__custom__' });
        } else {
          set({
            provider: p,
            apiFormat: config.format,
            baseUrl: config.baseUrl,
            model: config.models[0]?.id ?? '__custom__',
          });
        }
      },
    }),
    {
      name: 'ruyi-settings',
      version: 6,
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Record<string, unknown>;
        if (version < 5) {
          if (state.computerUseEnabled === undefined) state.computerUseEnabled = false;
        }
        if (version < 4) {
          if (state.behaviorSensorEnabled === undefined) state.behaviorSensorEnabled = false;
        }
        if (version < 3) {
          if (state.networkIsolationEnabled === undefined) state.networkIsolationEnabled = false;
          if (state.networkWhitelist === undefined) state.networkWhitelist = [];
          if (state.allowPrivateNetworks === undefined) state.allowPrivateNetworks = true;
        }
        if (version < 2) {
          if (state.userNickname === undefined) state.userNickname = '';
          if (state.userAvatar === undefined) state.userAvatar = '';
          if (state.guideShown === undefined) state.guideShown = false;
        }
        if (version === 0) {
          // Legacy GUI-managed MCP was replaced by nanobot MCP presets.
          delete state.mcpServers;

          // Fix zhipu baseUrl (was /api/paas, now /api/paas/v4)
          if (state.provider === 'zhipu' && state.baseUrl === 'https://open.bigmodel.cn/api/paas') {
            state.baseUrl = 'https://open.bigmodel.cn/api/paas/v4';
          }

          // Ensure new fields have defaults (defensive — shallow merge handles this too)
          if (state.sandboxEnabled === undefined) state.sandboxEnabled = true;
          if (state.closeAction === undefined) state.closeAction = 'ask';
          if (state.lastUpdateCheck === undefined) state.lastUpdateCheck = 0;
        }
        return state;
      },
      // TODO: [SECURITY] API keys are persisted in plaintext via localStorage.
      // Migrate to safe secure storage (macOS Keychain / Windows Credential Store)
      // for production-grade security.
      partialize: (state) => ({
        provider: state.provider,
        apiFormat: state.apiFormat,
        model: state.model,
        customModel: state.customModel,
        apiKey: state.apiKey,
        baseUrl: state.baseUrl,
        theme: state.theme,
        language: state.language,
        temperature: state.temperature,
        enableThinking: state.enableThinking,
        thinkingBudget: state.thinkingBudget,
        maxOutputTokens: state.maxOutputTokens,
        contextWindowSize: state.contextWindowSize,
        imageGenApiKey: state.imageGenApiKey,
        imageGenBaseUrl: state.imageGenBaseUrl,
        imageGenModel: state.imageGenModel,
        useBuiltinWebSearch: state.useBuiltinWebSearch,
        webSearchProvider: state.webSearchProvider,
        webSearchApiKey: state.webSearchApiKey,
        webSearchBaseUrl: state.webSearchBaseUrl,
        sidebarCollapsed: state.sidebarCollapsed,
        rightPanelCollapsed: state.rightPanelCollapsed,
        sandboxEnabled: state.sandboxEnabled,
        networkIsolationEnabled: state.networkIsolationEnabled,
        networkWhitelist: state.networkWhitelist,
        allowPrivateNetworks: state.allowPrivateNetworks,
        closeAction: state.closeAction,
        lastUpdateCheck: state.lastUpdateCheck,
        userNickname: state.userNickname,
        userAvatar: state.userAvatar,
        guideShown: state.guideShown,
        behaviorSensorEnabled: state.behaviorSensorEnabled,
        computerUseEnabled: state.computerUseEnabled,
        embeddingProvider: state.embeddingProvider,
        embeddingModel: state.embeddingModel,
        embeddingDimensions: state.embeddingDimensions,
        embeddingApiKey: state.embeddingApiKey,
        embeddingBaseUrl: state.embeddingBaseUrl,
        enableAgentV2: state.enableAgentV2,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Initialize i18n module with persisted language setting
        if (state.language) {
          initLanguage(state.language);
        }
        // Runtime fix: reset provider unavailable in current edition
        const availableProviders = getAvailableProviders();
        if (!availableProviders.includes(state.provider)) {
          state.provider = 'anthropic' as LLMProvider;
          state.apiFormat = 'anthropic' as ApiFormat;
          state.model = 'claude-sonnet-4-6';
          state.baseUrl = PROVIDER_CONFIGS.anthropic.baseUrl;
        }
        const cfg = PROVIDER_CONFIGS[state.provider];
        // Runtime fix: stale baseUrl from provider-switch bug
        if (state.provider !== 'custom' && !state.baseUrl && cfg?.baseUrl) {
          state.baseUrl = cfg.baseUrl;
        }
        // Runtime fix: apiFormat mismatch after provider switch
        if (state.provider !== 'custom' && cfg) {
          state.apiFormat = cfg.format;
        }
        // Runtime fix: stale model='__custom__' from provider-switch bug
        if (state.provider !== 'custom' && state.model === '__custom__') {
          state.model = cfg?.models[0]?.id ?? 'claude-sonnet-4-6';
        }
        // Runtime fix: validate persisted model ID still exists for this provider
        if (state.provider !== 'custom' && state.model !== '__custom__' && cfg?.models.length) {
          const modelExists = cfg.models.some(m => m.id === state.model);
          if (!modelExists) {
            state.model = cfg.models[0].id;
          }
        }
        // Force reset UI state
        state.showSettings = false;
        state.activeSystemTab = 'ai-services';
        state.activeToolboxTab = 'skills';
        state.toolboxSearchQuery = '';
        state.installingItem = null;
        state.viewMode = 'chat';
      },
    }
  )
);
