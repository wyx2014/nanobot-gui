import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  Cpu,
  Database,
  ExternalLink,
  FileText,
  HelpCircle,
  ImagePlus,
  Keyboard,
  Link,
  Loader2,
  MessageSquare,
  RefreshCw,
  Save,
  Shield,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";


import {
  ApiError,
  createModelConfiguration,
  createProviderSettings,
  deleteModelConfiguration,
  fetchProviderModels,
  fetchSettings,
  updateModelConfiguration,
  updateImageGenerationSettings,
  updateNetworkSafetySettings,
  updateProviderSettings,
  updateSettings,
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
  WebuiDefaultAccessMode,
} from "@/core/types";
import type { LanguageSetting } from "@/i18n";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { usePromptHubStore } from "@/stores/promptHubStore";
import { submitPromptHubFeedback } from "@/core/prompthubApi";
import { useSettingsStore } from "@/stores/settingsStore";
import { useToastStore } from "@/stores/toastStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { Textarea } from "@/components/ui/textarea";
import { shellBridge } from "@/lib/ipc-factory";
import type { FontSizeSetting } from "@/stores/settingsStore";

type TabKey =
  | "account"
  | "providers"
  | "models"
  | "search"
  | "image"
  | "safety"
  | "general"
  | "about"
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

type ImageForm = {
  enabled: boolean;
  provider: string;
  model: string;
  defaultAspectRatio: string;
  defaultImageSize: string;
  maxImagesPerTurn: number;
};

type SafetyForm = {
  webuiAllowLocalServiceAccess: boolean;
  webuiDefaultAccessMode: WebuiDefaultAccessMode;
};

type ActionKey = string;

const tabs: Array<{ key: TabKey; label: string; description: string; icon: typeof Cpu }> = [
  { key: "general", label: "系统设置", description: "语言、关闭行为、助手信息", icon: SlidersHorizontal },
  { key: "providers", label: "模型配置", description: "提供商 / API 密钥 / OAuth 授权", icon: Cpu },
  { key: "image", label: "个性化", description: "图片模型和默认尺寸", icon: Sparkles },
  { key: "safety", label: "安全中心", description: "工作区权限和本机服务访问", icon: Shield },
  { key: "about", label: "数据管理", description: "网关状态和配置路径", icon: Database },
];

const secondaryTabs: Array<{ key: TabKey | null; label: string; icon: typeof Cpu; disabled?: boolean }> = [
  { key: "account", label: "账户管理", icon: UserRound },
  { key: null, label: "快捷键", icon: Keyboard, disabled: true },
  { key: null, label: "助理设置", icon: Bot, disabled: true },
  { key: "help", label: "帮助与反馈", icon: HelpCircle },
];

const apiTypeOptions = [
  { value: "auto", label: "自动" },
  { value: "chat_completions", label: "对话补全 (Chat Completions)" },
  { value: "responses", label: "原始响应 (Responses)" },
];

const languageOptions: Array<{ value: LanguageSetting; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "zh-CN", label: "中文(简体)" },
  { value: "en-US", label: "English" },
];

const fontSizeOptions: Array<{ value: FontSizeSetting; label: string }> = [
  { value: "small", label: "小" },
  { value: "default", label: "默认" },
  { value: "medium", label: "" },
  { value: "large", label: "" },
  { value: "xlarge", label: "" },
  { value: "xxlarge", label: "大" },
];

const ratioOptions = ["1:1", "16:9", "9:16", "4:3", "3:4"].map((value) => ({ value, label: value }));
const sizeOptions = [
  { value: "1024x1024", label: "1024x1024" },
  { value: "1536x1024", label: "1536x1024" },
  { value: "1024x1536", label: "1024x1536" },
  { value: "auto", label: "自动 (auto)" },
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
    <section className="rounded-lg bg-[#f7f7f8] p-4">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-[#202020]">{title}</h2>
          {description ? <p className="mt-1 text-sm text-[#777267]">{description}</p> : null}
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
    <div className={cn("min-h-[64px] rounded-md bg-[#f7f7f8] px-4 py-3", stacked ? "space-y-3" : "flex items-center justify-between gap-6")}>
      <div className="min-w-0">
        <div className="text-[15px] font-semibold text-[#202020]">{title}</div>
        {description ? <div className="mt-1 text-[13px] leading-5 text-[#6f6f73]">{description}</div> : null}
      </div>
      <div className={cn(stacked ? "w-full" : "flex min-w-[180px] flex-1 justify-end")}>{children}</div>
    </div>
  );
}

