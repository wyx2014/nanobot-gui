import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Bot,
  Check,
  Cpu,
  Globe,
  Image as ImageIcon,
  Info,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  Shield,
  Trash2,
} from "lucide-react";

import {
  ApiError,
  deleteModelConfiguration,
  fetchSettings,
  loginProviderOAuth,
  logoutProviderOAuth,
  updateImageGenerationSettings,
  updateModelConfiguration,
  updateNetworkSafetySettings,
  updateProviderSettings,
  updateSettings,
  updateWebSearchSettings,
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
import { useSettingsStore } from "@/stores/settingsStore";
import { useToastStore } from "@/stores/toastStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";

type TabKey =
  | "providers"
  | "models"
  | "search"
  | "image"
  | "safety"
  | "general"
  | "about";

type ProviderForm = {
  apiKey: string;
  apiBase: string;
  apiType: "auto" | "chat_completions" | "responses";
};

type ModelForm = {
  label: string;
  provider: string;
  model: string;
  contextWindowTokens: number;
};

type WebSearchForm = {
  provider: string;
  apiKey: string;
  baseUrl: string;
  maxResults: number;
  timeout: number;
  useJinaReader: boolean;
};

type ImageForm = {
  enabled: boolean;
  provider: string;
  model: string;
  defaultAspectRatio: string;
  defaultImageSize: string;
  maxImagesPerTurn: number;
};

type GeneralForm = {
  timezone: string;
  botName: string;
  botIcon: string;
  toolHintMaxLength: number;
};

type SafetyForm = {
  webuiAllowLocalServiceAccess: boolean;
  webuiDefaultAccessMode: WebuiDefaultAccessMode;
};

type ActionKey = string;

const tabs: Array<{ key: TabKey; label: string; description: string; icon: typeof Cpu }> = [
  { key: "providers", label: "模型服务", description: "提供商 / API 密钥 / OAuth 授权", icon: Cpu },
  { key: "search", label: "联网搜索", description: "搜索引擎和读取策略", icon: Globe },
  { key: "image", label: "图像生成", description: "图片模型和默认尺寸", icon: ImageIcon },
  { key: "safety", label: "访问边界", description: "工作区权限和本机服务访问", icon: Shield },
  { key: "general", label: "通用", description: "语言、关闭行为、助手信息", icon: Bot },
  { key: "about", label: "运行信息", description: "网关状态和配置路径", icon: Info },
];

const apiTypeOptions = [
  { value: "auto", label: "自动" },
  { value: "chat_completions", label: "对话补全 (Chat Completions)" },
  { value: "responses", label: "原始响应 (Responses)" },
];

const languageOptions: Array<{ value: LanguageSetting; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" },
];

const closeOptions = [
  { value: "ask", label: "每次询问" },
  { value: "minimize", label: "最小化到后台" },
  { value: "quit", label: "直接退出" },
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
    <section className="rounded-xl border border-[#e8e4dd] bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-[#29261b]">{title}</h2>
          {description ? <p className="mt-1 text-sm text-[#777267]">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
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
  const addToast = useToastStore((state) => state.addToast);

  const [activeTab, setActiveTab] = useState<TabKey>("providers");
  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [apiBase, setApiBase] = useState("");
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<Record<ActionKey, boolean>>({});

  const [selectedProvider, setSelectedProvider] = useState("");
  const [providerForm, setProviderForm] = useState<ProviderForm>({
    apiKey: "",
    apiBase: "",
    apiType: "auto",
  });
  const [selectedPreset, setSelectedPreset] = useState("");
  const [modelForm, setModelForm] = useState<ModelForm>({
    label: "",
    provider: "",
    model: "",
    contextWindowTokens: 200000,
  });
  const [webSearchForm, setWebSearchForm] = useState<WebSearchForm>({
    provider: "none",
    apiKey: "",
    baseUrl: "",
    maxResults: 5,
    timeout: 15,
    useJinaReader: true,
  });
  const [imageForm, setImageForm] = useState<ImageForm>({
    enabled: false,
    provider: "openai",
    model: "",
    defaultAspectRatio: "1:1",
    defaultImageSize: "1024x1024",
    maxImagesPerTurn: 1,
  });
  const [generalForm, setGeneralForm] = useState<GeneralForm>({
    timezone: "Asia/Shanghai",
    botName: "Ruyi",
    botIcon: "🤖",
    toolHintMaxLength: 180,
  });
  const [safetyForm, setSafetyForm] = useState<SafetyForm>({
    webuiAllowLocalServiceAccess: false,
    webuiDefaultAccessMode: "full",
  });

  const selectedProviderInfo = useMemo(
    () => settings?.providers.find((provider) => provider.name === selectedProvider) ?? null,
    [selectedProvider, settings],
  );


  const selectedModelPreset = useMemo(
    () => settings?.model_presets.find((preset) => preset.name === selectedPreset) ?? null,
    [selectedPreset, settings],
  );

  const webSearchProviderOptions = useMemo(
    () => (settings?.web_search.providers ?? []).map((provider) => ({ value: provider.name, label: provider.label })),
    [settings],
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
      setProviderForm({
        apiKey: "",
        apiBase: provider.api_base || provider.default_api_base || "",
        apiType: provider.api_type ?? "auto",
      });
    }

    const activePreset = payload.model_presets.find((preset) => preset.active) ?? payload.model_presets[0];
    if (activePreset) {
      setSelectedPreset(activePreset.name);
      setModelForm({
        label: activePreset.label,
        provider: activePreset.provider,
        model: activePreset.model,
        contextWindowTokens: activePreset.context_window_tokens,
      });
    } else {
      setModelForm((prev) => ({
        ...prev,
        provider: payload.agent.provider,
        model: payload.agent.model,
        contextWindowTokens: payload.agent.context_window_tokens,
      }));
    }

    setWebSearchForm({
      provider: payload.web_search.provider,
      apiKey: "",
      baseUrl: payload.web_search.base_url || "",
      maxResults: payload.web_search.max_results,
      timeout: payload.web_search.timeout,
      useJinaReader: payload.web.fetch.use_jina_reader,
    });
    setImageForm({
      enabled: payload.image_generation.enabled,
      provider: payload.image_generation.provider,
      model: payload.image_generation.model,
      defaultAspectRatio: payload.image_generation.default_aspect_ratio,
      defaultImageSize: payload.image_generation.default_image_size,
      maxImagesPerTurn: payload.image_generation.max_images_per_turn,
    });
    setGeneralForm({
      timezone: payload.agent.timezone,
      botName: payload.agent.bot_name,
      botIcon: payload.agent.bot_icon,
      toolHintMaxLength: payload.agent.tool_hint_max_length,
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

  useEffect(() => {
    if (!selectedProviderInfo) return;
    setProviderForm({
      apiKey: "",
      apiBase: selectedProviderInfo.api_base || selectedProviderInfo.default_api_base || "",
      apiType: selectedProviderInfo.api_type ?? "auto",
    });
  }, [selectedProviderInfo]);

  useEffect(() => {
    if (!selectedModelPreset) return;
    setModelForm({
      label: selectedModelPreset.label,
      provider: selectedModelPreset.provider,
      model: selectedModelPreset.model,
      contextWindowTokens: selectedModelPreset.context_window_tokens,
    });
  }, [selectedModelPreset]);

  const replaceSettings = useCallback(
    async (payload: SettingsPayload) => {
      applyPayload(payload);
      onModelNameChange?.(payload.agent.model);
      await syncGatewaySettingsToStore();
    },
    [applyPayload, onModelNameChange],
  );

  const saveModelSettings = () => {
    if (!selectedModelPreset) return Promise.resolve();
    return withAction(
      "model-save",
      async () => {
        // 1. Save provider settings first
        await withGatewayAuth((authToken, base) =>
          updateProviderSettings(
            authToken,
            {
              provider: selectedProvider,
              apiKey: providerForm.apiKey,
              apiBase: providerForm.apiBase,
              apiType: providerForm.apiType,
            },
            base,
          ),
        );
        // 2. Save model preset configuration next
        const payload = await withGatewayAuth((authToken, base) => {
          if (selectedModelPreset.name === "default") {
            return updateSettings(
              authToken,
              {
                model: modelForm.model,
                provider: modelForm.provider,
                contextWindowTokens: modelForm.contextWindowTokens,
              },
              base,
            );
          } else {
            return updateModelConfiguration(
              authToken,
              {
                name: selectedModelPreset.name,
                label: modelForm.label,
                provider: modelForm.provider,
                model: modelForm.model,
                contextWindowTokens: modelForm.contextWindowTokens,
              },
              base,
            );
          }
        });
        await replaceSettings(payload);
      },
      "模型预设已保存",
    );
  };


  const oauthAction = (action: "login" | "logout") =>
    withAction(
      `oauth-${action}`,
      async () => {
        const payload = await withGatewayAuth((authToken, base) =>
          action === "login"
            ? loginProviderOAuth(authToken, selectedProvider, base)
            : logoutProviderOAuth(authToken, selectedProvider, base),
        );
        await replaceSettings(payload);
      },
      action === "login" ? "OAuth 登录已发起" : "OAuth 已退出",
    );



  const activateModelPreset = () => {
    if (!selectedModelPreset) return Promise.resolve();
    return withAction(
      "model-active",
      async () => {
        const payload = await withGatewayAuth((authToken, base) =>
          updateSettings(authToken, { modelPreset: selectedModelPreset.name }, base),
        );
        await replaceSettings(payload);
      },
      "默认模型预设已切换",
    );
  };

  const deleteModelPreset = () => {
    if (!selectedModelPreset) return Promise.resolve();
    if (!window.confirm(`确定要删除通道 "${selectedModelPreset.label}" 吗？`)) {
      return Promise.resolve();
    }
    return withAction(
      "model-delete",
      async () => {
        const payload = await withGatewayAuth((authToken, base) =>
          deleteModelConfiguration(authToken, selectedModelPreset.name, base)
        );
        await replaceSettings(payload);
        const activePreset = payload.model_presets.find((p) => p.active) || payload.model_presets[0];
        if (activePreset) {
          setSelectedPreset(activePreset.name);
          setSelectedProvider(activePreset.provider);
        }
      },
      "模型预设已删除",
    );
  };

  const saveWebSearch = () =>
    withAction(
      "web-search",
      async () => {
        const payload = await withGatewayAuth((authToken, base) =>
          updateWebSearchSettings(
            authToken,
            {
              provider: webSearchForm.provider,
              apiKey: webSearchForm.apiKey,
              baseUrl: webSearchForm.baseUrl,
              maxResults: webSearchForm.maxResults,
              timeout: webSearchForm.timeout,
              useJinaReader: webSearchForm.useJinaReader,
            },
            base,
          ),
        );
        await replaceSettings(payload);
      },
      "联网搜索设置已保存",
    );

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

  const saveGeneral = () =>
    withAction(
      "general",
      async () => {
        const payload = await withGatewayAuth((authToken, base) =>
          updateSettings(
            authToken,
            {
              timezone: generalForm.timezone,
              botName: generalForm.botName,
              botIcon: generalForm.botIcon,
              toolHintMaxLength: generalForm.toolHintMaxLength,
            },
            base,
          ),
        );
        await replaceSettings(payload);
      },
      "通用设置已保存",
    );

  if (loading && !settings) {
    return (
      <div className="flex h-full items-center justify-center bg-[#faf8f5] text-[#777267]">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        正在连接 nanobot 设置服务...
      </div>
    );
  }

  if (error && !settings) {
    return (
      <div className="flex h-full items-center justify-center bg-[#faf8f5] p-6">
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
    <div className="flex h-full bg-[#faf8f5] text-[#29261b]">
      <aside className="w-56 shrink-0 border-r border-[#e8e4dd] bg-[#f6f1eb] p-4">
        <div className="mb-5 px-2">
          <h1 className="text-xl font-semibold">设置</h1>
          <p className="mt-1 text-sm text-[#777267]">由 nanobot 网关提供配置能力</p>
        </div>
        <nav className="space-y-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                  active ? "bg-white text-[#d97757] shadow-sm" : "text-[#625c50] hover:bg-white/70",
                )}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <span className="block text-sm font-medium">{tab.label}</span>
                  <span className="mt-0.5 block text-xs text-[#8b8578]">{tab.description}</span>
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-5 p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">{tabs.find((tab) => tab.key === activeTab)?.label}</h2>
            </div>
            <div className="flex items-center gap-2">
              {onBackToChat ? (
                <Button variant="outline" className="border-[#e1ddd5] bg-white text-[#403b2f] hover:bg-[#f6f1eb]" onClick={onBackToChat}>
                  返回对话
                </Button>
              ) : null}
              <Button
                variant="outline"
                className="border-[#e1ddd5] bg-white text-[#403b2f] hover:bg-[#f6f1eb]"
                onClick={() => void loadSettings(apiBase, token, true)}
                disabled={refreshing}
              >
                {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                刷新
              </Button>
            </div>
          </div>

          {error ? (
            <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : null}

          {activeTab === "providers" && settings && (
            <ModelManagerSection
              settings={settings}
              selectedProvider={selectedProvider}
              setSelectedProvider={setSelectedProvider}
              selectedPreset={selectedPreset}
              setSelectedPreset={setSelectedPreset}
              selectedModelPreset={selectedModelPreset}
              providerForm={providerForm}
              setProviderForm={setProviderForm}
              modelForm={modelForm}
              setModelForm={setModelForm}
              saving={saving}
              onSave={saveModelSettings}
              onActivateModelPreset={activateModelPreset}
              onDeleteModelPreset={deleteModelPreset}
              onOauth={oauthAction}
            />
          )}

          {activeTab === "search" && settings && (
            <WebSearchSection
              form={webSearchForm}
              setForm={setWebSearchForm}
              providerOptions={webSearchProviderOptions}
              credential={
                settings.web_search.providers.find((provider) => provider.name === webSearchForm.provider)?.credential ??
                "none"
              }
              saving={saving["web-search"]}
              onSave={saveWebSearch}
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
              form={generalForm}
              setForm={setGeneralForm}
              language={settingsStore.language ?? setting}
              setLanguage={settingsStore.setLanguage}
              closeAction={settingsStore.closeAction}
              setCloseAction={settingsStore.setCloseAction}
              saving={saving["general"]}
              onSave={saveGeneral}
            />
          )}

          {activeTab === "about" && settings && <AboutSection settings={settings} apiBase={apiBase} />}
        </div>
      </main>
    </div>
  );
}

function ModelManagerSection({
  settings,
  selectedProvider,
  setSelectedProvider,
  selectedPreset,
  setSelectedPreset,
  selectedModelPreset,
  providerForm,
  setProviderForm,
  modelForm,
  setModelForm,
  saving,
  onSave,
  onActivateModelPreset,
  onDeleteModelPreset,
  onOauth,
}: {
  settings: SettingsPayload;
  selectedProvider: string;
  setSelectedProvider: (value: string) => void;
  selectedPreset: string;
  setSelectedPreset: (value: string) => void;
  selectedModelPreset: SettingsPayload["model_presets"][number] | null;
  providerForm: ProviderForm;
  setProviderForm: (form: ProviderForm) => void;
  modelForm: ModelForm;
  setModelForm: (form: ModelForm) => void;
  saving: Record<ActionKey, boolean>;
  onSave: () => Promise<void>;
  onActivateModelPreset: () => Promise<void>;
  onDeleteModelPreset: () => Promise<void>;
  onOauth: (action: "login" | "logout") => void;
}) {
  const selectedProviderInfo = useMemo(
    () => settings.providers.find((provider) => provider.name === selectedProvider) ?? null,
    [selectedProvider, settings],
  );

  const oauth = selectedProviderInfo?.auth_type === "oauth";

  const handleSaveAll = async () => {
    await onSave();
  };

  const handleActivateAll = async (presetName: string) => {
    // Set selected preset
    setSelectedPreset(presetName);
    // Find preset and set its provider as selected
    const preset = settings.model_presets.find(p => p.name === presetName);
    if (preset) {
      setSelectedProvider(preset.provider);
      // Wait a tiny bit for state to propagate, then trigger activates
      await onActivateModelPreset();
    }
  };

  const onSelectPreset = (preset: SettingsPayload["model_presets"][number]) => {
    setSelectedPreset(preset.name);
    setSelectedProvider(preset.provider);
  };

  // Group presets by provider
  const groupedPresets = useMemo(() => {
    const groups: Record<string, typeof settings.model_presets> = {};
    settings.model_presets.forEach((preset) => {
      const providerLabel = settings.providers.find(p => p.name === preset.provider)?.label || preset.provider;
      if (!groups[providerLabel]) {
        groups[providerLabel] = [];
      }
      groups[providerLabel].push(preset);
    });
    return groups;
  }, [settings.model_presets, settings.providers]);

  return (
    <div className="flex h-[640px] border border-[#e8e4dd] rounded-xl overflow-hidden bg-white shadow-sm">
      {/* Left Column: Preset Channels List */}
      <div className="w-[200px] border-r border-[#e8e4dd] bg-[#faf9f6] flex flex-col shrink-0">
        <div className="p-4 border-b border-[#e8e4dd]">
          <span className="text-sm font-semibold text-[#29261b]">模型预设通道</span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          {Object.entries(groupedPresets).map(([providerLabel, presets]) => (
            <div key={providerLabel} className="space-y-1">
              <div className="px-2 py-1 text-[11px] font-semibold text-[#8b8578] uppercase tracking-wider">
                {providerLabel}
              </div>
              {presets.map((preset) => {
                const isSelected = selectedPreset === preset.name;
                const correspondingProvider = settings.providers.find(
                  (p) => p.name === preset.provider
                );
                const isConfigured = correspondingProvider?.configured ?? false;

                return (
                  <div
                    key={preset.name}
                    onClick={() => onSelectPreset(preset)}
                    className={cn(
                      "flex items-center justify-between p-2.5 rounded-lg cursor-pointer transition-all",
                      isSelected
                        ? "bg-white shadow-sm ring-1 ring-black/5"
                        : "hover:bg-[#eeebe3]/55"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "w-1.5 h-1.5 rounded-full shrink-0",
                            isConfigured ? "bg-emerald-500" : "bg-[#ccd0cf]"
                          )}
                          title={isConfigured ? "已配置 Key" : "未配置 Key"}
                        />
                        <span className={cn(
                          "text-xs font-semibold truncate",
                          isSelected ? "text-[#d97757]" : "text-[#29261b]"
                        )}>
                          {preset.label}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-[#777267] truncate ml-3">
                        {preset.model}
                      </div>
                    </div>

                    {/* Switch/Radio component to enable/activate */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleActivateAll(preset.name);
                      }}
                      className={cn(
                        "ml-2 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border transition-all",
                        preset.active
                          ? "border-[#d97757] bg-[#d97757] text-white"
                          : "border-[#ccd0cf] hover:border-[#d97757]"
                      )}
                    >
                      {preset.active && <Check className="h-2.5 w-2.5" />}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Right Column: Configuration details */}
      <div className="flex-1 overflow-y-auto bg-white flex flex-col">
        {selectedModelPreset ? (
          <div className="p-6 space-y-6 flex-1">
            <div className="flex items-start justify-between gap-4 border-b border-[#faf9f5] pb-4">
              <div>
                <h3 className="text-lg font-semibold text-[#29261b]">
                  {selectedModelPreset.label}
                </h3>
                <p className="mt-1 text-xs text-[#777267]">
                  通道类型：{selectedProviderInfo?.label || selectedModelPreset.provider}
                </p>
              </div>
              <StatusPill ok={selectedModelPreset.active}>
                {selectedModelPreset.active ? "当前激活助手模型" : "未启用"}
              </StatusPill>
            </div>

            {/* Section 1: Provider Credentials */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-[#403b2f] flex items-center gap-1.5 border-l-2 border-[#d97757] pl-2">
                服务商认证配置
              </h4>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="API 类型">
                  <Select
                    value={providerForm.apiType}
                    onChange={(value) => setProviderForm({ ...providerForm, apiType: value as ProviderForm["apiType"] })}
                    options={apiTypeOptions}
                  />
                </Field>
                <Field
                  label="API Base"
                  hint={
                    selectedProviderInfo?.default_api_base
                      ? `默认：${selectedProviderInfo.default_api_base}`
                      : undefined
                  }
                >
                  <Input
                    value={providerForm.apiBase}
                    onChange={(e) => setProviderForm({ ...providerForm, apiBase: e.target.value })}
                  />
                </Field>
                {!oauth ? (
                  <Field
                    label="API Key"
                    hint={
                      selectedProviderInfo?.api_key_hint
                        ? `当前：${selectedProviderInfo.api_key_hint}`
                        : "留空表示不修改已有密钥。"
                    }
                  >
                    <Input
                      type="password"
                      value={providerForm.apiKey}
                      onChange={(e) => setProviderForm({ ...providerForm, apiKey: e.target.value })}
                      placeholder="sk-..."
                    />
                  </Field>
                ) : (
                  <div className="rounded-lg border border-[#e8e4dd] bg-[#faf9f7] p-3 md:col-span-2">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">OAuth 账号</div>
                        <div className="mt-1 text-xs text-[#777267]">
                          {selectedProviderInfo?.oauth_account || "尚未登录"}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onOauth(selectedProviderInfo?.oauth_account ? "logout" : "login")}
                      >
                        <KeyRound className="h-4 w-4" />
                        {selectedProviderInfo?.oauth_account ? "退出" : "登录"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Section 2: Preset Parameters */}
            <div className="space-y-4 pt-4 border-t border-[#faf9f5]">
              <h4 className="text-sm font-semibold text-[#403b2f] flex items-center gap-1.5 border-l-2 border-[#d97757] pl-2">
                模型预设参数
              </h4>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="显示名称">
                  <Input
                    value={modelForm.label}
                    onChange={(e) => setModelForm({ ...modelForm, label: e.target.value })}
                  />
                </Field>
                <Field label="模型 ID">
                  <Input
                    value={modelForm.model}
                    onChange={(e) => setModelForm({ ...modelForm, model: e.target.value })}
                  />
                </Field>
                <Field label="上下文窗口 Token">
                  <Input
                    type="number"
                    value={modelForm.contextWindowTokens}
                    onChange={(e) =>
                      setModelForm({
                        ...modelForm,
                        contextWindowTokens: numberValue(e.target.value, modelForm.contextWindowTokens),
                      })
                    }
                  />
                </Field>
              </div>
            </div>

            {/* Unified Save and Activate buttons */}
            <div className="pt-6 border-t border-[#e8e4dd] flex items-center justify-between">
              <div className="flex gap-3">
                <Button
                  className="bg-[#d97757] text-white hover:bg-[#c86647]"
                  onClick={handleSaveAll}
                  disabled={saving["model-save"]}
                >
                  {saving["model-save"] ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  保存配置
                </Button>
                {!selectedModelPreset.active && (
                  <Button
                    variant="outline"
                    className="border-[#e1ddd5] bg-white text-[#403b2f] hover:bg-[#f6f1eb]"
                    onClick={() => handleActivateAll(selectedModelPreset.name)}
                    disabled={saving["model-active"]}
                  >
                    启用当前通道
                  </Button>
                )}
              </div>
              {!selectedModelPreset.is_default && selectedModelPreset.name !== "default" && (
                <Button
                  variant="outline"
                  className="border-red-200 bg-white text-red-600 hover:bg-red-50 hover:text-red-700"
                  onClick={onDeleteModelPreset}
                  disabled={saving["model-delete"]}
                >
                  {saving["model-delete"] ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  删除通道
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-[#777267]">
            <Cpu className="h-10 w-10 text-[#ccd0cf] mb-2" />
            <p className="text-sm">请在左侧选择一个模型通道进行配置。</p>
          </div>
        )}
      </div>
    </div>
  );
}

function WebSearchSection({
  form,
  setForm,
  providerOptions,
  credential,
  saving,
  onSave,
}: {
  form: WebSearchForm;
  setForm: (form: WebSearchForm) => void;
  providerOptions: Array<{ value: string; label: string }>;
  credential: "none" | "api_key" | "base_url";
  saving?: boolean;
  onSave: () => void;
}) {
  return (
    <SettingsCard title="联网搜索" description="这些设置会影响需要搜索网页或读取网页内容的工具。">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="搜索提供方">
          <Select value={form.provider} onChange={(value) => setForm({ ...form, provider: value })} options={providerOptions} />
        </Field>
        <Field label="最多结果数">
          <Input
            type="number"
            value={form.maxResults}
            onChange={(event) => setForm({ ...form, maxResults: numberValue(event.target.value, form.maxResults) })}
          />
        </Field>
        <Field label="超时秒数">
          <Input
            type="number"
            value={form.timeout}
            onChange={(event) => setForm({ ...form, timeout: numberValue(event.target.value, form.timeout) })}
          />
        </Field>
        {credential === "api_key" ? (
          <Field label="API Key" hint="留空表示不修改已有密钥。">
            <Input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} />
          </Field>
        ) : null}
        {credential === "base_url" ? (
          <Field label="Base URL">
            <Input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} />
          </Field>
        ) : null}
      </div>
      <div className="mt-4 flex items-center justify-between rounded-lg border border-[#e8e4dd] bg-[#faf9f7] px-4 py-3">
        <div>
          <div className="text-sm font-medium">使用 Jina Reader 读取网页</div>
          <div className="mt-1 text-xs text-[#777267]">适合把网页正文转换成更稳定的 Markdown。</div>
        </div>
        <Toggle checked={form.useJinaReader} onChange={() => setForm({ ...form, useJinaReader: !form.useJinaReader })} />
      </div>
      <Button className="mt-5 bg-[#d97757] text-white hover:bg-[#c86647]" onClick={onSave} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        保存搜索设置
      </Button>
    </SettingsCard>
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

function GeneralSection({
  form,
  setForm,
  language,
  setLanguage,
  closeAction,
  setCloseAction,
  saving,
  onSave,
}: {
  form: GeneralForm;
  setForm: (form: GeneralForm) => void;
  language: LanguageSetting;
  setLanguage: (language: LanguageSetting) => void;
  closeAction: "ask" | "minimize" | "quit";
  setCloseAction: (action: "ask" | "minimize" | "quit") => void;
  saving?: boolean;
  onSave: () => void;
}) {
  return (
    <div className="space-y-5">
      <SettingsCard title="界面偏好" description="这些是 GUI 本地偏好，不会影响 nanobot 的推理行为。">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="语言">
            <Select value={language} onChange={(value) => setLanguage(value as LanguageSetting)} options={languageOptions} />
          </Field>
          <Field label="关闭窗口时">
            <Select
              value={closeAction}
              onChange={(value) => setCloseAction(value as "ask" | "minimize" | "quit")}
              options={closeOptions}
            />
          </Field>
        </div>
      </SettingsCard>

      <SettingsCard title="助手显示和运行默认值" description="这些字段写入网关，模型回复和工具提示会使用它们。">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="时区">
            <Input value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} />
          </Field>
          <Field label="助手名称">
            <Input value={form.botName} onChange={(event) => setForm({ ...form, botName: event.target.value })} />
          </Field>
          <Field label="助手图标">
            <Input value={form.botIcon} onChange={(event) => setForm({ ...form, botIcon: event.target.value })} />
          </Field>
          <Field label="工具提示最大长度">
            <Input
              type="number"
              value={form.toolHintMaxLength}
              onChange={(event) => setForm({ ...form, toolHintMaxLength: numberValue(event.target.value, form.toolHintMaxLength) })}
            />
          </Field>
        </div>
        <Button className="mt-5 bg-[#d97757] text-white hover:bg-[#c86647]" onClick={onSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          保存通用设置
        </Button>
      </SettingsCard>
    </div>
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
