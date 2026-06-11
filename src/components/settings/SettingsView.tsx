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
  Package,
  RefreshCw,
  Save,
  Shield,
  SlidersHorizontal,
} from "lucide-react";

import {
  createModelConfiguration,
  fetchProviderModels,
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
  syncGatewaySettingsToStore,
} from "@/core/nanobotClient";
import type {
  ProviderModelsPayload,
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

type NewModelForm = {
  label: string;
  provider: string;
  model: string;
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
  { key: "providers", label: "模型服务", description: "Provider / API Key / OAuth", icon: Cpu },
  { key: "models", label: "模型预设", description: "默认模型和上下文窗口", icon: SlidersHorizontal },
  { key: "search", label: "联网搜索", description: "搜索引擎和读取策略", icon: Globe },
  { key: "image", label: "图像生成", description: "图片模型和默认尺寸", icon: ImageIcon },
  { key: "safety", label: "安全边界", description: "本地网络和工作区访问", icon: Shield },
  { key: "general", label: "通用", description: "语言、关闭行为、助手信息", icon: Bot },
  { key: "about", label: "运行信息", description: "Gateway 状态和配置路径", icon: Info },
];

const apiTypeOptions = [
  { value: "auto", label: "自动" },
  { value: "chat_completions", label: "Chat Completions" },
  { value: "responses", label: "Responses" },
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

const accessModeOptions = [
  { value: "default", label: "默认受限" },
  { value: "full", label: "默认完全访问" },
];

const ratioOptions = ["1:1", "16:9", "9:16", "4:3", "3:4"].map((value) => ({ value, label: value }));
const sizeOptions = ["1024x1024", "1536x1024", "1024x1536", "auto"].map((value) => ({ value, label: value }));

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
  const [newModelForm, setNewModelForm] = useState<NewModelForm>({
    label: "",
    provider: "",
    model: "",
  });
  const [modelCatalog, setModelCatalog] = useState<ProviderModelsPayload | null>(null);
  const [modelCatalogLoading, setModelCatalogLoading] = useState(false);
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
    webuiDefaultAccessMode: "default",
  });

  const providerOptions = useMemo(
    () => (settings?.providers ?? []).map((provider) => ({ value: provider.name, label: provider.label })),
    [settings],
  );

  const selectedProviderInfo = useMemo(
    () => settings?.providers.find((provider) => provider.name === selectedProvider) ?? null,
    [selectedProvider, settings],
  );

  const modelPresetOptions = useMemo(
    () =>
      (settings?.model_presets ?? []).map((preset) => ({
        value: preset.name,
        label: preset.active ? `${preset.label}（当前）` : preset.label,
      })),
    [settings],
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
      setNewModelForm((prev) => ({
        ...prev,
        provider: prev.provider || activePreset.provider,
      }));
    } else {
      setModelForm((prev) => ({
        ...prev,
        provider: payload.agent.provider,
        model: payload.agent.model,
        contextWindowTokens: payload.agent.context_window_tokens,
      }));
      setNewModelForm((prev) => ({
        ...prev,
        provider: prev.provider || payload.agent.provider,
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
      webuiDefaultAccessMode: payload.advanced.webui_default_access_mode,
    });
  }, []);

  const loadSettings = useCallback(
    async (base = apiBase, authToken = token, silent = false) => {
      if (!base || !authToken) return;
      if (silent) setRefreshing(true);
      else setLoading(true);
      setError("");
      try {
        const settingsPayload = await fetchSettings(authToken, base);
        applyPayload(settingsPayload);
      } catch (err) {
        setError(toErrorMessage(err));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [apiBase, applyPayload, token],
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
        throw new Error("Nanobot gateway 还没有准备好，请稍后重试。");
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

  useEffect(() => {
    if (!token || !apiBase || !modelForm.provider) return;
    let cancelled = false;
    setModelCatalogLoading(true);
    fetchProviderModels(token, modelForm.provider, apiBase)
      .then((payload) => {
        if (!cancelled) setModelCatalog(payload);
      })
      .catch(() => {
        if (!cancelled) setModelCatalog(null);
      })
      .finally(() => {
        if (!cancelled) setModelCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, modelForm.provider, token]);

  const replaceSettings = useCallback(
    async (payload: SettingsPayload) => {
      applyPayload(payload);
      onModelNameChange?.(payload.agent.model);
      await syncGatewaySettingsToStore();
    },
    [applyPayload, onModelNameChange],
  );

  const saveProvider = () =>
    withAction(
      "provider",
      async () => {
        const payload = await updateProviderSettings(
          token,
          {
            provider: selectedProvider,
            apiKey: providerForm.apiKey,
            apiBase: providerForm.apiBase,
            apiType: providerForm.apiType,
          },
          apiBase,
        );
        await replaceSettings(payload);
      },
      "模型服务已保存",
    );

  const setActiveProvider = () =>
    withAction(
      "active-provider",
      async () => {
        const payload = await updateSettings(token, { provider: selectedProvider }, apiBase);
        await replaceSettings(payload);
      },
      "默认模型服务已切换",
    );

  const oauthAction = (action: "login" | "logout") =>
    withAction(
      `oauth-${action}`,
      async () => {
        const payload =
          action === "login"
            ? await loginProviderOAuth(token, selectedProvider, apiBase)
            : await logoutProviderOAuth(token, selectedProvider, apiBase);
        await replaceSettings(payload);
      },
      action === "login" ? "OAuth 登录已发起" : "OAuth 已退出",
    );

  const saveModelPreset = () =>
    selectedModelPreset
      ? withAction(
          "model-save",
          async () => {
            const payload = await updateModelConfiguration(
              token,
              {
                name: selectedModelPreset.name,
                label: modelForm.label,
                provider: modelForm.provider,
                model: modelForm.model,
                contextWindowTokens: modelForm.contextWindowTokens,
              },
              apiBase,
            );
            await replaceSettings(payload);
          },
          "模型预设已保存",
        )
      : undefined;

  const activateModelPreset = () =>
    selectedModelPreset
      ? withAction(
          "model-active",
          async () => {
            const payload = await updateSettings(token, { modelPreset: selectedModelPreset.name }, apiBase);
            await replaceSettings(payload);
          },
          "默认模型预设已切换",
        )
      : undefined;

  const createModelPreset = () =>
    withAction(
      "model-create",
      async () => {
        const payload = await createModelConfiguration(token, newModelForm, apiBase);
        await replaceSettings(payload);
        setNewModelForm({ label: "", provider: newModelForm.provider, model: "" });
      },
      "模型预设已创建",
    );

  const saveWebSearch = () =>
    withAction(
      "web-search",
      async () => {
        const payload = await updateWebSearchSettings(
          token,
          {
            provider: webSearchForm.provider,
            apiKey: webSearchForm.apiKey,
            baseUrl: webSearchForm.baseUrl,
            maxResults: webSearchForm.maxResults,
            timeout: webSearchForm.timeout,
            useJinaReader: webSearchForm.useJinaReader,
          },
          apiBase,
        );
        await replaceSettings(payload);
      },
      "联网搜索设置已保存",
    );

  const saveImage = () =>
    withAction(
      "image",
      async () => {
        const payload = await updateImageGenerationSettings(token, imageForm, apiBase);
        await replaceSettings(payload);
      },
      "图像生成设置已保存",
    );

  const saveSafety = () =>
    withAction(
      "safety",
      async () => {
        const payload = await updateNetworkSafetySettings(token, safetyForm, apiBase);
        await replaceSettings(payload);
      },
      "安全设置已保存",
    );

  const saveGeneral = () =>
    withAction(
      "general",
      async () => {
        const payload = await updateSettings(
          token,
          {
            timezone: generalForm.timezone,
            botName: generalForm.botName,
            botIcon: generalForm.botIcon,
            toolHintMaxLength: generalForm.toolHintMaxLength,
          },
          apiBase,
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
      <aside className="w-72 shrink-0 border-r border-[#e8e4dd] bg-[#f6f1eb] p-4">
        <div className="mb-5 px-2">
          <h1 className="text-xl font-semibold">设置</h1>
          <p className="mt-1 text-sm text-[#777267]">由 nanobot gateway 提供配置能力</p>
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
              <p className="mt-1 text-sm text-[#777267]">
                {apiBase ? `当前连接：${apiBase}` : "正在读取 gateway 状态"}
              </p>
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
            <ProvidersSection
              providerOptions={providerOptions}
              selectedProvider={selectedProvider}
              setSelectedProvider={setSelectedProvider}
              provider={selectedProviderInfo}
              form={providerForm}
              setForm={setProviderForm}
              agentProvider={settings.agent.provider}
              saving={saving}
              onSave={saveProvider}
              onActivate={setActiveProvider}
              onOauth={oauthAction}
            />
          )}

          {activeTab === "models" && settings && (
            <ModelsSection
              providerOptions={providerOptions}
              presetOptions={modelPresetOptions}
              selectedPreset={selectedPreset}
              setSelectedPreset={setSelectedPreset}
              selectedModelPreset={selectedModelPreset}
              form={modelForm}
              setForm={setModelForm}
              newForm={newModelForm}
              setNewForm={setNewModelForm}
              catalog={modelCatalog}
              catalogLoading={modelCatalogLoading}
              saving={saving}
              onSave={saveModelPreset}
              onActivate={activateModelPreset}
              onCreate={createModelPreset}
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

function ProvidersSection({
  providerOptions,
  selectedProvider,
  setSelectedProvider,
  provider,
  form,
  setForm,
  agentProvider,
  saving,
  onSave,
  onActivate,
  onOauth,
}: {
  providerOptions: Array<{ value: string; label: string }>;
  selectedProvider: string;
  setSelectedProvider: (value: string) => void;
  provider: SettingsPayload["providers"][number] | null;
  form: ProviderForm;
  setForm: (form: ProviderForm) => void;
  agentProvider: string;
  saving: Record<ActionKey, boolean>;
  onSave: () => void;
  onActivate: () => void;
  onOauth: (action: "login" | "logout") => void;
}) {
  const oauth = provider?.auth_type === "oauth";
  return (
    <SettingsCard
      title="模型服务"
      description="这些配置会直接写入 nanobot gateway，聊天、工具调用和图像生成都读取同一份配置。"
      actions={<StatusPill ok={provider?.configured ?? false}>{provider?.configured ? "已配置" : "未配置"}</StatusPill>}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="服务商">
          <Select value={selectedProvider} onChange={setSelectedProvider} options={providerOptions} />
        </Field>
        <Field label="API 类型">
          <Select
            value={form.apiType}
            onChange={(value) => setForm({ ...form, apiType: value as ProviderForm["apiType"] })}
            options={apiTypeOptions}
          />
        </Field>
        <Field label="API Base" hint={provider?.default_api_base ? `默认：${provider.default_api_base}` : undefined}>
          <Input value={form.apiBase} onChange={(event) => setForm({ ...form, apiBase: event.target.value })} />
        </Field>
        {!oauth ? (
          <Field label="API Key" hint={provider?.api_key_hint ? `当前：${provider.api_key_hint}` : "留空表示不修改已有密钥。"}>
            <Input
              type="password"
              value={form.apiKey}
              onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
              placeholder="sk-..."
            />
          </Field>
        ) : (
          <div className="rounded-lg border border-[#e8e4dd] bg-[#faf9f7] p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">OAuth 账号</div>
                <div className="mt-1 text-xs text-[#777267]">{provider?.oauth_account || "尚未登录"}</div>
              </div>
              <Button variant="outline" size="sm" onClick={() => onOauth(provider?.oauth_account ? "logout" : "login")}>
                <KeyRound className="h-4 w-4" />
                {provider?.oauth_account ? "退出" : "登录"}
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button className="bg-[#d97757] text-white hover:bg-[#c86647]" onClick={onSave} disabled={saving.provider}>
          {saving.provider ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          保存服务配置
        </Button>
        <Button
          variant="outline"
          className="border-[#e1ddd5] bg-white"
          onClick={onActivate}
          disabled={agentProvider === selectedProvider || saving["active-provider"]}
        >
          设为默认服务
        </Button>
      </div>
    </SettingsCard>
  );
}

function ModelsSection({
  providerOptions,
  presetOptions,
  selectedPreset,
  setSelectedPreset,
  selectedModelPreset,
  form,
  setForm,
  newForm,
  setNewForm,
  catalog,
  catalogLoading,
  saving,
  onSave,
  onActivate,
  onCreate,
}: {
  providerOptions: Array<{ value: string; label: string }>;
  presetOptions: Array<{ value: string; label: string }>;
  selectedPreset: string;
  setSelectedPreset: (value: string) => void;
  selectedModelPreset: SettingsPayload["model_presets"][number] | null;
  form: ModelForm;
  setForm: (form: ModelForm) => void;
  newForm: NewModelForm;
  setNewForm: (form: NewModelForm) => void;
  catalog: ProviderModelsPayload | null;
  catalogLoading: boolean;
  saving: Record<ActionKey, boolean>;
  onSave: () => void;
  onActivate: () => void;
  onCreate: () => void;
}) {
  const catalogOptions = (catalog?.models ?? []).map((model) => ({
    value: model.id,
    label: model.label ? `${model.label} (${model.id})` : model.id,
  }));
  return (
    <div className="space-y-5">
      <SettingsCard title="编辑模型预设" description="预设用于控制默认模型、供应商和上下文窗口。">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="预设">
            <Select value={selectedPreset} onChange={setSelectedPreset} options={presetOptions} />
          </Field>
          <Field label="显示名称">
            <Input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} />
          </Field>
          <Field label="服务商">
            <Select value={form.provider} onChange={(value) => setForm({ ...form, provider: value })} options={providerOptions} />
          </Field>
          <Field label="模型 ID">
            <Input value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} />
          </Field>
          <Field label="上下文窗口 Token">
            <Input
              type="number"
              value={form.contextWindowTokens}
              onChange={(event) =>
                setForm({ ...form, contextWindowTokens: numberValue(event.target.value, form.contextWindowTokens) })
              }
            />
          </Field>
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button className="bg-[#d97757] text-white hover:bg-[#c86647]" onClick={onSave} disabled={saving["model-save"]}>
            {saving["model-save"] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存预设
          </Button>
          <Button
            variant="outline"
            className="border-[#e1ddd5] bg-white"
            onClick={onActivate}
            disabled={!selectedModelPreset || selectedModelPreset.active || saving["model-active"]}
          >
            设为默认模型
          </Button>
        </div>
      </SettingsCard>

      <SettingsCard
        title="新增模型预设"
        description={catalogLoading ? "正在读取服务商模型列表..." : catalog?.message || "可以直接填写模型 ID，也可以从服务商目录选择。"}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="显示名称">
            <Input value={newForm.label} onChange={(event) => setNewForm({ ...newForm, label: event.target.value })} />
          </Field>
          <Field label="服务商">
            <Select value={newForm.provider} onChange={(value) => setNewForm({ ...newForm, provider: value })} options={providerOptions} />
          </Field>
          <Field label="模型 ID">
            <Input value={newForm.model} onChange={(event) => setNewForm({ ...newForm, model: event.target.value })} />
          </Field>
          {catalogOptions.length ? (
            <Field label="从目录选择">
              <Select value={newForm.model} onChange={(value) => setNewForm({ ...newForm, model: value })} options={catalogOptions} />
            </Field>
          ) : null}
        </div>
        <Button
          className="mt-5 bg-[#d97757] text-white hover:bg-[#c86647]"
          onClick={onCreate}
          disabled={!newForm.label || !newForm.provider || !newForm.model || saving["model-create"]}
        >
          {saving["model-create"] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Package className="h-4 w-4" />}
          创建预设
        </Button>
      </SettingsCard>
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
  const sandbox = settings.advanced.workspace_sandbox;
  return (
    <SettingsCard title="安全边界" description="GUI 只暴露 nanobot 当前支持的安全配置；系统级沙箱状态由 gateway 汇报。">
      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border border-[#e8e4dd] bg-[#faf9f7] px-4 py-3">
          <div>
            <div className="text-sm font-medium">允许访问本机服务</div>
            <div className="mt-1 text-xs text-[#777267]">关闭后，网页工具会阻止访问 localhost 和私有网络。</div>
          </div>
          <Toggle
            checked={form.webuiAllowLocalServiceAccess}
            onChange={() => setForm({ ...form, webuiAllowLocalServiceAccess: !form.webuiAllowLocalServiceAccess })}
          />
        </div>
        <Field label="默认工作区访问模式">
          <Select
            value={form.webuiDefaultAccessMode}
            onChange={(value) => setForm({ ...form, webuiDefaultAccessMode: value as WebuiDefaultAccessMode })}
            options={accessModeOptions}
          />
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <InfoBlock label="工作区限制" value={settings.advanced.restrict_to_workspace ? "开启" : "关闭"} />
          <InfoBlock label="私有服务保护" value={settings.advanced.private_service_protection_enabled ? "开启" : "关闭"} />
          <InfoBlock label="执行沙箱" value={settings.advanced.exec_sandbox || "未启用"} />
          <InfoBlock label="MCP 服务数" value={String(settings.advanced.mcp_server_count)} />
          {sandbox ? <InfoBlock label="系统沙箱" value={`${sandbox.provider_label} · ${sandbox.summary}`} wide /> : null}
        </div>
      </div>
      <Button className="mt-5 bg-[#d97757] text-white hover:bg-[#c86647]" onClick={onSave} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        保存安全设置
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

      <SettingsCard title="助手显示和运行默认值" description="这些字段写入 gateway，模型回复和工具提示会使用它们。">
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
    <SettingsCard title="运行信息" description="用于确认 GUI 当前连接的是嵌入式 nanobot gateway，而不是 WebUI 页面。">
      <div className="grid gap-3 md:grid-cols-2">
        <InfoBlock label="Gateway API" value={apiBase} />
        <InfoBlock label="运行表面" value={settings.runtime_surface || settings.surface || "native"} />
        <InfoBlock label="配置文件" value={settings.runtime.config_path} wide />
        <InfoBlock label="工作区" value={settings.runtime.workspace_path} wide />
        <InfoBlock label="Gateway 地址" value={`${settings.runtime.gateway_host}:${settings.runtime.gateway_port}`} />
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