export function SettingsView({
  onBackToChat,
  onModelNameChange,
}: {
  theme?: "dark" | "light";
  onToggleTheme?: () => void;
  onBackToChat?: () => void;
  onModelNameChange?: (modelName: string | null) => void;
}) {
  const { setting } = useI18n();
  const settingsStore = useSettingsStore();
  const promptHubUser = usePromptHubStore((state) => state.user);
  const promptHubBaseUrl = usePromptHubStore((state) => state.baseUrl);
  const openPromptHubLogin = usePromptHubStore((state) => state.openLogin);
  const logoutPromptHub = usePromptHubStore((state) => state.logout);
  const addToast = useToastStore((state) => state.addToast);

  const [activeTab, setActiveTab] = useState<TabKey>("general");
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
  const [selectedPreset, setSelectedPreset] = useState("");
  const [imageForm, setImageForm] = useState<ImageForm>({
    enabled: false,
    provider: "openai",
    model: "",
    defaultAspectRatio: "1:1",
    defaultImageSize: "1024x1024",
    maxImagesPerTurn: 1,
  });
  const [safetyForm, setSafetyForm] = useState<SafetyForm>({
    webuiAllowLocalServiceAccess: false,
    webuiDefaultAccessMode: "full",
  });

  const selectedModelPreset = useMemo(
    () => settings?.model_presets.find((preset) => preset.name === selectedPreset) ?? null,
    [selectedPreset, settings],
  );

  const imageProviderOptions = useMemo(
    () =>
      (settings?.image_generation.providers ?? []).map((provider) => ({
        value: provider.name,
        label: provider.configured ? provider.label : `${provider.label}（未配置）`,
      })),
    [settings],
  );

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

    const activePreset = payload.model_presets.find((preset) => preset.active) ?? payload.model_presets[0];
    if (activePreset) {
      setSelectedPreset(activePreset.name);
    }

    setImageForm({
      enabled: payload.image_generation.enabled,
      provider: payload.image_generation.provider,
      model: payload.image_generation.model,
      defaultAspectRatio: payload.image_generation.default_aspect_ratio,
      defaultImageSize: payload.image_generation.default_image_size,
      maxImagesPerTurn: payload.image_generation.max_images_per_turn,
    });
    setSafetyForm({
      webuiAllowLocalServiceAccess: payload.advanced.webui_allow_local_service_access,
      webuiDefaultAccessMode: "full",
    });
  }, []);

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
      let status = await getNanobotStatus();
      let currentToken = getNanobotToken();
      if (!currentToken) {
        await bootstrapNanobotGateway();
        currentToken = getNanobotToken();
        status = await getNanobotStatus();
      }
      if (!status.ready || !currentToken) {
        throw new Error("Nanobot 网关还没有准备好，请稍后重试。");
      }
      const base = gatewayBase(status.port);
      setApiBase(base);
      setToken(currentToken);
      await loadSettings(base, currentToken);
    } catch (err) {
      setError(toErrorMessage(err));
      setLoading(false);
    }
  }, [loadSettings]);

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

  const createModelService = (data: {
    providerName: string;
    apiBase: string;
    apiKey: string;
    apiType: ProviderForm["apiType"];
    models: string[];
  }) =>
    withAction(
      "provider-create",
      async () => {
        const previousCustomProviders = new Set(settings?.providers.filter((provider) => provider.custom).map((provider) => provider.name) ?? []);
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
        const providerKey =
          payload.providers.find((provider) => provider.custom && !previousCustomProviders.has(provider.name))?.name ??
          data.providerName.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
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
      },
      "模型服务已添加",
    );

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

  const activateModelPreset = (presetName = selectedModelPreset?.name) => {
    if (!presetName) return Promise.resolve();
    return withAction(
      "model-active",
      async () => {
        const payload = await withGatewayAuth((authToken, base) =>
          updateSettings(authToken, { modelPreset: presetName === "default" ? null : presetName }, base),
        );
        await replaceSettings(payload);
      },
      "默认模型预设已切换",
    );
  };

  const saveImage = () =>
    withAction(
      "image",
      async () => {
        const payload = await withGatewayAuth((authToken, base) =>
          updateImageGenerationSettings(authToken, imageForm, base),
        );
        await replaceSettings(payload);
      },
      "图像生成设置已保存",
    );

  const saveSafety = () =>
    withAction(
      "safety",
      async () => {
        const payload = await withGatewayAuth((authToken, base) =>
          updateNetworkSafetySettings(authToken, { ...safetyForm, webuiDefaultAccessMode: "full" }, base),
        );
        await replaceSettings(payload);
        window.dispatchEvent(new CustomEvent("nanobot-gui:workspace-settings-changed"));
      },
      "访问设置已保存",
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 text-[#777267]">
        <div className="flex h-[720px] w-[1040px] items-center justify-center rounded-xl bg-white shadow-2xl">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          正在连接 nanobot 设置服务...
        </div>
      </div>
    );
  }

  if (error && !settings) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6">
        <div className="max-w-xl rounded-xl border border-red-100 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 text-red-700">
            <AlertCircle className="h-5 w-5" />
            <h2 className="font-semibold">设置服务加载失败</h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-[#665f53]">{error}</p>
          <Button className="mt-5 bg-[#d97757] text-white hover:bg-[#c86647]" onClick={initializeGateway}>
            <RefreshCw className="h-4 w-4" />
            重试
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-8 text-[#202020]">
      <div className="flex h-[min(720px,calc(100vh-64px))] w-[min(1040px,calc(100vw-96px))] overflow-hidden rounded-xl bg-white shadow-2xl">
        <aside className="w-[236px] shrink-0 bg-[#f2f2f3] px-3 py-9">
          <nav className="space-y-1">
            {secondaryTabs.map((tab) => {
              const Icon = tab.icon;
              const active = !!tab.key && activeTab === tab.key;
              return (
                <button
                  key={tab.label}
                  type="button"
                  onClick={() => tab.key && setActiveTab(tab.key)}
                  disabled={tab.disabled}
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
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
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
          </nav>
        </aside>

        <main className="relative min-w-0 flex-1 bg-white">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between border-b border-[#eeeeef] px-10 py-8">
              <div>
                <h2 className="text-[22px] font-semibold tracking-[-0.01em]">
                  {activeTab === "account"
                    ? "账户管理"
                    : activeTab === "help"
                      ? "帮助与反馈"
                      : tabs.find((tab) => tab.key === activeTab)?.label || "设置"}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {onBackToChat ? (
                  <button
                    type="button"
                    onClick={onBackToChat}
                    className="grid h-8 w-8 place-items-center rounded-md text-[#202020] hover:bg-[#f1f1f1]"
                    aria-label="关闭设置"
                    title="关闭"
                  >
                    <X className="h-5 w-5" strokeWidth={1.8} />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-10 py-6">
              {error ? (
                <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
              ) : null}

              {activeTab === "account" && (
                <AccountSection user={promptHubUser} onLogin={openPromptHubLogin} onLogout={logoutPromptHub} />
              )}

              {activeTab === "providers" && settings && (
                <ModelManagerSection
                  settings={settings}
                  selectedProvider={selectedProvider}
                  setSelectedProvider={setSelectedProvider}
                  setSelectedPreset={setSelectedPreset}
                  saving={saving}
                  onCreateModelService={createModelService}
                  onUpdateModelService={updateModelService}
                  onProbeModelService={probeModelService}
                  onActivateModelPreset={activateModelPreset}
                />
              )}

              {activeTab === "image" && settings && (
                <ImageSection
                  form={imageForm}
                  setForm={setImageForm}
                  providerOptions={imageProviderOptions}
                  saveDir={settings.image_generation.save_dir}
                  providerConfigured={settings.image_generation.provider_configured}
                  saving={saving["image"]}
                  onSave={saveImage}
                />
              )}

              {activeTab === "safety" && settings && (
                <SafetySection form={safetyForm} setForm={setSafetyForm} settings={settings} saving={saving["safety"]} onSave={saveSafety} />
              )}

              {activeTab === "general" && settings && (
                <GeneralSection
                  language={settingsStore.language ?? setting}
                  setLanguage={settingsStore.setLanguage}
                  fontSize={settingsStore.fontSize}
                  setFontSize={settingsStore.setFontSize}
                  skillsAutoUpdate={settingsStore.skillsAutoUpdate}
                  setSkillsAutoUpdate={settingsStore.setSkillsAutoUpdate}
                  workspacePath={settingsStore.defaultWorkspacePath || settings.runtime.workspace_path}
                  desktopNotificationsEnabled={settingsStore.desktopNotificationsEnabled}
                  setDesktopNotificationsEnabled={settingsStore.setDesktopNotificationsEnabled}
                />
              )}

              {activeTab === "about" && settings && <AboutSection settings={settings} apiBase={apiBase} />}
              {activeTab === "help" && (
                <HelpFeedbackSection onOpenFeedback={() => setFeedbackOpen(true)} />
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
        />
      ) : null}
    </div>
  );
}

function AccountSection({
  user,
  onLogin,
  onLogout,
}: {
  user: { username: string } | null;
  onLogin: () => void;
  onLogout: () => void;
}) {
  const username = user?.username?.trim() || "未登录";
  const initial = (username[0] || "U").toUpperCase();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 rounded-md bg-[#f7f7f8] px-4 py-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#3f7df1] text-base font-semibold text-white">
          {initial}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[#202020]">{username}</div>
          <div className="mt-0.5 truncate text-xs text-[#6f6f73]">{user ? username : "请先登录账号"}</div>
        </div>
      </div>
      {user ? (
        <Button variant="outline" className="border-[#e5e5e5] bg-white text-[#202020] hover:bg-[#f5f5f5]" onClick={onLogout}>
          退出登录
        </Button>
      ) : (
        <Button variant="outline" className="border-[#e5e5e5] bg-white text-[#202020] hover:bg-[#f5f5f5]" onClick={onLogin}>
          去登录
        </Button>
      )}
    </div>
  );
}

function HelpFeedbackSection({ onOpenFeedback }: { onOpenFeedback: () => void }) {
  const openExternal = (url: string) => {
    void shellBridge.open(url);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <HelpRow icon={FileText} label="帮助文档" trailing onClick={() => openExternal("https://tparuyi.com/docs")} />
        <HelpRow icon={MessageSquare} label="意见反馈" onClick={onOpenFeedback} />
        <HelpRow icon={Link} label="联系我们" trailing onClick={() => openExternal("https://tparuyi.com/contact")} />
      </div>
      <div className="pt-6 text-center text-sm text-[#8a8a8d]">
        <button type="button" className="hover:text-[#202020]" onClick={() => openExternal("https://tparuyi.com/privacy")}>
          隐私政策
        </button>
        <span className="px-3">|</span>
        <button type="button" className="hover:text-[#202020]" onClick={() => openExternal("https://tparuyi.com/terms")}>
          服务协议
        </button>
      </div>
    </div>
  );
}

function HelpRow({
  icon: Icon,
  label,
  trailing,
  onClick,
}: {
  icon: typeof Cpu;
  label: string;
  trailing?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-md bg-[#f7f7f8] px-5 py-4 text-left text-[#202020] hover:bg-[#f1f1f2]"
    >
      <span className="flex items-center gap-4 text-[15px] font-medium">
        <Icon className="h-5 w-5 text-[#555]" strokeWidth={1.8} />
        {label}
      </span>
      {trailing ? <ExternalLink className="h-5 w-5 text-[#777]" strokeWidth={1.8} /> : null}
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
}) {
  const disabled = saving || !text.trim() || text.length > 300;

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/55">
      <div className="w-[480px] overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#eeeeef] px-5 py-4">
          <h3 className="text-lg font-semibold text-[#202020]">意见反馈</h3>
          <button type="button" className="grid h-8 w-8 place-items-center rounded-md text-[#777] hover:bg-[#f2f2f3]" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-6">
          <div className="rounded-xl border border-[#e2e2e4] bg-white p-3">
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value.slice(0, 300))}
              placeholder="你可以描述你遇到的问题"
              className="min-h-[210px] resize-none border-0 bg-white p-0 text-base shadow-none focus-visible:ring-0"
            />
            <div className="mt-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#e2e2e4] bg-[#fafafa] px-3 py-2 text-sm text-[#666] hover:bg-[#f4f4f5]">
                  <ImagePlus className="h-4 w-4" />
                  上传图片 ({images.length}/4)
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
                    清空
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
                上传日志，仅用于排查问题，可能包含对话记录、设备信息等数据。
              </span>
            </button>
            <Button className="h-12 shrink-0 rounded-full bg-[#202020] px-8 text-base font-semibold text-white hover:bg-[#333] disabled:bg-[#d8d8d8]" disabled={disabled} onClick={() => void onSubmit()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              提交
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
  setSelectedPreset,
  saving,
  onCreateModelService,
  onUpdateModelService,
  onProbeModelService,
  onActivateModelPreset,
}: {
  settings: SettingsPayload;
  selectedProvider: string;
  setSelectedProvider: (value: string) => void;
  setSelectedPreset: (value: string) => void;
  saving: Record<ActionKey, boolean>;
  onCreateModelService: (data: {
    providerName: string;
    apiBase: string;
    apiKey: string;
    apiType: ProviderForm["apiType"];
    models: string[];
  }) => Promise<void>;
  onUpdateModelService: (data: {
    provider: string;
    providerName: string;
    apiBase: string;
    apiKey: string;
    apiType: ProviderForm["apiType"];
    models: string[];
  }) => Promise<void>;
  onProbeModelService: (data: {
    apiBase: string;
    apiKey: string;
    apiType: ProviderForm["apiType"];
  }) => Promise<string[]>;
  onActivateModelPreset: (presetName?: string) => Promise<void>;
}) {
  const [subTab, setSubTab] = useState<"use" | "access">("use");
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

  const customProviders = useMemo(
    () => settings.providers.filter((provider) => provider.custom),
    [settings.providers],
  );
  const selectedProviderInfo = useMemo(
    () => customProviders.find((provider) => provider.name === selectedProvider) ?? null,
    [selectedProvider, customProviders],
  );
  const userModelPresets = useMemo(
    () => uniqueModelPresets(settings.model_presets.filter((preset) => !preset.is_default)),
    [settings.model_presets],
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

  const selectPreset = (preset: SettingsPayload["model_presets"][number]) => {
    setSelectedPreset(preset.name);
    setSelectedProvider(preset.provider);
  };

  const submitAddProvider = () => {
    const models = addForm.models.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);
    if (!addForm.providerName.trim() || !addForm.apiBase.trim() || models.length === 0) return;
    void onCreateModelService({
      providerName: addForm.providerName.trim(),
      apiBase: addForm.apiBase.trim(),
      apiKey: addForm.apiKey,
      apiType: addForm.apiType,
      models,
    }).then(() => {
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex rounded-lg bg-[#f2f2f3] p-1">
          {[
            ["use", "使用"],
            ["access", "接入"],
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
              添加模型服务
            </Button>
          ) : (
            <Button variant="outline" className="border-[#e5e5e5] bg-white text-[#202020] hover:bg-[#f5f5f5]" onClick={() => { setAddOpen(false); setSelectedProvider(""); }}>
              返回列表
            </Button>
          )
        ) : null}
      </div>

      {subTab === "use" ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-[#f7f7f8] p-4">
            <div className="text-[15px] font-semibold text-[#202020]">默认模型</div>
            <div className="mt-1 text-[13px] text-[#6f6f73]">选择已接入的模型作为新会话默认使用模型。</div>
          </div>
          {userModelPresets.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {userModelPresets.map((preset) => {
                const provider = settings.providers.find((item) => item.name === preset.provider);
                return (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => selectPreset(preset)}
                    className={cn(
                      "rounded-lg border bg-white p-4 text-left transition-colors hover:border-[#cfcfd2]",
                      preset.active ? "border-[#202020] shadow-sm" : "border-[#e6e6e8]",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[#202020]">{preset.label}</div>
                        <div className="mt-1 truncate text-xs text-[#6f6f73]">{provider?.label || preset.provider}</div>
                      </div>
                      {preset.active ? <StatusPill ok>当前默认</StatusPill> : null}
                    </div>
                    <div className="mt-3 truncate text-[13px] text-[#444]">{preset.model}</div>
                    {!preset.active ? (
                      <Button
                        variant="outline"
                        className="mt-4 border-[#e5e5e5] bg-white text-[#202020] hover:bg-[#f5f5f5]"
                        onClick={(event) => {
                          event.stopPropagation();
                          void onActivateModelPreset(preset.name);
                        }}
                        disabled={saving["model-active"]}
                      >
                        设为默认
                      </Button>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[#dedede] bg-[#fafafa] p-8 text-center text-sm text-[#6f6f73]">
              还没有可用模型，请先在“接入”里添加模型服务。
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
              <h3 className="text-lg font-semibold text-[#202020]">添加自定义模型服务</h3>
              <p className="text-xs text-[#6f6f73]">通过 OpenAI-compatible 协议接入其他大模型 API 提供商。</p>
            </div>
          </div>

          <div className="rounded-xl border border-[#e6e6e8] bg-white p-6 space-y-4">
            <Field label="自定义供应商名称">
              <Input value={addForm.providerName} onChange={(event) => setAddForm({ ...addForm, providerName: event.target.value })} />
            </Field>
            <Field label="接入协议" hint="当前支持 OpenAI-compatible 自定义服务。">
              <Select value={addForm.apiType} onChange={(value) => setAddForm({ ...addForm, apiType: value as ProviderForm["apiType"] })} options={apiTypeOptions} />
            </Field>
            <Field label="API 地址" hint="填写 base_url，例如 https://api.example.com/v1。">
              <Input placeholder="base_url (https://...)" value={addForm.apiBase} onChange={(event) => setAddForm({ ...addForm, apiBase: event.target.value })} />
            </Field>
            <Field label="密钥">
              <Input type="password" placeholder="输入 API Key（全局保存）" value={addForm.apiKey} onChange={(event) => setAddForm({ ...addForm, apiKey: event.target.value })} />
            </Field>
            <Field label="模型列表" hint="逗号或换行分隔。保存后会为每个模型创建可选择的模型通道。">
              <Textarea placeholder="gpt-4o, deepseek-chat" value={addForm.models} onChange={(event) => setAddForm({ ...addForm, models: event.target.value })} className="min-h-[80px]" />
            </Field>
            <div className="flex items-center gap-3 pt-2">
              <Button variant="outline" className="border-[#e5e5e5] bg-white text-[#202020] hover:bg-[#f5f5f5]" onClick={probeAddProviderModels} disabled={saving["provider-probe"] || !addForm.apiBase.trim()}>
                {saving["provider-probe"] ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                测试并获取模型
              </Button>
              <Button className="bg-[#202020] text-white hover:bg-[#333]" onClick={submitAddProvider} disabled={saving["provider-create"]}>
                {saving["provider-create"] ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                保存接入
              </Button>
              <Button variant="outline" className="border-[#e5e5e5] bg-white text-[#202020] hover:bg-[#f5f5f5]" onClick={() => setAddOpen(false)}>
                取消
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
              <h3 className="text-lg font-semibold text-[#202020]">配置自定义模型服务</h3>
              <p className="text-xs text-[#6f6f73]">修改供应商信息、API 地址、密钥和模型列表。</p>
            </div>
          </div>

          <div className="rounded-xl border border-[#e6e6e8] bg-white p-6 space-y-4">
            <Field label="自定义供应商名称">
              <Input value={editForm.providerName} onChange={(event) => setEditForm({ ...editForm, providerName: event.target.value })} />
            </Field>
            <Field label="接入协议" hint="当前支持 OpenAI-compatible 自定义服务。">
              <Select value={editForm.apiType} onChange={(value) => setEditForm({ ...editForm, apiType: value as ProviderForm["apiType"] })} options={apiTypeOptions} />
            </Field>
            <Field label="API 地址" hint="填写 base_url，例如 https://api.example.com/v1。">
              <Input placeholder="base_url (https://...)" value={editForm.apiBase} onChange={(event) => setEditForm({ ...editForm, apiBase: event.target.value })} />
            </Field>
            <Field label="密钥" hint={selectedProviderInfo.api_key_hint ? `当前：${selectedProviderInfo.api_key_hint}` : "留空表示不修改已有密钥。"}>
              <Input type="password" placeholder="输入 API Key（全局保存）" value={editForm.apiKey} onChange={(event) => setEditForm({ ...editForm, apiKey: event.target.value })} />
            </Field>
            <Field label="模型列表" hint="逗号或换行分隔。保存后会同步该服务下的模型通道。">
              <Textarea placeholder="gpt-4o, deepseek-chat" value={editForm.models} onChange={(event) => setEditForm({ ...editForm, models: event.target.value })} className="min-h-[80px]" />
            </Field>
            <div className="flex items-center gap-3 pt-2">
              <Button variant="outline" className="border-[#e5e5e5] bg-white text-[#202020] hover:bg-[#f5f5f5]" onClick={probeEditProviderModels} disabled={saving["provider-probe"] || !editForm.apiBase.trim()}>
                {saving["provider-probe"] ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                测试并获取模型
              </Button>
              <Button className="bg-[#202020] text-white hover:bg-[#333]" onClick={submitEditProvider} disabled={saving["provider-update"]}>
                {saving["provider-update"] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                保存配置
              </Button>
              <Button variant="outline" className="border-[#e5e5e5] bg-white text-[#202020] hover:bg-[#f5f5f5]" onClick={() => setSelectedProvider("")}>
                取消
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg bg-[#f7f7f8] p-4">
            <div className="text-[15px] font-semibold text-[#202020]">自定义模型服务</div>
            <div className="mt-1 text-[13px] text-[#6f6f73]">
              接入并配置第三方大模型 API，保存后可在“使用”标签页中设为默认模型。
            </div>
          </div>

          {!customProviders.length ? (
            <div className="rounded-xl border border-dashed border-[#e6e6e8] bg-white p-12 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#fafafa] text-[#6f6f73]">
                <Cpu className="h-6 w-6" />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-[#202020]">暂无接入的模型服务</h3>
              <p className="mt-1 text-sm text-[#6f6f73] max-w-sm mx-auto">
                添加自定义供应商（如 OpenAI、DeepSeek 等）后，可以为它们创建模型通道并在此管理。
              </p>
              <div className="mt-6">
                <Button className="bg-[#202020] text-white hover:bg-[#333]" onClick={() => setAddOpen(true)}>
                  添加模型服务
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {customProviders.map((provider) => {
                const presets = uniqueModelPresets(settings.model_presets.filter(
                  (preset) => !preset.is_default && preset.provider === provider.name
                ));
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
                        {provider.configured ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            已配置
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#f4f4f5] px-2 py-0.5 text-xs font-medium text-[#71717a]">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#d4d4d8]" />
                            待配置
                          </span>
                        )}
                      </div>

                      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 text-xs text-[#6f6f73]">
                        <div className="truncate">
                          <span className="text-[#a1a1a9] mr-1.5">接口类型:</span>
                          {provider.api_type || "自动检测"}
                        </div>
                        <div className="truncate">
                          <span className="text-[#a1a1a9] mr-1.5">API 地址:</span>
                          {provider.api_base || provider.default_api_base || "未设置"}
                        </div>
                      </div>

                      {presets.length > 0 && (
                        <div className="pt-1">
                          <div className="flex flex-wrap gap-1 items-center">
                            <span className="text-[11px] font-semibold text-[#a1a1a9] mr-2">模型通道 ({presets.length}):</span>
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

                    <div className="flex shrink-0 items-center justify-end border-t border-[#f4f4f5] pt-3 sm:border-0 sm:pt-0">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedProvider(provider.name);
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-lg border border-[#e6e6e8] bg-white px-4 py-2 text-xs font-semibold text-[#202020] transition-colors hover:bg-[#fafafa]"
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5" />
                        配置服务
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ImageSection({
  form,
  setForm,
  providerOptions,
  saveDir,
  providerConfigured,
  saving,
  onSave,
}: {
  form: ImageForm;
  setForm: (form: ImageForm) => void;
  providerOptions: Array<{ value: string; label: string }>;
  saveDir: string;
  providerConfigured: boolean;
  saving?: boolean;
  onSave: () => void;
}) {
  return (
    <SettingsCard
      title="图像生成"
      description="图像生成仍由 nanobot 统一调度，GUI 只负责写入默认参数。"
      actions={<StatusPill ok={providerConfigured}>{providerConfigured ? "服务可用" : "服务未配置"}</StatusPill>}
    >
      <div className="mb-4 flex items-center justify-between rounded-lg border border-[#e8e4dd] bg-[#faf9f7] px-4 py-3">
        <div>
          <div className="text-sm font-medium">启用图像生成</div>
          <div className="mt-1 text-xs text-[#777267]">开启后，模型可以调用图片生成能力。</div>
        </div>
        <Toggle checked={form.enabled} onChange={() => setForm({ ...form, enabled: !form.enabled })} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="图像服务">
          <Select value={form.provider} onChange={(value) => setForm({ ...form, provider: value })} options={providerOptions} />
        </Field>
        <Field label="模型">
          <Input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} />
        </Field>
        <Field label="默认比例">
          <Select value={form.defaultAspectRatio} onChange={(value) => setForm({ ...form, defaultAspectRatio: value })} options={ratioOptions} />
        </Field>
        <Field label="默认尺寸">
          <Select value={form.defaultImageSize} onChange={(value) => setForm({ ...form, defaultImageSize: value })} options={sizeOptions} />
        </Field>
        <Field label="每轮最多图片数">
          <Input
            type="number"
            min={1}
            max={8}
            value={form.maxImagesPerTurn}
            onChange={(event) => setForm({ ...form, maxImagesPerTurn: numberValue(event.target.value, form.maxImagesPerTurn) })}
          />
        </Field>
        <Field label="保存目录">
          <Input value={saveDir} readOnly />
        </Field>
      </div>
      <Button className="mt-5 bg-[#d97757] text-white hover:bg-[#c86647]" onClick={onSave} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        保存图像设置
      </Button>
    </SettingsCard>
  );
}

function SafetySection({
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
    (workspaceRestriction ? "工作区限制由 nanobot 工具层执行。" : "工作区限制已关闭。");
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
}: {
  value: FontSizeSetting;
  onChange: (value: FontSizeSetting) => void;
}) {
  const index = Math.max(0, fontSizeOptions.findIndex((option) => option.value === value));
  const percentFor = (optionIndex: number) => (optionIndex / (fontSizeOptions.length - 1)) * 100;
  const percent = percentFor(index);
  const selectNearestTick = (clientX: number, rect: DOMRect) => {
    const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    const nextIndex = Math.max(0, Math.min(fontSizeOptions.length - 1, Math.round(ratio * (fontSizeOptions.length - 1))));
    onChange(fontSizeOptions[nextIndex]?.value ?? "default");
  };

  return (
    <div className="w-[660px] max-w-full px-3 pb-1 pt-2">
      <div
        className="relative h-6 cursor-pointer"
        onClick={(event) => selectNearestTick(event.clientX, event.currentTarget.getBoundingClientRect())}
      >
        <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-[#d8d8d8]" />
        {fontSizeOptions.map((option, optionIndex) => (
          <button
            key={option.value}
            type="button"
            aria-label={option.label || `字体大小 ${optionIndex + 1}`}
            className="absolute top-1/2 h-6 w-10 -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${percentFor(optionIndex)}%` }}
            onClick={(event) => {
              event.stopPropagation();
              onChange(option.value);
            }}
          >
            <span className="absolute left-1/2 top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-[#bdbdbd]" />
          </button>
        ))}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#202020] shadow"
          style={{ left: `${percent}%` }}
        />
      </div>
      <input
        aria-label="字体大小"
        className="sr-only"
        type="range"
        min={0}
        max={fontSizeOptions.length - 1}
        step={1}
        value={index}
        onChange={(event) => onChange(fontSizeOptions[Number(event.target.value)]?.value ?? "default")}
      />
      <div className="relative mt-1 h-5 text-xs text-[#6f6f73]">
        {fontSizeOptions.map((option, optionIndex) => (
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
  fontSize,
  setFontSize,
  skillsAutoUpdate,
  setSkillsAutoUpdate,
  workspacePath,
  desktopNotificationsEnabled,
  setDesktopNotificationsEnabled,
}: {
  language: LanguageSetting;
  setLanguage: (language: LanguageSetting) => void;
  fontSize: FontSizeSetting;
  setFontSize: (size: FontSizeSetting) => void;
  skillsAutoUpdate: boolean;
  setSkillsAutoUpdate: (enabled: boolean) => void;
  workspacePath: string;
  desktopNotificationsEnabled: boolean;
  setDesktopNotificationsEnabled: (enabled: boolean) => void;
}) {
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
      <SettingsRow title="显示语言" description="设置应用程序界面的显示语言。">
        <Select className="w-[150px]" value={language} onChange={(value) => setLanguage(value as LanguageSetting)} options={languageOptions} />
      </SettingsRow>
      <SettingsRow title="字体大小">
        <FontSizeControl value={fontSize} onChange={setFontSize} />
      </SettingsRow>
      <SettingsRow title="技能自动更新" description="开启后将自动更新已安装的技能为最新版本，不会更新你在 TpaRuyi 中编辑过的技能。">
        <Toggle checked={skillsAutoUpdate} onChange={() => setSkillsAutoUpdate(!skillsAutoUpdate)} />
      </SettingsRow>
      <SettingsRow title="默认工作空间存储路径" description="新建任务、工作空间时将自动存放在该路径下。" stacked>
        <div className="flex w-full items-center gap-2 border-t border-[#e4e4e6] pt-3">
          <Input className="min-w-0 flex-1" value={workspacePath || "未设置"} readOnly />
          <Button variant="outline" className="shrink-0 border-[#e5e5e5] bg-white text-[#202020] hover:bg-[#f5f5f5]" onClick={revealWorkspacePath} disabled={!workspacePath}>
            查看
          </Button>
        </div>
      </SettingsRow>
      <div className="px-1 pt-4 text-[15px] font-semibold text-[#202020]">通知</div>
      <SettingsRow title="桌面通知" description="允许发送系统桌面通知，任务完成或有新消息时即时提醒。">
        <Toggle checked={desktopNotificationsEnabled} onChange={() => setDesktopNotificationsEnabled(!desktopNotificationsEnabled)} />
      </SettingsRow>
    </SettingsGroup>
  );
}

function AboutSection({ settings, apiBase }: { settings: SettingsPayload; apiBase: string }) {
  return (
    <SettingsCard title="运行信息" description="用于确认 GUI 当前连接的是嵌入式 nanobot 网关，而不是 WebUI 页面。">
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
