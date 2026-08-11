import { useCallback, useEffect, useMemo, useState } from "react";
import HelpManual from "./HelpManual";
import {
  AlertCircle,
  ArrowLeft,
  BookOpenText,
  Check,
  ChevronDown,
  Cpu,
  ExternalLink,
  HelpCircle,
  ImagePlus,
  Keyboard,
  Link,
  Loader2,
  MessageSquare,
  Mic,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";


import {
  ApiError,
  createModelConfiguration,
  createProviderSettings,
  deleteModelConfiguration,
  deleteProviderSettings,
  fetchProviderModels,
  fetchSettings,
  fetchPersonalization,
  restorePersonalization,
  savePersonalization,
  updateModelConfiguration,
  updateModelDefault,
  updateProviderSettings,
  updateTranscriptionSettings,
} from "@/core/api";
import {
  bootstrapNanobotGateway,
  getNanobotStatus,
  getNanobotToken,
  refreshNanobotAuth,
  syncGatewaySettingsToStore,
} from "@/core/nanobotClient";
import type {
  SettingsPayload,
  ModelCapability,
  WebuiDefaultAccessMode,
  PersonalizationPayload,
} from "@/core/types";
import type { LanguageSetting } from "@/i18n";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { usePromptHubStore } from "@/stores/promptHubStore";
import { submitPromptHubFeedback } from "@/core/prompthubApi";
import { useSettingsStore } from "@/stores/settingsStore";
import { useToastStore } from "@/stores/toastStore";
import {
  ASSET_DEEPSEEK_MODEL_SERVICE,
  isProtectedBuiltinModelProvider,
} from "@/config/builtinModelServices";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { Textarea } from "@/components/ui/textarea";
import { shellBridge } from "@/lib/ipc-factory";
import { DEFAULT_KEYBOARD_SHORTCUTS, type FontSizeSetting, type ThemeMode, type ShortcutId } from "@/stores/settingsStore";

type TabKey =
  | "account"
  | "providers"
  | "models"
  | "voice"
  | "search"
  | "general"
  | "personalization"
  | "shortcuts"
  | "help";

type ProviderForm = {
  apiKey: string;
  apiBase: string;
  apiType: "auto" | "chat_completions" | "responses";
};

function uniqueModelPresets<T extends { provider: string; model: string }>(presets: T[]): T[] {
  const seen = new Set<string>();
  return presets.filter((preset) => {
    const key = `${preset.provider}\u0000${preset.model}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type VoiceForm = {
  enabled: boolean;
  language: string;
  maxDurationSec: number;
  apiKey: string;
  apiBase: string;
};

type SafetyForm = {
  webuiAllowLocalServiceAccess: boolean;
  webuiDefaultAccessMode: WebuiDefaultAccessMode;
};

type ActionKey = string;

const SETTINGS_GATEWAY_READY_TIMEOUT_MS = 15_000;
const SETTINGS_GATEWAY_POLL_INTERVAL_MS = 300;

function waitForSettingsGatewayPoll(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, SETTINGS_GATEWAY_POLL_INTERVAL_MS);
  });
}

const tabs: Array<{ key: TabKey; label: string; description: string; icon: typeof Cpu }> = [
  { key: "general", label: "系统设置", description: "语言、关闭行为、助手信息", icon: SlidersHorizontal },
  { key: "providers", label: "模型配置", description: "提供商 / API 密钥 / OAuth 授权", icon: Cpu },
  { key: "voice", label: "语音设置", description: "默认 ASR 模型和语音输入", icon: Mic },
  { key: "personalization", label: "个性化", description: "助手人格 SOUL.md 与用户画像 USER.md", icon: Sparkles },
];

const secondaryTabs: Array<{ key: TabKey | null; label: string; icon: typeof Cpu; disabled?: boolean }> = [
  { key: "account", label: "账户管理", icon: UserRound },
  { key: "shortcuts", label: "快捷键", icon: Keyboard },
  { key: "help", label: "帮助与反馈", icon: HelpCircle },
];

const settingsEnglish = {
  tabs: {
    general: { label: "System", description: "Language, behavior, and assistant preferences" },
    providers: { label: "Model Configuration", description: "Providers, API keys, and OAuth" },
    voice: { label: "Voice", description: "Default ASR model and voice input" },
    personalization: { label: "Personalization", description: "Assistant persona (SOUL.md) and user profile (USER.md)" },
    safety: { label: "Security", description: "Workspace permissions and local-service access" },
  },
  account: "Account",
  shortcuts: "Keyboard Shortcuts",
  help: "Help & Feedback",
  settings: "Settings",
  close: "Close settings",
};

const apiTypeOptions = [
  { value: "auto", label: "自动" },
  { value: "chat_completions", label: "对话补全 (Chat Completions)" },
  { value: "responses", label: "原始响应 (Responses)" },
];

const themeModeOptions: Array<{ value: ThemeMode; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "亮色" },
  { value: "dark", label: "暗色" },
];

const fontSizeOptions: Array<{ value: FontSizeSetting; label: string }> = [
  { value: "small", label: "小" },
  { value: "default", label: "默认" },
  { value: "medium", label: "" },
  { value: "large", label: "" },
  { value: "xlarge", label: "" },
  { value: "xxlarge", label: "大" },
];

const modelCapabilityOptions: Array<{
  value: ModelCapability;
  label: string;
  description: string;
}> = [
    { value: "text", label: "文字", description: "新会话与普通文字任务" },
    { value: "speech_to_text", label: "语音识别", description: "麦克风录音转文字（ASR）" },
  ];

function gatewayBase(port: number): string {
  return `http://127.0.0.1:${port}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || "未知错误");
}

function numberValue(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

function StatusPill({ ok, children }: { ok: boolean; children: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
        ok ? "bg-emerald-50 text-emerald-700" : "bg-[#f1eee8] text-[#777267]",
      )}
    >
      {ok ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
      {children}
    </span>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-[#403b2f]">{label}</span>
      {children}
      {hint ? <span className="text-xs leading-5 text-[#8b8578]">{hint}</span> : null}
    </label>
  );
}

function SettingsCard({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section data-settings-card className="rounded-lg bg-[#f7f7f8] p-4 dark:bg-[#262624]">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-[#202020] dark:text-[#e8e5de]">{title}</h2>
          {description ? <p className="mt-1 text-sm text-[#777267] dark:text-[#8a867c]">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function SettingsGroup({ children }: { children: React.ReactNode }) {
  return <section className="space-y-2">{children}</section>;
}

function SettingsRow({
  title,
  description,
  children,
  stacked = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  stacked?: boolean;
}) {
  return (
    <div data-settings-card className={cn("min-h-[64px] rounded-md bg-[#f7f7f8] px-4 py-3 dark:bg-[#262624]", stacked ? "space-y-3" : "flex items-center justify-between gap-6")}>
      <div className="min-w-0">
        <div className="text-[15px] font-semibold text-[#202020] dark:text-[#e8e5de]">{title}</div>
        {description ? <div className="mt-1 text-[13px] leading-5 text-[#6f6f73] dark:text-[#8a867c]">{description}</div> : null}
      </div>
      <div className={cn(stacked ? "w-full" : "flex min-w-[180px] flex-1 justify-end")}>{children}</div>
    </div>
  );
}

export function SettingsView({
  onBackToChat,
  onModelNameChange,
}: {
  onBackToChat?: () => void;
  onModelNameChange?: (modelName: string | null) => void;
}) {
  const { setting, locale } = useI18n();
  const isEnglish = locale === "en-US";
  const localizedTabs = useMemo(() => tabs.map((tab) => ({
    ...tab,
    ...(isEnglish ? settingsEnglish.tabs[tab.key as keyof typeof settingsEnglish.tabs] : undefined),
  })), [isEnglish]);
  const localizedSecondaryTabs = useMemo(() => secondaryTabs.map((tab) => {
    if (!isEnglish) return tab;
    const label = tab.key === "account"
      ? settingsEnglish.account
      : tab.key === "help"
        ? settingsEnglish.help
        : settingsEnglish.shortcuts;
    return { ...tab, label };
  }), [isEnglish]);
  const settingsStore = useSettingsStore();
  const promptHubUser = usePromptHubStore((state) => state.user);
  const promptHubBaseUrl = usePromptHubStore((state) => state.baseUrl);
  const openPromptHubLogin = usePromptHubStore((state) => state.openLogin);
  const logoutPromptHub = usePromptHubStore((state) => state.logout);
  const addToast = useToastStore((state) => state.addToast);

  const requestedSystemTab = useSettingsStore((state) => state.activeSystemTab);
  const initialTab: TabKey =
    requestedSystemTab === "ai-services"
      ? "providers"
      : requestedSystemTab === "sandbox" || requestedSystemTab === "about"
        ? "general"
        : requestedSystemTab;
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [apiBase, setApiBase] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<Record<ActionKey, boolean>>({});
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackImages, setFeedbackImages] = useState<string[]>([]);
  const [feedbackIncludeLogs, setFeedbackIncludeLogs] = useState(true);

  const [selectedProvider, setSelectedProvider] = useState("");
  const [voiceForm, setVoiceForm] = useState<VoiceForm>({
    enabled: false,
    language: "zh",
    maxDurationSec: 120,
    apiKey: "",
    apiBase: "",
  });
  const withAction = useCallback(
    async (id: ActionKey, task: () => Promise<void>, success?: string) => {
      setSaving((prev) => ({ ...prev, [id]: true }));
      try {
        await task();
        if (success) addToast({ type: "success", title: success });
      } catch (err) {
        addToast({ type: "error", title: "操作失败", message: toErrorMessage(err), duration: 5000 });
      } finally {
        setSaving((prev) => ({ ...prev, [id]: false }));
      }
    },
    [addToast],
  );

  const applyPayload = useCallback((payload: SettingsPayload) => {
    setSettings(payload);
    const activeProvider = payload.agent.provider || payload.providers[0]?.name || "";
    const provider = payload.providers.find((item) => item.name === activeProvider) ?? payload.providers[0];
    if (provider) {
      setSelectedProvider(provider.name);
    }

    const speechDefault = payload.model_defaults.speech_to_text;
    const speechPreset = speechDefault
      ? payload.model_presets.find((preset) => preset.name === speechDefault)
      : undefined;
    const voiceProvider = speechPreset
      ? payload.transcription.providers.find((provider) => provider.name === speechPreset.provider)
      : undefined;
    setVoiceForm({
      enabled: Boolean(speechPreset && payload.transcription.enabled),
      language: payload.transcription.language || "zh",
      maxDurationSec: payload.transcription.max_duration_sec,
      apiKey: "",
      apiBase: speechPreset
        ? voiceProvider?.api_base || voiceProvider?.default_api_base || ""
        : "",
    });
  }, []);

  useEffect(() => {
    const nextTab: TabKey =
      requestedSystemTab === "ai-services"
        ? "providers"
        : requestedSystemTab === "sandbox" || requestedSystemTab === "about"
          ? "general"
          : requestedSystemTab;
    setActiveTab(nextTab);
  }, [requestedSystemTab]);

  const refreshSettingsAuth = useCallback(async () => {
    const refreshed = await refreshNanobotAuth();
    setApiBase(refreshed.baseUrl);
    setToken(refreshed.token);
    return refreshed;
  }, []);

  const withGatewayAuth = useCallback(
    async <T,>(task: (authToken: string, base: string) => Promise<T>): Promise<T> => {
      try {
        return await task(token, apiBase);
      } catch (err) {
        if (!isUnauthorized(err)) throw err;
        const refreshed = await refreshSettingsAuth();
        return await task(refreshed.token, refreshed.baseUrl);
      }
    },
    [apiBase, refreshSettingsAuth, token],
  );

  const loadSettings = useCallback(
    async (base = apiBase, authToken = token, silent = false) => {
      if (!base || !authToken) return;
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        let settingsPayload: SettingsPayload;
        try {
          settingsPayload = await fetchSettings(authToken, base);
        } catch (err) {
          if (!isUnauthorized(err)) throw err;
          const refreshed = await refreshSettingsAuth();
          settingsPayload = await fetchSettings(refreshed.token, refreshed.baseUrl);
        }
        applyPayload(settingsPayload);
      } catch (err) {
        setError(toErrorMessage(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [apiBase, applyPayload, refreshSettingsAuth, token],
  );

  const initializeGateway = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const deadline = Date.now() + SETTINGS_GATEWAY_READY_TIMEOUT_MS;
      let status = await getNanobotStatus();
      let currentToken = getNanobotToken();
      let lastBootstrapError: unknown;

      while (Date.now() < deadline) {
        if (status.ready) {
          if (!currentToken) {
            try {
              await bootstrapNanobotGateway();
              currentToken = getNanobotToken();
            } catch (err) {
              lastBootstrapError = err;
            }
          }
          if (currentToken) break;
        }

        await waitForSettingsGatewayPoll();
        status = await getNanobotStatus();
        currentToken = getNanobotToken();
      }

      if (!status.ready || !currentToken) {
        throw lastBootstrapError instanceof Error
          ? lastBootstrapError
          : new Error(isEnglish ? "Settings service is temporarily unavailable." : "设置服务暂时不可用。");
      }
      const base = gatewayBase(status.port);
      setApiBase(base);
      setToken(currentToken);
      await loadSettings(base, currentToken);
    } catch (err) {
      setError(toErrorMessage(err));
      setLoading(false);
    }
  }, [isEnglish, loadSettings]);

  useEffect(() => {
    void initializeGateway();
  }, [initializeGateway]);

  const replaceSettings = useCallback(
    async (payload: SettingsPayload) => {
      applyPayload(payload);
      onModelNameChange?.(payload.agent.model);
      await syncGatewaySettingsToStore();
    },
    [applyPayload, onModelNameChange],
  );

  const createModelService = async (data: {
    providerName: string;
    apiBase: string;
    apiKey: string;
    apiType: ProviderForm["apiType"];
    models: string[];
  }) => {
    let completed = false;
    await withAction(
      "provider-create",
      async () => {
        const previousCustomProviders = new Set(settings?.providers.filter((provider) => provider.custom).map((provider) => provider.name) ?? []);
        const previousConfiguredProviders = new Set(
          settings?.providers.filter((provider) => provider.configured).map((provider) => provider.name) ?? [],
        );
        let providerKey = "";
        let shouldRollbackProvider = false;
        try {
          let payload = await withGatewayAuth((authToken, base) =>
            createProviderSettings(
              authToken,
              {
                name: data.providerName,
                apiBase: data.apiBase,
                apiKey: data.apiKey,
                apiType: data.apiType,
              },
              base,
            ),
          );
          providerKey =
            payload.provider_mutation?.name ??
            payload.providers.find((provider) => provider.custom && !previousCustomProviders.has(provider.name))?.name ??
            data.providerName.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
          shouldRollbackProvider =
            payload.provider_mutation?.created ?? !previousConfiguredProviders.has(providerKey);
          for (const model of data.models) {
            payload = await withGatewayAuth((authToken, base) =>
              createModelConfiguration(
                authToken,
                {
                  label: `${data.providerName} / ${model}`,
                  provider: providerKey,
                  model,
                },
                base,
              ),
            );
          }
          payload.providers = payload.providers.map((provider) =>
            provider.name === providerKey ? { ...provider, label: data.providerName } : provider,
          );
          payload.model_presets = payload.model_presets.map((preset) =>
            preset.provider === providerKey && !preset.is_default ? { ...preset, label: `${data.providerName} / ${preset.model}` } : preset,
          );
          await replaceSettings(payload);
          setSelectedProvider(providerKey);
          completed = true;
        } catch (error) {
          if (providerKey && shouldRollbackProvider) {
            try {
              await withGatewayAuth((authToken, base) =>
                deleteProviderSettings(authToken, providerKey, base),
              );
            } catch (rollbackError) {
              console.error("[Settings] failed to roll back partially created provider", rollbackError);
            }
          }
          throw error;
        }
      },
      "模型服务已添加",
    );
    return completed;
  };

  const updateModelService = (data: {
    provider: string;
    providerName: string;
    apiBase: string;
    apiKey: string;
    apiType: ProviderForm["apiType"];
    models: string[];
  }) =>
    withAction(
      "provider-update",
      async () => {
        const existingPresets = settings?.model_presets.filter((preset) => !preset.is_default && preset.provider === data.provider) ?? [];
        const targetModels = Array.from(new Set(data.models.map((model) => model.trim()).filter(Boolean)));
        if (
          isProtectedBuiltinModelProvider(data.provider) &&
          !targetModels.includes(ASSET_DEEPSEEK_MODEL_SERVICE.model)
        ) {
          targetModels.unshift(ASSET_DEEPSEEK_MODEL_SERVICE.model);
        }
        let payload = await withGatewayAuth((authToken, base) =>
          updateProviderSettings(
            authToken,
            {
              provider: data.provider,
              label: data.providerName,
              apiBase: data.apiBase,
              apiKey: data.apiKey.trim() || undefined,
              apiType: data.apiType,
            },
            base,
          ),
        );

        for (const preset of existingPresets) {
          if (!targetModels.includes(preset.model)) {
            payload = await withGatewayAuth((authToken, base) =>
              deleteModelConfiguration(authToken, preset.name, base),
            );
          }
        }

        for (const model of targetModels) {
          const existing = existingPresets.find((preset) => preset.model === model);
          if (existing) {
            payload = await withGatewayAuth((authToken, base) =>
              updateModelConfiguration(
                authToken,
                {
                  name: existing.name,
                  label: `${data.providerName} / ${model}`,
                  provider: data.provider,
                  model,
                },
                base,
              ),
            );
          } else {
            payload = await withGatewayAuth((authToken, base) =>
              createModelConfiguration(
                authToken,
                {
                  label: `${data.providerName} / ${model}`,
                  provider: data.provider,
                  model,
                },
                base,
              ),
            );
          }
        }

        payload.providers = payload.providers.map((provider) =>
          provider.name === data.provider ? { ...provider, label: data.providerName } : provider,
        );
        payload.model_presets = payload.model_presets.map((preset) =>
          preset.provider === data.provider && !preset.is_default ? { ...preset, label: `${data.providerName} / ${preset.model}` } : preset,
        );
        await replaceSettings(payload);
        setSelectedProvider(data.provider);
      },
      "模型服务已保存",
    );

  const deleteModelService = (provider: string) =>
    withAction(
      `provider-delete:${provider}`,
      async () => {
        const payload = await withGatewayAuth((authToken, base) =>
          deleteProviderSettings(authToken, provider, base),
        );
        await replaceSettings(payload);
        setSelectedProvider("");
      },
      "模型服务已删除",
    );

  const probeModelService = async (data: {
    apiBase: string;
    apiKey: string;
    apiType: ProviderForm["apiType"];
  }) => {
    let models: string[] = [];
    await withAction(
      "provider-probe",
      async () => {
        const payload = await withGatewayAuth((authToken, base) =>
          fetchProviderModels(
            authToken,
            {
              provider: "custom",
              apiBase: data.apiBase.trim(),
              apiKey: data.apiKey,
              apiType: data.apiType,
            },
            base,
          ),
        );
        if (payload.status !== "available") {
          throw new Error(payload.message || "模型列表获取失败");
        }
        models = payload.models.map((model) => model.id).filter(Boolean);
        if (!models.length) {
          throw new Error("模型服务没有返回可用模型");
        }
      },
      "模型列表已获取",
    );
    return models;
  };

  const setCapabilityDefault = (capability: ModelCapability, presetName: string) => {
    return withAction(
      `model-default:${capability}`,
      async () => {
        const payload = await withGatewayAuth((authToken, base) =>
          updateModelDefault(authToken, { capability, name: presetName }, base),
        );
        await replaceSettings(payload);
      },
      "默认模型已更新",
    );
  };

  const saveVoice = () =>
    withAction(
      "voice",
      async () => {
        const defaultName = settings?.model_defaults.speech_to_text;
        const preset = settings?.model_presets.find((item) => item.name === defaultName);
        if (!preset) {
          throw new Error("请先在“模型配置 → 使用 → 语音识别”中选择默认 ASR 模型。");
        }
        const provider = settings?.transcription.providers.find(
          (item) => item.name === preset.provider,
        );
        if (voiceForm.enabled && !provider?.configured && !voiceForm.apiKey.trim()) {
          throw new Error("开启语音输入前需要填写当前 ASR 服务的 API Key。");
        }
        let payload = await withGatewayAuth((authToken, base) =>
          updateProviderSettings(
            authToken,
            {
              provider: preset.provider,
              apiKey: voiceForm.apiKey.trim() || undefined,
              apiBase: voiceForm.apiBase.trim() || undefined,
            },
            base,
          ),
        );
        payload = await withGatewayAuth((authToken, base) =>
          updateTranscriptionSettings(
            authToken,
            {
              enabled: voiceForm.enabled,
              provider: preset.provider,
              model: preset.model,
              language: voiceForm.language,
              maxDurationSec: voiceForm.maxDurationSec,
            },
            base,
          ),
        );
        await replaceSettings(payload);
      },
      "语音设置已保存",
    );

  const addFeedbackImages = async (files: FileList | null) => {
    if (!files) return;
    const next = [...feedbackImages];
    for (const file of Array.from(files)) {
      if (next.length >= 4) break;
      if (!file.type.startsWith("image/")) continue;
      if (file.size > 2 * 1024 * 1024) {
        addToast({ type: "error", title: "图片过大", message: "单张图片不能超过 2MB" });
        continue;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      next.push(dataUrl);
    }
    setFeedbackImages(next);
  };

  const submitFeedback = () =>
    withAction(
      "feedback",
      async () => {
        const content = feedbackText.trim();
        if (!content) throw new Error("请填写反馈内容");
        await submitPromptHubFeedback(promptHubBaseUrl, {
          username: promptHubUser?.username,
          content,
          images: feedbackImages,
          includeLogs: feedbackIncludeLogs,
          platform: navigator.platform,
        });
        setFeedbackOpen(false);
        setFeedbackText("");
        setFeedbackImages([]);
      },
      "反馈已提交",
    );

  if (loading && !settings) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/20 backdrop-blur-[1px] animate-in fade-in duration-150 text-[#777267]">
        <div className="flex h-[720px] w-[1040px] items-center justify-center rounded-xl bg-white shadow-2xl">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          正在连接设置服务...
        </div>
      </div>
    );
  }

  return (
    <div data-settings-surface className="fixed inset-0 z-[70] flex items-center justify-center bg-black/20 p-8 text-[#202020] backdrop-blur-[1px] animate-in fade-in duration-150">
      <div data-settings-dialog className="flex h-[min(720px,calc(100vh-64px))] w-[min(1040px,calc(100vw-96px))] overflow-hidden rounded-xl bg-white shadow-2xl">
        <aside data-settings-sidebar className="w-[236px] shrink-0 bg-[#f2f2f3] px-3 py-9">
          <nav className="space-y-1">
            {localizedTabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  data-settings-nav-item
                  data-active={active ? "true" : "false"}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[15px] transition-colors",
                    active ? "bg-[#e7e7e8] text-[#161616]" : "text-[#222] hover:bg-[#e9e9ea]",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
            {localizedSecondaryTabs.map((tab) => {
              const Icon = tab.icon;
              const active = !!tab.key && activeTab === tab.key;
              return (
                <button
                  key={tab.label}
                  type="button"
                  onClick={() => tab.key && setActiveTab(tab.key)}
                  disabled={tab.disabled}
                  data-settings-nav-item
                  data-active={active ? "true" : "false"}
                  data-disabled={tab.disabled ? "true" : "false"}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-[15px] transition-colors",
                    active && "bg-[#e7e7e8] text-[#161616]",
                    !active && !tab.disabled && "text-[#222] hover:bg-[#e9e9ea]",
                    tab.disabled && "text-[#777] opacity-70",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main data-settings-content className="relative min-w-0 flex-1 bg-white">
          <div className="flex h-full flex-col">
            <div data-settings-header className="flex items-center justify-between border-b border-[#eeeeef] px-10 py-8">
              <div>
                <h2 className="text-[22px] font-semibold tracking-[-0.01em]">
                  {activeTab === "account"
                    ? (isEnglish ? settingsEnglish.account : "账户管理")
                    : activeTab === "help"
                      ? (isEnglish ? settingsEnglish.help : "帮助与反馈")
                      : activeTab === "shortcuts"
                        ? (isEnglish ? settingsEnglish.shortcuts : "快捷键")
                        : localizedTabs.find((tab) => tab.key === activeTab)?.label || (isEnglish ? settingsEnglish.settings : "设置")}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {onBackToChat ? (
                  <button
                    type="button"
                    onClick={onBackToChat}
                    className="grid h-8 w-8 place-items-center rounded-md text-[#202020] hover:bg-[#f1f1f1]"
                    aria-label={isEnglish ? settingsEnglish.close : "关闭设置"}
                    title={isEnglish ? "Close" : "关闭"}
                  >
                    <X className="h-5 w-5" strokeWidth={1.8} />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-10 py-6">
              {error ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <span>{error}</span>
                  {!settings ? (
                    <button
                      type="button"
                      onClick={() => void initializeGateway()}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-medium hover:bg-amber-100"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      {isEnglish ? "Retry" : "重试"}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {activeTab === "account" && (
                <AccountSection user={promptHubUser} onLogin={openPromptHubLogin} onLogout={logoutPromptHub} isEnglish={isEnglish} />
              )}

              {activeTab === "providers" && settings && (
                <ModelManagerSection
                  settings={settings}
                  selectedProvider={selectedProvider}
                  setSelectedProvider={setSelectedProvider}
                  saving={saving}
                  onCreateModelService={createModelService}
                  onUpdateModelService={updateModelService}
                  onDeleteModelService={deleteModelService}
                  onProbeModelService={probeModelService}
                  onSelectDefault={(capability, presetName) => void setCapabilityDefault(capability, presetName)}
                  initialCapability="text"
                  isEnglish={isEnglish}
                />
              )}

              {activeTab === "voice" && settings && (
                <VoiceSection
                  settings={settings}
                  form={voiceForm}
                  setForm={setVoiceForm}
                  saving={saving["voice"]}
                  onSave={saveVoice}
                  speechPresets={settings.model_presets.filter((preset) => preset.capabilities.includes("speech_to_text"))}
                  onSelectSpeechModel={(presetName) => void setCapabilityDefault("speech_to_text", presetName)}
                  isEnglish={isEnglish}
                />
              )}

              {activeTab === "personalization" && (
                <PersonalizationSection isEnglish={isEnglish} />
              )}

              {activeTab === "general" && settings && (
                <GeneralSection
                  language={settingsStore.language ?? setting}
                  setLanguage={settingsStore.setLanguage}
                  isEnglish={isEnglish}
                  theme={settingsStore.theme}
                  setTheme={settingsStore.setTheme}
                  fontSize={settingsStore.fontSize}
                  setFontSize={settingsStore.setFontSize}
                  workspacePath={settingsStore.defaultWorkspacePath || settings.runtime.workspace_path}
                  desktopNotificationsEnabled={settingsStore.desktopNotificationsEnabled}
                  setDesktopNotificationsEnabled={settingsStore.setDesktopNotificationsEnabled}
                />
              )}

              {activeTab === "shortcuts" && <KeyboardShortcutsSection isEnglish={isEnglish} />}

              {activeTab === "help" && (
                <HelpFeedbackSection onOpenFeedback={() => setFeedbackOpen(true)} isEnglish={isEnglish} />
              )}

            </div>
          </div>
        </main>
      </div>
      {feedbackOpen ? (
        <FeedbackDialog
          text={feedbackText}
          setText={setFeedbackText}
          images={feedbackImages}
          setImages={setFeedbackImages}
          includeLogs={feedbackIncludeLogs}
          setIncludeLogs={setFeedbackIncludeLogs}
          saving={saving["feedback"]}
          onAddImages={addFeedbackImages}
          onClose={() => setFeedbackOpen(false)}
          onSubmit={submitFeedback}
          isEnglish={isEnglish}
        />
      ) : null}
    </div>
  );
}

const shortcutRows: Array<{ id: ShortcutId; zh: string; en: string; zhDescription: string; enDescription: string }> = [
  { id: "newChat", zh: "新聊天", en: "New Chat", zhDescription: "开始一个新聊天", enDescription: "Start a new chat" },
  { id: "focusComposer", zh: "聚焦输入框", en: "Focus Composer", zhDescription: "将光标移到聊天输入框", enDescription: "Move focus to the chat composer" },
  { id: "toggleSidebar", zh: "切换侧边栏", en: "Toggle Sidebar", zhDescription: "显示或隐藏左侧导航", enDescription: "Show or hide the left navigation" },
  { id: "openToolbox", zh: "打开工具箱", en: "Open Toolbox", zhDescription: "打开技能和 MCP 工具箱", enDescription: "Open the skills and MCP toolbox" },
  { id: "openSettings", zh: "打开设置", en: "Open Settings", zhDescription: "打开系统设置", enDescription: "Open system settings" },
];

function formatShortcut(shortcut: string) {
  const mod = navigator.platform.toUpperCase().includes("MAC") ? "⌘" : "Ctrl";
  return shortcut.replace("Mod", mod).replace("+", " ");
}

function KeyboardShortcutsSection({ isEnglish }: { isEnglish: boolean }) {
  const shortcuts = useSettingsStore((state) => state.keyboardShortcuts);
  const setShortcut = useSettingsStore((state) => state.setKeyboardShortcut);
  const resetShortcuts = useSettingsStore((state) => state.resetKeyboardShortcuts);
  const [editing, setEditing] = useState<ShortcutId | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const filtered = shortcutRows.filter((row) => `${row.zh} ${row.en} ${row.zhDescription} ${row.enDescription}`.toLowerCase().includes(query.toLowerCase()));
  const capture = (event: React.KeyboardEvent<HTMLButtonElement>, id: ShortcutId) => {
    event.preventDefault();
    if (["Meta", "Control", "Shift", "Alt"].includes(event.key)) return;
    if (!event.metaKey && !event.ctrlKey) {
      setError(isEnglish ? "Use Command/Ctrl with another key." : "请使用 Command/Ctrl 加其他按键。");
      return;
    }
    const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
    const next = `Mod+${key}`;
    if (Object.entries(shortcuts).some(([shortcutId, value]) => shortcutId !== id && value === next)) {
      setError(isEnglish ? "This shortcut is already in use." : "该快捷键已被使用。");
      return;
    }
    setShortcut(id, next);
    setError("");
    setEditing(null);
  };
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 py-1">
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-sm text-[#6f6f73]">{isEnglish ? "Customize keyboard shortcuts for common workspace actions." : "为常用工作区操作自定义键盘快捷键。"}</p></div>
        <Button variant="outline" className="border-[#e5e5e5] bg-white text-[#202020] hover:bg-[#f5f5f5]" onClick={() => { resetShortcuts(); setError(""); }}>
          {isEnglish ? "Restore Defaults" : "恢复默认"}
        </Button>
      </div>
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={isEnglish ? "Search shortcuts" : "搜索快捷键"} />
      {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      <div className="overflow-hidden rounded-xl border border-[#e5e2db] bg-white">
        {filtered.map((row) => {
          const isEditing = editing === row.id;
          return <div key={row.id} className="flex items-center gap-4 border-b border-[#eeeae3] px-5 py-4 last:border-b-0">
            <div className="min-w-0 flex-1"><div className="font-semibold text-[#202020]">{isEnglish ? row.en : row.zh}</div><div className="mt-0.5 text-sm text-[#777267]">{isEnglish ? row.enDescription : row.zhDescription}</div></div>
            <button type="button" onClick={() => { setEditing(row.id); setError(""); }} onKeyDown={(event) => isEditing && capture(event, row.id)} className={cn("min-w-24 rounded-lg border px-3 py-1.5 text-sm font-medium", isEditing ? "border-[#d97757] bg-[#fff7f1] text-[#a65034]" : "border-[#e5e2db] bg-[#f7f7f8] text-[#3d3929]")}>
              {isEditing ? (isEnglish ? "Press keys…" : "按下按键…") : formatShortcut(shortcuts[row.id] || DEFAULT_KEYBOARD_SHORTCUTS[row.id])}
            </button>
          </div>;
        })}
      </div>
    </div>
  );
}

function AccountSection({
  user,
  onLogin,
  onLogout,
  isEnglish,
}: {
  user: { username: string } | null;
  onLogin: () => void;
  onLogout: () => void;
  isEnglish: boolean;
}) {
  const username = user?.username?.trim() || (isEnglish ? "Not signed in" : "未登录");
  const initial = (username[0] || "U").toUpperCase();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-md bg-[#f7f7f8] px-4 py-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#3f7df1] text-base font-semibold text-white">
          {initial}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[#202020]">{username}</div>
          <div className="mt-0.5 truncate text-xs text-[#6f6f73]">{user ? username : (isEnglish ? "Sign in to your account" : "请先登录账号")}</div>
        </div>
      </div>
      {user ? (
        <Button variant="outline" className="border-[#e5e5e5] bg-white text-[#202020] hover:bg-[#f5f5f5]" onClick={onLogout}>
          {isEnglish ? "Sign Out" : "退出登录"}
        </Button>
      ) : (
        <Button variant="outline" className="border-[#e5e5e5] bg-white text-[#202020] hover:bg-[#f5f5f5]" onClick={onLogin}>
          {isEnglish ? "Sign In" : "去登录"}
        </Button>
      )}
    </div>
  );
}

function HelpFeedbackSection({ onOpenFeedback, isEnglish }: { onOpenFeedback: () => void; isEnglish: boolean }) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <HelpRow icon={BookOpenText} label={isEnglish ? "User Manual" : "使用手册"} trailing onClick={() => setHelpOpen(true)} />
        <HelpRow icon={MessageSquare} label={isEnglish ? "Send Feedback" : "意见反馈"} onClick={onOpenFeedback} />
        <HelpRow
          icon={Link}
          label={isEnglish ? "Contact Us" : "联系我们"}
          expanded={contactOpen}
          onClick={() => setContactOpen((open) => !open)}
        />
      </div>
      {contactOpen ? (
        <div
          data-contact-details
          className="rounded-xl border border-[#e8e4dd] bg-[#f7f7f8] px-5 py-4 text-[13px] leading-6 text-[#6f6f73] dark:border-[#3a3a3a] dark:bg-[#2a2a2a] dark:text-[#c5c1b8] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200"
        >
          {isEnglish
            ? "If you run into any issues while using TPACowork, please reach out to the TPA Asset Information Technology Department: Wang Yaobin (ext. 3397), Zhang Zhiqing (ext. 3346)."
            : "如您在使用 TPACowork 时遇到任何问题，欢迎联系太平资产信息科技部：王耀彬（分机 3397）、张志庆（分机 3346）。"}
        </div>
      ) : null}
      {helpOpen ? <HelpManual onClose={() => setHelpOpen(false)} /> : null}
    </div>
  );
}

function HelpRow({
  icon: Icon,
  label,
  trailing,
  expanded,
  onClick,
}: {
  icon: typeof Cpu;
  label: string;
  trailing?: boolean;
  expanded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-md bg-[#f7f7f8] px-5 py-4 text-left text-[#202020] hover:bg-[#f1f1f2] dark:bg-[#2a2a2a] dark:text-[#e8e5de] dark:hover:bg-[#333]"
    >
      <span className="flex items-center gap-4 text-[15px] font-medium">
        <Icon className="h-5 w-5 text-[#555] dark:text-[#aaa69e]" strokeWidth={1.8} />
        {label}
      </span>
      {expanded !== undefined ? (
        <ChevronDown
          className={cn(
            'h-5 w-5 text-[#777] transition-transform duration-200 dark:text-[#8a867c]',
            expanded && 'rotate-180',
          )}
          strokeWidth={1.8}
        />
      ) : trailing ? <ExternalLink className="h-5 w-5 text-[#777] dark:text-[#8a867c]" strokeWidth={1.8} /> : null}
    </button>
  );
}

function FeedbackDialog({
  text,
  setText,
  images,
  setImages,
  includeLogs,
  setIncludeLogs,
  saving,
  onAddImages,
  onClose,
  onSubmit,
  isEnglish,
}: {
  text: string;
  setText: (value: string) => void;
  images: string[];
  setImages: (value: string[]) => void;
  includeLogs: boolean;
  setIncludeLogs: (value: boolean) => void;
  saving?: boolean;
  onAddImages: (files: FileList | null) => void | Promise<void>;
  onClose: () => void;
  onSubmit: () => Promise<void>;
  isEnglish: boolean;
}) {
  const disabled = saving || !text.trim() || text.length > 300;

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20 backdrop-blur-[1px] animate-in fade-in duration-150">
      <div className="w-[480px] overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#eeeeef] px-5 py-4">
          <h3 className="text-lg font-semibold text-[#202020]">{isEnglish ? "Send Feedback" : "意见反馈"}</h3>
          <button type="button" className="grid h-8 w-8 place-items-center rounded-md text-[#777] hover:bg-[#f2f2f3]" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-6">
          <div className="rounded-xl border border-[#e2e2e4] bg-white p-3">
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value.slice(0, 300))}
              placeholder={isEnglish ? "Describe the issue you encountered" : "你可以描述你遇到的问题"}
              className="min-h-[210px] resize-none border-0 bg-white p-0 text-base shadow-none focus-visible:ring-0"
            />
            <div className="mt-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#e2e2e4] bg-[#fafafa] px-3 py-2 text-sm text-[#666] hover:bg-[#f4f4f5]">
                  <ImagePlus className="h-4 w-4" />
                  {isEnglish ? `Upload images (${images.length}/4)` : `上传图片 (${images.length}/4)`}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(event) => {
                      void onAddImages(event.target.files);
                      event.currentTarget.value = "";
                    }}
                    disabled={images.length >= 4}
                  />
                </label>
                {images.length ? (
                  <button type="button" className="text-xs text-[#888] hover:text-[#202020]" onClick={() => setImages([])}>
                    {isEnglish ? "Clear" : "清空"}
                  </button>
                ) : null}
              </div>
              <span className={cn("text-sm", text.length > 300 ? "text-red-600" : "text-[#8a8a8d]")}>{text.length}/300</span>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-between gap-4">
            <button type="button" className="flex min-w-0 items-start gap-3 text-left" onClick={() => setIncludeLogs(!includeLogs)}>
              <span className={cn("mt-1 grid h-5 w-5 shrink-0 place-items-center rounded-md", includeLogs ? "bg-[#202020] text-white" : "border border-[#d6d6d8]")}>
                {includeLogs ? <Check className="h-4 w-4" /> : null}
              </span>
              <span className="text-sm leading-6 text-[#5f6368]">
                {isEnglish ? "Include logs for troubleshooting. They may contain conversations and device information." : "上传日志，仅用于排查问题，可能包含对话记录、设备信息等数据。"}
              </span>
            </button>
            <Button className="h-12 shrink-0 rounded-full bg-[#202020] px-8 text-base font-semibold text-white hover:bg-[#333] disabled:bg-[#d8d8d8]" disabled={disabled} onClick={() => void onSubmit()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isEnglish ? "Submit" : "提交"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelManagerSection({
  settings,
  selectedProvider,
  setSelectedProvider,
  saving,
  onCreateModelService,
  onUpdateModelService,
  onDeleteModelService,
  onProbeModelService,
  onSelectDefault,
  initialCapability,
  isEnglish,
}: {
  settings: SettingsPayload;
  selectedProvider: string;
  setSelectedProvider: (value: string) => void;
  saving: Record<ActionKey, boolean>;
  onCreateModelService: (data: {
    providerName: string;
    apiBase: string;
    apiKey: string;
    apiType: ProviderForm["apiType"];
    models: string[];
  }) => Promise<boolean>;
  onUpdateModelService: (data: {
    provider: string;
    providerName: string;
    apiBase: string;
    apiKey: string;
    apiType: ProviderForm["apiType"];
    models: string[];
  }) => Promise<void>;
  onDeleteModelService: (provider: string) => Promise<void>;
  onProbeModelService: (data: {
    apiBase: string;
    apiKey: string;
    apiType: ProviderForm["apiType"];
  }) => Promise<string[]>;
  onSelectDefault: (capability: ModelCapability, presetName: string) => void;
  initialCapability: ModelCapability;
  isEnglish: boolean;
}) {
  const copy = isEnglish ? {
    use: "Use", connect: "Connect", add: "Add Model Service", back: "Back to List",
    current: "Automatically selected", setDefault: "Set as Default", addToCategory: "Add to This Category",
    empty: "No model configuration is available for this purpose. Add a model service from Connect first.",
    addCustom: "Add Custom Model Service", editCustom: "Configure Model Service", customHint: "Connect another model API provider using the OpenAI-compatible protocol.",
    providerName: "Provider Name", protocol: "Connection Protocol", protocolHint: "OpenAI-compatible custom services are currently supported.",
    apiAddress: "API Base URL", apiHint: "Enter base_url, for example https://api.example.com/v1.", key: "API Key", keyPlaceholder: "Enter API key (saved globally)",
    models: "Models", modelsHint: "Separate models with commas or line breaks.", probe: "Test and Fetch Models", saveConnection: "Save Connection", save: "Save Configuration", cancel: "Cancel", leaveBlank: "Leave blank to keep unchanged",
    customServices: "Connected Model Services", customServicesHint: "Manage connected model APIs. Fetched models are classified automatically by capability.", none: "No Model Services Connected", noneHint: "Add a provider such as OpenAI or DeepSeek to create and manage its model connections.", configured: "Configured", pending: "Pending", apiType: "API type:", notConfigured: "Not set", channels: "Model channels", configure: "Configure", delete: "Delete", deleteTitle: "Delete model service?", deleteConfirm: "Delete Service",
  } : null;
  const [subTab, setSubTab] = useState<"use" | "access">("use");
  const [selectedCapability, setSelectedCapability] = useState<ModelCapability>(initialCapability);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    providerName: "",
    apiBase: "",
    apiKey: "",
    apiType: "auto" as ProviderForm["apiType"],
    models: "",
  });
  const [editForm, setEditForm] = useState({
    providerName: "",
    apiBase: "",
    apiKey: "",
    apiType: "auto" as ProviderForm["apiType"],
    models: "",
  });
  const [pendingDeleteProvider, setPendingDeleteProvider] = useState<{
    name: string;
    label: string;
    modelCount: number;
  } | null>(null);
  const localizedCapabilities = useMemo(() => modelCapabilityOptions.map((capability) => {
    if (!isEnglish) return capability;
    if (capability.value === "text") {
      return { ...capability, label: "Text", description: "New chats and ordinary text tasks" };
    }
    if (capability.value === "speech_to_text") {
      return { ...capability, label: "Speech Recognition", description: "Transcribe microphone recordings (ASR)" };
    }
    return capability;
  }), [isEnglish]);
  const localizedApiTypeOptions = isEnglish
    ? [
      { value: "auto", label: "Automatic" },
      { value: "chat_completions", label: "Chat Completions" },
      { value: "responses", label: "Responses API" },
    ]
    : apiTypeOptions;

  const connectedProviders = useMemo(
    () => settings.providers.filter(
      (provider) => provider.custom || (provider.configured && provider.auth_type !== "oauth"),
    ),
    [settings.providers],
  );
  const selectedProviderInfo = useMemo(
    () => connectedProviders.find((provider) => provider.name === selectedProvider) ?? null,
    [selectedProvider, connectedProviders],
  );
  const selectedProviderIsProtected = selectedProviderInfo
    ? isProtectedBuiltinModelProvider(selectedProviderInfo.name)
    : false;
  const visiblePresets = useMemo(
    () => {
      const configuredProviders = new Set(
        settings.providers.filter((provider) => provider.configured).map((provider) => provider.name),
      );
      return uniqueModelPresets(
        settings.model_presets.filter((preset) => {
          if (!preset.capabilities.includes(selectedCapability)) return false;
          const providerName = preset.provider === "auto" && preset.active
            ? settings.agent.resolved_provider
            : preset.provider;
          if (!providerName || !configuredProviders.has(providerName)) return false;
          if (!preset.is_default) return true;
          return !settings.model_presets.some(
            (candidate) =>
              !candidate.is_default
              && candidate.provider === providerName
              && candidate.model === preset.model
              && candidate.capabilities.includes(selectedCapability),
          );
        }),
      );
    },
    [selectedCapability, settings.agent.resolved_provider, settings.model_presets, settings.providers],
  );
  const providerPresets = useMemo(
    () =>
      selectedProviderInfo
        ? uniqueModelPresets(settings.model_presets.filter((preset) => !preset.is_default && preset.provider === selectedProviderInfo.name))
        : [],
    [selectedProviderInfo, settings.model_presets],
  );

  useEffect(() => {
    if (!selectedProviderInfo) return;
    setEditForm({
      providerName: selectedProviderInfo.label,
      apiBase: selectedProviderInfo.api_base || selectedProviderInfo.default_api_base || "",
      apiKey: "",
      apiType: selectedProviderInfo.api_type ?? "auto",
      models: providerPresets.map((preset) => preset.model).join("\n"),
    });
  }, [selectedProviderInfo, providerPresets]);

  useEffect(() => {
    if (subTab === "access") {
      setSelectedProvider("");
      setAddOpen(false);
    }
  }, [subTab, setSelectedProvider]);

  const submitAddProvider = () => {
    const models = addForm.models.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);
    if (!addForm.providerName.trim() || !addForm.apiBase.trim() || models.length === 0) return;
    void onCreateModelService({
      providerName: addForm.providerName.trim(),
      apiBase: addForm.apiBase.trim(),
      apiKey: addForm.apiKey,
      apiType: addForm.apiType,
      models,
    }).then((saved) => {
      if (!saved) return;
      setAddOpen(false);
      setSelectedProvider("");
      setAddForm({ providerName: "", apiBase: "", apiKey: "", apiType: "auto", models: "" });
    });
  };

  const probeAddProviderModels = () => {
    if (!addForm.apiBase.trim()) return;
    void onProbeModelService({
      apiBase: addForm.apiBase,
      apiKey: addForm.apiKey,
      apiType: addForm.apiType,
    }).then((models) => {
      if (models.length) {
        setAddForm((form) => ({ ...form, models: models.join(", ") }));
      }
    });
  };

  const submitEditProvider = () => {
    if (!selectedProviderInfo) return;
    const models = editForm.models.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);
    if (!editForm.providerName.trim() || !editForm.apiBase.trim() || models.length === 0) return;
    void onUpdateModelService({
      provider: selectedProviderInfo.name,
      providerName: editForm.providerName.trim(),
      apiBase: editForm.apiBase.trim(),
      apiKey: editForm.apiKey,
      apiType: editForm.apiType,
      models,
    });
  };

  const probeEditProviderModels = () => {
    if (!editForm.apiBase.trim()) return;
    void onProbeModelService({
      apiBase: editForm.apiBase,
      apiKey: editForm.apiKey,
      apiType: editForm.apiType,
    }).then((models) => {
      if (models.length) {
        setEditForm((form) => ({ ...form, models: models.join("\n") }));
      }
    });
  };

  const confirmDeleteProvider = () => {
    if (!pendingDeleteProvider) return;
    const providerName = pendingDeleteProvider.name;
    if (isProtectedBuiltinModelProvider(providerName)) {
      setPendingDeleteProvider(null);
      return;
    }
    setPendingDeleteProvider(null);
    setSelectedProvider("");
    void onDeleteModelService(providerName);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-lg bg-[#f2f2f3] p-1">
          {[
            ["use", copy?.use ?? "使用"],
            ["access", copy?.connect ?? "接入"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSubTab(key as "use" | "access")}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                subTab === key ? "bg-white text-[#202020] shadow-sm" : "text-[#6f6f73] hover:text-[#202020]",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {subTab === "access" ? (
          !addOpen && !selectedProviderInfo ? (
            <Button className="bg-[#202020] text-white hover:bg-[#333]" onClick={() => setAddOpen(true)}>
              {copy?.add ?? "添加模型服务"}
            </Button>
          ) : (
            <Button variant="outline" className="border-[#e5e5e5] bg-white text-[#202020] hover:bg-[#f5f5f5]" onClick={() => { setAddOpen(false); setSelectedProvider(""); }}>
              {copy?.back ?? "返回列表"}
            </Button>
          )
        ) : null}
      </div>

      {subTab === "use" ? (
        <div className="space-y-3">
          {/* Compact capability switch between conversation and speech models. */}
          <div className="inline-flex rounded-lg bg-[#f2f2f3] p-1">
            {localizedCapabilities.map((capability) => (
              <button
                key={capability.value}
                type="button"
                onClick={() => setSelectedCapability(capability.value)}
                className={cn(
                  "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
                  selectedCapability === capability.value
                    ? "bg-white text-[#202020] shadow-sm"
                    : "text-[#6f6f73] hover:text-[#202020]",
                )}
              >
                {capability.label}
              </button>
            ))}
          </div>
          {visiblePresets.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {visiblePresets.map((preset) => {
                const provider = settings.providers.find((item) => item.name === preset.provider);
                const active = settings.model_defaults[selectedCapability] === preset.name;
                const supportsCapability = preset.capabilities.includes(selectedCapability);
                return (
                  <div
                    key={preset.name}
                    className={cn(
                      "rounded-lg border bg-white p-4 text-left transition-colors hover:border-[#cfcfd2]",
                      active ? "border-[#202020] shadow-sm" : "border-[#e6e6e8]",
                    )}
                  >
                    {supportsCapability && selectedCapability !== "text_to_speech" ? (
                      <button
                        type="button"
                        onClick={() => onSelectDefault(selectedCapability, preset.name)}
                        disabled={saving[`model-default:${selectedCapability}`]}
                        className={cn(
                          "mb-2 flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                          active
                            ? "border-[#202020] bg-[#202020] text-white hover:bg-[#333]"
                            : "border-[#e6e6e8] bg-[#fafafa] text-[#202020] hover:border-[#cfcfd2] hover:bg-[#f5f5f5]",
                          saving[`model-default:${selectedCapability}`] && "cursor-wait opacity-60",
                        )}
                      >
                        {saving[`model-default:${selectedCapability}`] ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : active ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : null}
                        <span>{active ? (copy?.current ?? "当前默认") : (copy?.setDefault ?? "设为默认")}</span>
                      </button>
                    ) : null}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[#202020]">{preset.label}</div>
                        <div className="mt-1 truncate text-xs text-[#6f6f73]">{provider?.label || preset.provider}</div>
                      </div>
                    </div>
                    <div className="mt-3 truncate text-[13px] text-[#444]">{preset.model}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {preset.capabilities.map((capability) => (
                        <span key={capability} className="rounded-full bg-[#f3f3f4] px-2 py-0.5 text-[10px] text-[#666]">
                          {localizedCapabilities.find((item) => item.value === capability)?.label || capability}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[#dedede] bg-[#fafafa] p-8 text-center text-sm text-[#6f6f73]">
              {copy?.empty ?? "当前没有可分类的模型配置，请先在“接入”中添加模型服务。"}
            </div>
          )}
        </div>
      ) : addOpen ? (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#e6e6e8] text-[#6f6f73] hover:bg-[#f5f5f7] hover:text-[#202020] transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h3 className="text-lg font-semibold text-[#202020]">{copy?.addCustom ?? "添加自定义模型服务"}</h3>
              <p className="text-xs text-[#6f6f73]">{copy?.customHint ?? "通过 OpenAI-compatible 协议接入其他大模型 API 提供商。"}</p>
            </div>
          </div>

          <div className="rounded-xl border border-[#e6e6e8] bg-white p-6 space-y-4">
            <Field label={copy?.providerName ?? "自定义供应商名称"}>
              <Input value={addForm.providerName} onChange={(event) => setAddForm({ ...addForm, providerName: event.target.value })} />
            </Field>
            <Field label={copy?.protocol ?? "接入协议"} hint={copy?.protocolHint ?? "当前支持 OpenAI-compatible 自定义服务。"}>
              <Select value={addForm.apiType} onChange={(value) => setAddForm({ ...addForm, apiType: value as ProviderForm["apiType"] })} options={localizedApiTypeOptions} />
            </Field>
            <Field label={copy?.apiAddress ?? "API 地址"} hint={copy?.apiHint ?? "填写 base_url，例如 https://api.example.com/v1。"}>
              <Input placeholder="base_url (https://...)" value={addForm.apiBase} onChange={(event) => setAddForm({ ...addForm, apiBase: event.target.value })} />
            </Field>
            <Field label={copy?.key ?? "密钥"}>
              <Input type="password" placeholder={copy?.keyPlaceholder ?? "输入 API Key（全局保存）"} value={addForm.apiKey} onChange={(event) => setAddForm({ ...addForm, apiKey: event.target.value })} />
            </Field>
            <Field label={copy?.models ?? "模型列表"} hint={copy?.modelsHint ?? "逗号或换行分隔。保存后会为每个模型创建可选择的模型通道。"}>
              <Textarea placeholder="gpt-4o, deepseek-chat" value={addForm.models} onChange={(event) => setAddForm({ ...addForm, models: event.target.value })} className="min-h-[80px]" />
            </Field>
            <div className="flex items-center gap-3 pt-2">
              <Button variant="outline" className="border-[#e5e5e5] bg-white text-[#202020] hover:bg-[#f5f5f5]" onClick={probeAddProviderModels} disabled={saving["provider-probe"] || !addForm.apiBase.trim()}>
                {saving["provider-probe"] ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {copy?.probe ?? "测试并获取模型"}
              </Button>
              <Button className="bg-[#202020] text-white hover:bg-[#333]" onClick={submitAddProvider} disabled={saving["provider-create"]}>
                {saving["provider-create"] ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {copy?.saveConnection ?? "保存接入"}
              </Button>
              <Button variant="outline" className="border-[#e5e5e5] bg-white text-[#202020] hover:bg-[#f5f5f5]" onClick={() => setAddOpen(false)}>
                {copy?.cancel ?? "取消"}
              </Button>
            </div>
          </div>
        </div>
      ) : selectedProviderInfo ? (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSelectedProvider("")}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#e6e6e8] text-[#6f6f73] hover:bg-[#f5f5f7] hover:text-[#202020] transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h3 className="text-lg font-semibold text-[#202020]">{copy?.editCustom ?? "配置模型服务"}</h3>
              <p className="text-xs text-[#6f6f73]">{isEnglish ? "Update provider details, API base URL, credentials, and models." : "修改供应商信息、API 地址、密钥和模型列表。"}</p>
            </div>
          </div>

          <div className="rounded-xl border border-[#e6e6e8] bg-white p-6 space-y-4">
            <Field label={copy?.providerName ?? "自定义供应商名称"}>
              <Input value={editForm.providerName} onChange={(event) => setEditForm({ ...editForm, providerName: event.target.value })} />
            </Field>
            <Field label={copy?.protocol ?? "接入协议"} hint={copy?.protocolHint ?? "当前支持 OpenAI-compatible 自定义服务。"}>
              <Select value={editForm.apiType} onChange={(value) => setEditForm({ ...editForm, apiType: value as ProviderForm["apiType"] })} options={localizedApiTypeOptions} />
            </Field>
            <Field label={copy?.apiAddress ?? "API 地址"} hint={copy?.apiHint ?? "填写 base_url，例如 https://api.example.com/v1。"}>
              <Input placeholder="base_url (https://...)" value={editForm.apiBase} onChange={(event) => setEditForm({ ...editForm, apiBase: event.target.value })} />
            </Field>
            <Field label={copy?.key ?? "密钥"} hint={selectedProviderInfo.api_key_hint ? `${isEnglish ? "Current" : "当前"}：${selectedProviderInfo.api_key_hint}` : (copy?.leaveBlank ?? "留空表示不修改已有密钥。")}>
              <Input type="password" placeholder={copy?.keyPlaceholder ?? "输入 API Key（全局保存）"} value={editForm.apiKey} onChange={(event) => setEditForm({ ...editForm, apiKey: event.target.value })} />
            </Field>
            <Field label={copy?.models ?? "模型列表"} hint={copy?.modelsHint ?? "逗号或换行分隔。保存后会同步该服务下的模型通道。"}>
              <Textarea placeholder="gpt-4o, deepseek-chat" value={editForm.models} onChange={(event) => setEditForm({ ...editForm, models: event.target.value })} className="min-h-[80px]" />
            </Field>
            <div className="flex items-center gap-3 pt-2">
              <Button variant="outline" className="border-[#e5e5e5] bg-white text-[#202020] hover:bg-[#f5f5f5]" onClick={probeEditProviderModels} disabled={saving["provider-probe"] || !editForm.apiBase.trim()}>
                {saving["provider-probe"] ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {copy?.probe ?? "测试并获取模型"}
              </Button>
              <Button className="bg-[#202020] text-white hover:bg-[#333]" onClick={submitEditProvider} disabled={saving["provider-update"]}>
                {saving["provider-update"] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {copy?.save ?? "保存配置"}
              </Button>
              <Button variant="outline" className="border-[#e5e5e5] bg-white text-[#202020] hover:bg-[#f5f5f5]" onClick={() => setSelectedProvider("")}>
                {copy?.cancel ?? "取消"}
              </Button>
              {selectedProviderIsProtected ? (
                <span className="ml-auto inline-flex items-center rounded-full bg-[#f1eee8] px-3 py-1.5 text-xs font-medium text-[#6f6758]">
                  {isEnglish ? "Built-in · Cannot delete" : "系统内置 · 不可删除"}
                </span>
              ) : (
                <Button
                  variant="outline"
                  className="ml-auto border-red-200 bg-white text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={() => setPendingDeleteProvider({
                    name: selectedProviderInfo.name,
                    label: selectedProviderInfo.label,
                    modelCount: providerPresets.length,
                  })}
                  disabled={saving[`provider-delete:${selectedProviderInfo.name}`]}
                >
                  {saving[`provider-delete:${selectedProviderInfo.name}`] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  {copy?.delete ?? "删除"}
                </Button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg bg-[#f7f7f8] p-4">
            <div className="text-[15px] font-semibold text-[#202020]">{copy?.customServices ?? "已接入模型服务"}</div>
            <div className="mt-1 text-[13px] text-[#6f6f73]">
              {copy?.customServicesHint ?? "管理已接入的模型 API；获取到的模型会按文字、语音识别和语音合成自动分类。"}
            </div>
          </div>

          {!connectedProviders.length ? (
            <div className="rounded-xl border border-dashed border-[#e6e6e8] bg-white p-12 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#fafafa] text-[#6f6f73]">
                <Cpu className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-[#202020]">{copy?.none ?? "暂无接入的模型服务"}</h3>
              <p className="mt-1 text-sm text-[#6f6f73] max-w-sm mx-auto">
                {copy?.noneHint ?? "添加自定义供应商（如 OpenAI、DeepSeek 等）后，可以为它们创建模型通道并在此管理。"}
              </p>
              <div className="mt-6">
                <Button className="bg-[#202020] text-white hover:bg-[#333]" onClick={() => setAddOpen(true)}>
                  {copy?.add ?? "添加模型服务"}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {connectedProviders.map((provider) => {
                const presets = uniqueModelPresets(settings.model_presets.filter(
                  (preset) => !preset.is_default && preset.provider === provider.name
                ));
                const protectedProvider = isProtectedBuiltinModelProvider(provider.name);
                return (
                  <div
                    key={provider.name}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border border-[#e6e6e8] bg-white p-5 transition-all duration-200 hover:border-[#cfcfd2] hover:shadow-sm"
                  >
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center gap-3">
                        <h4 className="truncate text-base font-semibold text-[#202020]">
                          {provider.label}
                        </h4>
                        {protectedProvider ? (
                          <span className="inline-flex shrink-0 rounded-full bg-[#f1eee8] px-2 py-0.5 text-xs font-medium text-[#6f6758]">
                            {isEnglish ? "Built-in" : "系统内置"}
                          </span>
                        ) : null}
                        {provider.configured ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            {copy?.configured ?? "已配置"}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#f4f4f5] px-2 py-0.5 text-xs font-medium text-[#71717a]">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#d4d4d8]" />
                            {copy?.pending ?? "待配置"}
                          </span>
                        )}
                      </div>

                      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 text-xs text-[#6f6f73]">
                        <div className="truncate">
                          <span className="text-[#a1a1a9] mr-1.5">{copy?.apiType ?? "接口类型:"}</span>
                          {provider.api_type || (isEnglish ? "Auto detect" : "自动检测")}
                        </div>
                        <div className="truncate">
                          <span className="text-[#a1a1a9] mr-1.5">{copy?.apiAddress ?? "API 地址:"}</span>
                          {provider.api_base || provider.default_api_base || copy?.notConfigured || "未设置"}
                        </div>
                      </div>

                      {presets.length > 0 && (
                        <div className="pt-1">
                          <div className="flex flex-wrap gap-1 items-center">
                            <span className="text-[11px] font-semibold text-[#a1a1a9] mr-2">{copy?.channels ?? "模型通道"} ({presets.length}):</span>
                            {presets.slice(0, 8).map((p) => (
                              <span key={p.name} className="inline-block rounded bg-[#f1f1f2] px-1.5 py-0.5 text-[11px] text-[#444] truncate max-w-[150px]">
                                {p.model}
                              </span>
                            ))}
                            {presets.length > 8 && (
                              <span className="text-[11px] text-[#888] font-medium pl-1">
                                +{presets.length - 8}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center justify-end gap-2 border-t border-[#f4f4f5] pt-3 sm:border-0 sm:pt-0">
                      {!protectedProvider ? (
                        <button
                          type="button"
                          onClick={() => setPendingDeleteProvider({
                            name: provider.name,
                            label: provider.label,
                            modelCount: presets.length,
                          })}
                          disabled={saving[`provider-delete:${provider.name}`]}
                          className="flex items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-wait disabled:opacity-60"
                        >
                          {saving[`provider-delete:${provider.name}`] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          {copy?.delete ?? "删除"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedProvider(provider.name);
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-lg border border-[#e6e6e8] bg-white px-4 py-2 text-xs font-semibold text-[#202020] transition-colors hover:bg-[#fafafa]"
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        {copy?.configure ?? "配置服务"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={pendingDeleteProvider !== null}
        title={copy?.deleteTitle ?? "删除模型服务？"}
        message={pendingDeleteProvider
          ? isEnglish
            ? `This will permanently remove “${pendingDeleteProvider.label}”, its credentials, and ${pendingDeleteProvider.modelCount} model channel${pendingDeleteProvider.modelCount === 1 ? "" : "s"}. Defaults that use this service will be reset.`
            : `将永久删除“${pendingDeleteProvider.label}”的接入配置、密钥及其 ${pendingDeleteProvider.modelCount} 个模型通道；使用该服务的默认模型会自动重置。`
          : ""}
        confirmText={copy?.deleteConfirm ?? "确认删除"}
        cancelText={copy?.cancel ?? "取消"}
        onConfirm={confirmDeleteProvider}
        onCancel={() => setPendingDeleteProvider(null)}
        variant="danger"
      />
    </div>
  );
}

function VoiceSection({
  settings,
  form,
  setForm,
  saving,
  onSave,
  speechPresets,
  onSelectSpeechModel,
  isEnglish,
}: {
  settings: SettingsPayload;
  form: VoiceForm;
  setForm: (form: VoiceForm) => void;
  saving?: boolean;
  onSave: () => void;
  speechPresets: SettingsPayload["model_presets"];
  onSelectSpeechModel: (presetName: string) => void;
  isEnglish: boolean;
}) {
  const copy = isEnglish ? {
    title: "Voice Input", description: "The default ASR model transcribes microphone recordings. Configure its credentials and recording preferences here.",
    ready: "ASR service ready", notReady: "ASR service not configured", current: "Current default speech recognition model", notSelected: "Not selected", select: "Select Default Model",
    enable: "Enable Voice Input", enableHint: "Use the default ASR model from the chat input microphone.", apiBase: "API Base URL", apiBaseHint: "Usually keep the provider default; change it for private deployments.", language: "Recognition Language", duration: "Maximum Recording Duration", durationHint: "Allowed range: 1–600 seconds.", save: "Save Voice Settings",
    selectSpeechModel: "Select a model that supports speech recognition first.", realtime: "Realtime streaming transcription", afterRecording: "Transcribe after recording", keyHint: "Saved: {key}. Leave blank to keep the existing key.", keyLocalHint: "The key is stored only in the local app configuration.", leaveBlank: "Leave blank to keep unchanged", enterKey: "Enter the ASR service API key", noDefaultWarning: "No default ASR model is configured. Select one in Model Configuration → Use → Speech Recognition.",
  } : null;
  const defaultName = settings.model_defaults.speech_to_text;
  const preset = settings.model_presets.find((item) => item.name === defaultName);
  const provider = preset
    ? settings.transcription.providers.find((item) => item.name === preset.provider)
    : undefined;
  const providerReady = Boolean(provider?.configured);
  const normalizedVoiceModel = preset?.model.trim().toLowerCase() ?? "";
  const realtimeCapable = Boolean(
    preset && settings.transcription.streaming?.supported,
  );
  const isStepfunConversationModel = (
    preset?.provider === "stepfun"
    && normalizedVoiceModel === "stepaudio-2.5-realtime"
  );

  if (!preset) {
    return (
      <div className="space-y-4">
        <SettingsCard
          title={copy?.title ?? "语音输入"}
          description={copy?.description ?? "配置语音识别服务后，才会在聊天输入框中显示麦克风。"}
          actions={
            <StatusPill ok={false}>
              {copy?.notReady ?? "ASR 服务未配置"}
            </StatusPill>
          }
        >
          <div data-voice-empty-state className="rounded-xl border border-dashed border-[#dedbd3] bg-[#faf9f7] px-6 py-8 text-center">
            <Mic className="mx-auto h-7 w-7 text-[#aaa59a]" />
            <div className="mt-3 text-sm font-semibold text-[#29261b]">
              {isEnglish ? "No speech recognition service configured" : "尚未配置语音识别服务"}
            </div>
            <div className="mx-auto mt-1 max-w-xl text-xs leading-5 text-[#777267]">
              {isEnglish
                ? "Add a speech-capable model service first. Until it is configured and enabled, voice settings stay empty and the chat microphone remains hidden."
                : "请先在“接入模型服务”中添加支持语音识别的服务和模型。配置并启用前，这里保持为空，聊天输入框也不会显示麦克风。"}
            </div>
            {speechPresets.length > 0 ? (
              <div className="mx-auto mt-5 w-64 text-left">
                <Select
                  value=""
                  onChange={onSelectSpeechModel}
                  options={speechPresets.map((item) => ({ value: item.name, label: item.model }))}
                />
              </div>
            ) : null}
          </div>
        </SettingsCard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <SettingsCard
        title={copy?.title ?? "语音输入"}
        description={copy?.description ?? "麦克风录音由默认 ASR 模型转成文字；这里保存服务密钥和录音参数。"}
        actions={
          <StatusPill ok={providerReady}>
            {providerReady ? (copy?.ready ?? "ASR 服务可用") : (copy?.notReady ?? "ASR 服务未配置")}
          </StatusPill>
        }
      >
        <div className="mb-4 rounded-lg border border-[#e8e4dd] bg-[#faf9f7] p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-medium text-[#777267]">{copy?.current ?? "当前默认语音识别模型"}</div>
              <div className="mt-1 truncate text-sm font-semibold text-[#202020]">
                {preset?.label || copy?.notSelected || "尚未选择"}
              </div>
              <div className="mt-1 truncate text-xs text-[#6f6f73]">
                {preset ? `${provider?.label || preset.provider} · ${preset.model}` : (copy?.selectSpeechModel ?? "请先选择支持语音识别的模型")}
              </div>
              {preset ? (
                <div className={cn(
                  "mt-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                  realtimeCapable
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-[#f1efe9] text-[#777267]",
                )}>
                  {realtimeCapable ? (copy?.realtime ?? "实时流式识别") : (copy?.afterRecording ?? "录音完成后识别")}
                </div>
              ) : null}
            </div>
            <div className="w-56 shrink-0">
              <Select
                value={defaultName || ""}
                onChange={onSelectSpeechModel}
                options={speechPresets.map((item) => ({ value: item.name, label: item.model }))}
              />
            </div>
          </div>
        </div>

        <div className="mb-4 flex items-center justify-between rounded-lg border border-[#e8e4dd] bg-white px-4 py-3">
          <div>
            <div className="text-sm font-medium text-[#202020]">{copy?.enable ?? "启用语音输入"}</div>
            <div className="mt-1 text-xs text-[#777267]">{copy?.enableHint ?? "开启后，聊天输入框中的麦克风会调用默认 ASR 模型。"}</div>
          </div>
          <Toggle
            checked={form.enabled}
            disabled={!preset}
            onChange={() => setForm({ ...form, enabled: !form.enabled })}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="API Key"
            hint={
              provider?.api_key_hint
                ? (copy?.keyHint ?? "当前已保存：{key}；留空表示不修改。").replace("{key}", provider.api_key_hint)
                : (copy?.keyLocalHint ?? "密钥只保存在本机配置中。")
            }
          >
            <Input
              type="password"
              placeholder={providerReady ? (copy?.leaveBlank ?? "留空表示不修改") : (copy?.enterKey ?? "输入 ASR 服务 API Key")}
              value={form.apiKey}
              disabled={!preset}
              onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
            />
          </Field>
          <Field label={copy?.apiBase ?? "API 地址"} hint={copy?.apiBaseHint ?? "通常保留服务默认地址；私有部署时可修改。"}>
            <Input
              value={form.apiBase}
              disabled={!preset}
              onChange={(event) => setForm({ ...form, apiBase: event.target.value })}
            />
          </Field>
          <Field label={copy?.language ?? "识别语言"}>
            <Select
              value={form.language}
              onChange={(value) => setForm({ ...form, language: value })}
              options={[
                { value: "zh", label: "中文" },
                { value: "en", label: "English" },
                { value: "ja", label: "日本語" },
                { value: "ko", label: "한국어" },
              ]}
            />
          </Field>
          <Field label={copy?.duration ?? "最长录音时长"} hint={copy?.durationHint ?? "允许 1–600 秒。"}>
            <Input
              type="number"
              min={1}
              max={600}
              value={form.maxDurationSec}
              onChange={(event) =>
                setForm({
                  ...form,
                  maxDurationSec: numberValue(event.target.value, form.maxDurationSec),
                })
              }
            />
          </Field>
        </div>

        {isStepfunConversationModel ? (
          <div className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            stepaudio-2.5-realtime 是双向语音通话模型，不适合作为输入框听写模型。
            请选择 stepaudio-2.5-asr；桌面端会自动使用 stepaudio-2.5-asr-stream
            进行实时识别。
          </div>
        ) : !realtimeCapable ? (
          <div className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            当前模型使用录音后识别。若需要边说边出字，请选择 StepFun 的
            stepaudio-2.5-asr、DashScope 的 qwen3-asr-flash-realtime，
            或支持 Realtime Transcription 的 OpenAI 模型。
          </div>
        ) : null}

        <Button
          className="mt-5 bg-[#d97757] text-white hover:bg-[#c86647]"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {copy?.save ?? "保存语音设置"}
        </Button>
      </SettingsCard>
    </div>
  );
}

const MAX_PERSONALIZATION_CHARS = 32_000;

async function personalizationAuth(): Promise<{ token: string; baseUrl: string }> {
  const status = await getNanobotStatus();
  if (!status.ready) throw new Error("本地服务尚未就绪");
  const baseUrl = `http://127.0.0.1:${status.port}`;
  let token = getNanobotToken();
  if (!token) {
    const refreshed = await refreshNanobotAuth();
    token = refreshed.token;
  }
  return { token, baseUrl };
}

function PersonalizationSection({ isEnglish }: { isEnglish: boolean }) {
  const copy = isEnglish ? {
    title: "Personalization",
    description: "Customize how TPACowork behaves and what it knows about you. Changes take effect from the next message.",
    soulTitle: "Assistant Persona (SOUL.md)",
    soulHint: "Defines the assistant's personality and working style. Loaded into the system prompt every turn.",
    userTitle: "User Profile (USER.md)",
    userHint: "Facts about you that the assistant should always keep in mind, such as preferences and background.",
    restore: "Restore default",
    restoreConfirm: "Replace this file with the bundled default template?",
    save: "Save",
    saved: "Personalization saved — takes effect from the next message.",
    restored: "Restored the bundled template.",
    chars: "{used} / {max} characters",
    loading: "Loading personalization files...",
  } : null;
  const [payload, setPayload] = useState<PersonalizationPayload | null>(null);
  const [soul, setSoul] = useState("");
  const [user, setUser] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState<"soul" | "user" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const { token, baseUrl } = await personalizationAuth();
      const next = await fetchPersonalization(token, baseUrl);
      setPayload(next);
      setSoul(next.soul ?? "");
      setUser(next.user ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const applyPayload = (next: PersonalizationPayload) => {
    setPayload(next);
    setSoul(next.soul ?? "");
    setUser(next.user ?? "");
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const { token, baseUrl } = await personalizationAuth();
      applyPayload(await savePersonalization(token, { soul, user }, baseUrl));
      setMessage(copy?.saved ?? "个性化设置已保存，下一条消息起生效。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const restore = async (kind: "soul" | "user") => {
    if (!window.confirm(copy?.restoreConfirm ?? "用内置默认模板替换该文件？")) return;
    setRestoring(kind);
    setError(null);
    setMessage(null);
    try {
      const { token, baseUrl } = await personalizationAuth();
      applyPayload(await restorePersonalization(token, kind, baseUrl));
      setMessage(copy?.restored ?? "已恢复内置默认模板。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRestoring(null);
    }
  };

  if (loading && !payload) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-[#6f6f73]">
        <Loader2 className="h-4 w-4 animate-spin" />
        {copy?.loading ?? "正在加载个性化文件..."}
      </div>
    );
  }

  const charCount = (value: string) => (copy?.chars ?? "{used} / {max} 字符").replace("{used}", String(value.length)).replace("{max}", String(MAX_PERSONALIZATION_CHARS));

  return (
    <SettingsGroup>
      <SettingsCard
        title={copy?.title ?? "个性化"}
        description={copy?.description ?? "自定义 TPACowork 的行为与对你的了解，修改后下一条消息起生效。"}
      >
        {error ? (
          <div className="mb-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}
        {message ? (
          <div className="mb-4 rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
        ) : null}

        <div className="mb-5">
          <div className="mb-1 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-[#202020]">{copy?.soulTitle ?? "助手人格 (SOUL.md)"}</div>
              <div className="mt-0.5 text-xs text-[#6f6f73]">{copy?.soulHint ?? "定义助手的性格与工作方式，每轮都会加载进系统提示。"}</div>
            </div>
            <Button
              variant="outline"
              className="shrink-0 border-[#e5e5e5] bg-white text-[#202020] hover:bg-[#f5f5f5]"
              onClick={() => void restore("soul")}
              disabled={restoring !== null || saving}
            >
              {restoring === "soul" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              {copy?.restore ?? "恢复默认"}
            </Button>
          </div>
          <Textarea
            value={soul}
            onChange={(event) => setSoul(event.target.value)}
            className="mt-2 min-h-[240px] font-mono text-xs"
            spellCheck={false}
          />
          <div className="mt-1 text-right text-[11px] text-[#a1a1a9]">{charCount(soul)}</div>
        </div>

        <div className="mb-5">
          <div className="mb-1 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-[#202020]">{copy?.userTitle ?? "用户画像 (USER.md)"}</div>
              <div className="mt-0.5 text-xs text-[#6f6f73]">{copy?.userHint ?? "关于你的信息，如偏好与背景，让助手始终牢记。"}</div>
            </div>
            <Button
              variant="outline"
              className="shrink-0 border-[#e5e5e5] bg-white text-[#202020] hover:bg-[#f5f5f5]"
              onClick={() => void restore("user")}
              disabled={restoring !== null || saving}
            >
              {restoring === "user" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              {copy?.restore ?? "恢复默认"}
            </Button>
          </div>
          <Textarea
            value={user}
            onChange={(event) => setUser(event.target.value)}
            className="mt-2 min-h-[200px] font-mono text-xs"
            spellCheck={false}
          />
          <div className="mt-1 text-right text-[11px] text-[#a1a1a9]">{charCount(user)}</div>
        </div>

        <div className="flex justify-end pt-1">
          <Button className="bg-[#202020] text-white hover:bg-[#333]" onClick={() => void save()} disabled={saving || loading}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {copy?.save ?? "保存"}
          </Button>
        </div>
      </SettingsCard>
    </SettingsGroup>
  );
}

export function SafetySection({
  form,
  setForm,
  settings,
  saving,
  onSave,
}: {
  form: SafetyForm;
  setForm: (form: SafetyForm) => void;
  settings: SettingsPayload;
  saving?: boolean;
  onSave: () => void;
}) {
  const workspaceSandbox = settings.advanced.workspace_sandbox;
  const workspaceRestriction = workspaceSandbox?.restrict_to_workspace ?? settings.advanced.restrict_to_workspace;
  const workspaceLevel =
    workspaceSandbox?.level === "system"
      ? "系统强制"
      : workspaceSandbox?.level === "application"
        ? "应用层限制"
        : workspaceSandbox?.level === "off"
          ? "关闭"
          : workspaceSandbox?.level || "未知";
  const workspaceSummary =
    workspaceSandbox?.summary ??
    (workspaceRestriction ? "工作区限制由本地工具层执行。" : "工作区限制已关闭。");
  return (
    <SettingsCard
      title="访问边界"
      description=""
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border border-[#e8e4dd] bg-[#faf9f7] px-4 py-3">
          <div>
            <div className="text-sm font-medium">Full Access 可访问本机服务</div>
            <div className="mt-1 text-xs text-[#777267]">开启后，Full Access 的 shell 命令可以访问此 Mac 上的 localhost 和私有网络服务。</div>
          </div>
          <Toggle
            checked={form.webuiAllowLocalServiceAccess}
            onChange={() => setForm({ ...form, webuiAllowLocalServiceAccess: !form.webuiAllowLocalServiceAccess })}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <InfoBlock label="工作区限制" value={workspaceRestriction ? "开启" : "关闭"} />
          <InfoBlock label="工作区执行级别" value={workspaceLevel} />
          <InfoBlock label="私有服务保护" value={settings.advanced.private_service_protection_enabled ? "开启" : "关闭"} />
          <InfoBlock label="Shell 执行沙箱" value={settings.advanced.exec_sandbox || "未启用"} />
          <InfoBlock label="MCP 服务数" value={String(settings.advanced.mcp_server_count)} />
          <InfoBlock label="边界说明" value={workspaceSummary} wide />
        </div>
      </div>
      <Button className="mt-5 bg-[#d97757] text-white hover:bg-[#c86647]" onClick={onSave} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        保存访问设置
      </Button>
    </SettingsCard>
  );
}

function FontSizeControl({
  value,
  onChange,
  isEnglish,
}: {
  value: FontSizeSetting;
  onChange: (value: FontSizeSetting) => void;
  isEnglish: boolean;
}) {
  const labels = isEnglish
    ? { aria: "Font size", small: "Small", default: "Default", large: "Large" }
    : { aria: "字体大小", small: "小", default: "默认", large: "大" };
  const localizedFontSizeOptions = fontSizeOptions.map((option) => ({
    ...option,
    label: option.value === "small"
      ? labels.small
      : option.value === "default"
        ? labels.default
        : option.value === "xxlarge"
          ? labels.large
          : option.label,
  }));
  const index = Math.max(0, localizedFontSizeOptions.findIndex((option) => option.value === value));
  const percentFor = (optionIndex: number) => (optionIndex / (localizedFontSizeOptions.length - 1)) * 100;
  const percent = percentFor(index);
  const selectNearestTick = (clientX: number, rect: DOMRect) => {
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    const nextIndex = Math.max(0, Math.min(localizedFontSizeOptions.length - 1, Math.round(ratio * (localizedFontSizeOptions.length - 1))));
    onChange(localizedFontSizeOptions[nextIndex]?.value ?? "default");
  };

  return (
    <div className="w-[660px] max-w-full px-3 pb-1 pt-2">
      <div
        className="relative h-6 cursor-pointer"
        onClick={(event) => selectNearestTick(event.clientX, event.currentTarget.getBoundingClientRect())}
      >
        <div data-font-size-track className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-[#d8d8d8] dark:bg-[#4a4a4a]" />
        {localizedFontSizeOptions.map((option, optionIndex) => (
          <button
            key={option.value}
            type="button"
            aria-label={option.label || `${labels.aria} ${optionIndex + 1}`}
            className="absolute top-1/2 h-6 w-10 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${percentFor(optionIndex)}%` }}
            onClick={(event) => {
              event.stopPropagation();
              onChange(option.value);
            }}
          >
            <span data-font-size-tick className="absolute left-1/2 top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-[#bdbdbd] dark:bg-[#666]" />
          </button>
        ))}
        <span
          aria-hidden="true"
          data-font-size-thumb
          className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#202020] shadow dark:border-[#262624] dark:bg-[#e8e5de]"
          style={{ left: `${percent}%` }}
        />
      </div>
      <input
        aria-label={labels.aria}
        className="sr-only"
        type="range"
        min={0}
        max={localizedFontSizeOptions.length - 1}
        step={1}
        value={index}
        onChange={(event) => onChange(localizedFontSizeOptions[Number(event.target.value)]?.value ?? "default")}
      />
      <div className="relative mt-1 h-5 text-xs text-[#6f6f73] dark:text-[#8a867c]">
        {localizedFontSizeOptions.map((option, optionIndex) => (
          <span
            key={option.value}
            className="absolute min-w-8 -translate-x-1/2 text-center"
            style={{ left: `${percentFor(optionIndex)}%` }}
          >
            {option.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function GeneralSection({
  language,
  setLanguage,
  isEnglish,
  theme,
  setTheme,
  fontSize,
  setFontSize,
  workspacePath,
  desktopNotificationsEnabled,
  setDesktopNotificationsEnabled,
}: {
  language: LanguageSetting;
  setLanguage: (language: LanguageSetting) => void;
  isEnglish: boolean;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  fontSize: FontSizeSetting;
  setFontSize: (size: FontSizeSetting) => void;
  workspacePath: string;
  desktopNotificationsEnabled: boolean;
  setDesktopNotificationsEnabled: (enabled: boolean) => void;
}) {
  const languageOptions = isEnglish
    ? [{ value: "system" as const, label: "System" }, { value: "zh-CN" as const, label: "中文" }, { value: "en-US" as const, label: "English" }]
    : [{ value: "system" as const, label: "跟随系统" }, { value: "zh-CN" as const, label: "中文" }, { value: "en-US" as const, label: "English" }];
  const themeOptions = isEnglish
    ? [{ value: "system" as const, label: "System" }, { value: "light" as const, label: "Light" }, { value: "dark" as const, label: "Dark" }]
    : themeModeOptions;
  const labels = isEnglish
    ? {
      displayLanguage: "Display Language", languageDescription: "Choose the language used by the application interface.",
      appearance: "Appearance", appearanceDescription: "Choose automatic, light, or dark appearance.",
      fontSize: "Font Size",
      workspace: "Default Workspace Location", workspaceDescription: "New tasks and workspaces are stored in this location.", notSet: "Not set", view: "View",
      notifications: "Notifications", desktopNotifications: "Desktop Notifications", desktopNotificationsDescription: "Show a system notification when an AI task completes.",
    }
    : {
      displayLanguage: "显示语言", languageDescription: "设置应用程序界面的显示语言。",
      appearance: "外观主题", appearanceDescription: "选择外观模式：自动、亮色或暗色。",
      fontSize: "字体大小",
      workspace: "默认工作空间存储路径", workspaceDescription: "新建任务、工作空间时将自动存放在该路径下。", notSet: "未设置", view: "查看",
      notifications: "通知", desktopNotifications: "桌面通知", desktopNotificationsDescription: "AI 任务完成时发送系统桌面通知。",
    };
  const revealWorkspacePath = async () => {
    if (!workspacePath) return;
    try {
      await shellBridge.openPath(workspacePath);
    } catch (error) {
      console.error("Failed to open default workspace path:", error);
    }
  };

  return (
    <SettingsGroup>
      <SettingsRow title={labels.displayLanguage} description={labels.languageDescription}>
        <Select className="w-[150px]" value={language} onChange={(value) => setLanguage(value as LanguageSetting)} options={languageOptions} />
      </SettingsRow>
      <SettingsRow title={labels.appearance} description={labels.appearanceDescription}>
        <Select className="w-[150px]" value={theme} onChange={(value) => setTheme(value as ThemeMode)} options={themeOptions} />
      </SettingsRow>
      <SettingsRow title={labels.fontSize}>
        <FontSizeControl value={fontSize} onChange={setFontSize} isEnglish={isEnglish} />
      </SettingsRow>
      <SettingsRow title={labels.workspace} description={labels.workspaceDescription} stacked>
        <div className="flex w-full items-center gap-2 border-t border-[#e4e4e6] pt-3 dark:border-white/10">
          <Input className="min-w-0 flex-1" value={workspacePath || labels.notSet} readOnly />
          <Button variant="outline" className="shrink-0 border-[#e5e5e5] bg-white text-[#202020] hover:bg-[#f5f5f5] dark:border-[#3a3a3a] dark:bg-[#2c2c2c] dark:text-[#e8e5de] dark:hover:bg-[#383838]" onClick={revealWorkspacePath} disabled={!workspacePath}>
            {labels.view}
          </Button>
        </div>
      </SettingsRow>
      <div className="px-1 pt-4 text-[15px] font-semibold text-[#202020] dark:text-[#e8e5de]">{labels.notifications}</div>
      <SettingsRow title={labels.desktopNotifications} description={labels.desktopNotificationsDescription}>
        <Toggle checked={desktopNotificationsEnabled} onChange={() => setDesktopNotificationsEnabled(!desktopNotificationsEnabled)} />
      </SettingsRow>
    </SettingsGroup>
  );
}

export function AboutSection({ settings, apiBase }: { settings: SettingsPayload; apiBase: string }) {
  return (
    <SettingsCard title="运行信息" description="用于确认 GUI 当前连接的是嵌入式本地服务，而不是 WebUI 页面。">
      <div className="grid gap-3 md:grid-cols-2">
        <InfoBlock label="网关 API" value={apiBase} />
        <InfoBlock label="运行表面" value={(settings.runtime_surface || settings.surface || "native") === "native" ? "本地宿主 (native)" : (settings.runtime_surface || settings.surface || "unknown")} />
        <InfoBlock label="配置文件" value={settings.runtime.config_path} wide />
        <InfoBlock label="工作区" value={settings.runtime.workspace_path} wide />
        <InfoBlock label="网关地址" value={`${settings.runtime.gateway_host}:${settings.runtime.gateway_port}`} />
        <InfoBlock label="统一会话" value={settings.runtime.unified_session ? "开启" : "关闭"} />
        <InfoBlock label="心跳" value={settings.runtime.heartbeat.enabled ? `${settings.runtime.heartbeat.interval_s}s` : "关闭"} />
        <InfoBlock label="需要重启" value={settings.requires_restart ? "是" : "否"} />
      </div>
    </SettingsCard>
  );
}

function InfoBlock({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={cn("rounded-lg border border-[#e8e4dd] bg-[#faf9f7] p-3", wide && "md:col-span-2")}>
      <div className="text-xs text-[#8b8578]">{label}</div>
      <div className="mt-1 break-words text-sm font-medium text-[#403b2f]">{value || "-"}</div>
    </div>
  );
}
