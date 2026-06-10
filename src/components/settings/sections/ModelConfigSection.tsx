import { useSettingsStore, getEffectiveModel, PROVIDER_CONFIGS, getAvailableProviders } from '@/stores/settingsStore';
import type { LLMProvider } from '@/types';
import { Eye, EyeOff, CircleCheck, CircleAlert, Brain, Thermometer, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n';
import { Select } from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { Input } from '@/components/ui/input';

// Filtered by edition — community edition won't see internal-only providers
const PROVIDER_OPTIONS = getAvailableProviders().map(id => ({ value: id, label: PROVIDER_CONFIGS[id].name }));

export default function ModelConfigSection() {
  const store = useSettingsStore();
  const {
    provider, apiFormat, model, customModel, apiKey, baseUrl,
    temperature, enableThinking, thinkingBudget,
    setApiFormat, setModel, setCustomModel, setApiKey, setBaseUrl,
    setTemperature, setEnableThinking, setThinkingBudget,
    switchProvider,
  } = store;

  const { t } = useI18n();
  const [showKey, setShowKey] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const effectiveModel = getEffectiveModel(store);
  const hasApiKey = apiKey.trim().length > 0;

  // 获取当前选中的厂商配置
  const currentProviderConfig = PROVIDER_CONFIGS[provider] ?? PROVIDER_CONFIGS.anthropic;
  const isCustomProvider = provider === 'custom';
  const hasBaseUrl = !isCustomProvider || baseUrl.trim().length > 0;
  const hasModel = !!effectiveModel;

  // 获取可用模型列表 (map to SelectOption format)
  const availableModels = (isCustomProvider
    ? (customModel ? [{ id: customModel, label: customModel }] : [])
    : currentProviderConfig.models
  ).map(m => ({ value: m.id, label: m.label }));

  return (
    <div className="space-y-5">
      {/* 当前配置状态 - 放在最上方 */}
      <div className="p-4 bg-[#f5f3ee] rounded-xl space-y-3">
        <h4 className="text-xs font-medium text-[#656358] uppercase tracking-wider">{t.settings.currentConfig}</h4>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            {hasApiKey ? (
              <CircleCheck className="h-4 w-4 text-green-600 flex-none" />
            ) : (
              <CircleAlert className="h-4 w-4 text-amber-500 flex-none" />
            )}
            <span className="text-[#656358]">{t.settings.apiKey}:</span>
            <span className={cn(hasApiKey ? 'text-green-600' : 'text-amber-600', 'font-medium')}>
              {hasApiKey ? t.settings.configured : t.settings.notConfigured}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {hasBaseUrl ? (
              <CircleCheck className="h-4 w-4 text-green-600 flex-none" />
            ) : (
              <CircleAlert className="h-4 w-4 text-amber-500 flex-none" />
            )}
            <span className="text-[#656358]">{t.settings.provider}:</span>
            <span className={cn(hasBaseUrl ? 'text-[#29261b]' : 'text-amber-600', 'font-medium')}>
              {currentProviderConfig.name}{!hasBaseUrl && ` (${t.settings.notConfigured})`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {hasModel ? (
              <CircleCheck className="h-4 w-4 text-green-600 flex-none" />
            ) : (
              <CircleAlert className="h-4 w-4 text-amber-500 flex-none" />
            )}
            <span className="text-[#656358]">{t.settings.model}:</span>
            <span className={cn(hasModel ? 'text-[#29261b]' : 'text-amber-600', 'font-medium truncate')}>
              {effectiveModel || t.settings.notSet}
            </span>
          </div>
        </div>
      </div>

      {/* API 厂商选择 */}
      <div className="space-y-2">
        <label className="text-xs text-[#656358] font-medium">{t.settings.provider}</label>
        <Select
          value={provider}
          options={PROVIDER_OPTIONS}
          onChange={(v) => switchProvider(v as LLMProvider)}
          placeholder={t.settings.selectProvider}
        />
      </div>

      {/* 自定义 API 地址（仅自定义模式显示） */}
      {isCustomProvider && (
        <div className="space-y-2">
          <label className="text-xs text-[#656358] font-medium">{t.settings.apiUrl} <span className="text-red-400">*</span></label>
          <Input
            type="text"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://your-api.com"
          />
          <p className="text-xs text-[#888579]">{t.settings.apiUrlDesc}</p>
        </div>
      )}

      {/* 自定义模型名称（仅自定义模式显示） */}
      {isCustomProvider && (
        <div className="space-y-2">
          <label className="text-xs text-[#656358] font-medium">{t.settings.customModelName} <span className="text-red-400">*</span></label>
          <Input
            type="text"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            placeholder={t.settings.customModelPlaceholder}
          />
        </div>
      )}

      {/* 自定义 API 格式（仅自定义模式显示） */}
      {isCustomProvider && (
        <div className="space-y-2">
          <label className="text-xs text-[#656358] font-medium">{t.settings.apiFormat}</label>
          <div className="flex gap-2">
            <button
              onClick={() => setApiFormat('openai-compatible')}
              className={cn(
                'flex-1 h-9 px-3 rounded-lg text-sm font-medium transition-all',
                apiFormat === 'openai-compatible'
                  ? 'bg-[#d97757] text-white'
                  : 'bg-[#f5f3ee] text-[#656358] hover:bg-[#e8e5de]'
              )}
            >
              {t.settings.openaiCompatible}
            </button>
            <button
              onClick={() => setApiFormat('anthropic')}
              className={cn(
                'flex-1 h-9 px-3 rounded-lg text-sm font-medium transition-all',
                apiFormat === 'anthropic'
                  ? 'bg-[#d97757] text-white'
                  : 'bg-[#f5f3ee] text-[#656358] hover:bg-[#e8e5de]'
              )}
            >
              {t.settings.anthropicNative}
            </button>
          </div>
        </div>
      )}

      {/* 模型选择（非自定义模式） */}
      {!isCustomProvider && availableModels.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs text-[#656358] font-medium">{t.settings.model}</label>
          <Select
            value={model}
            options={availableModels}
            onChange={(v) => setModel(v)}
            placeholder={t.settings.selectModel}
          />
        </div>
      )}

      {/* API Key */}
      <div className="space-y-2">
        <label className="text-xs text-[#656358] font-medium">{t.settings.apiKey} <span className="text-red-400">*</span></label>
        <div className="relative">
          <Input
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="pr-10"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-[#888579] hover:text-[#656358] transition-colors"
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-[#888579]">{t.settings.apiKeyDesc}</p>
      </div>


      {/* 高级参数折叠 */}
      <div className="border border-[#e8e4dd] rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-[#f5f3ee] transition-colors"
        >
          <span className="text-sm font-medium text-[#29261b]">{t.settings.advanced}</span>
          <ChevronDown className={cn('h-4 w-4 text-[#888579] transition-transform', showAdvanced && 'rotate-180')} />
        </button>

        {showAdvanced && (
          <div className="px-4 pb-4 space-y-4 bg-white border-t border-[#e8e4dd]">
            {/* Temperature */}
            <div className="space-y-2 pt-4">
              <div className="flex items-center justify-between">
                <label className="text-xs text-[#656358] font-medium flex items-center gap-1.5">
                  <Thermometer className="h-3.5 w-3.5" />
                  {t.settings.temperature}
                </label>
                <span className="text-xs font-mono text-[#29261b]">{temperature.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full slider-filled"
                style={{ '--slider-progress': `${temperature * 100}%` } as React.CSSProperties}
              />
              <div className="flex justify-between text-[10px] text-[#888579]">
                <span>{t.settings.temperaturePrecise}</span>
                <span>{t.settings.temperatureCreative}</span>
              </div>
            </div>

            {/* Extended Thinking */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-[#656358] font-medium flex items-center gap-1.5">
                  <Brain className="h-3.5 w-3.5" />
                  {t.settings.extendedThinking}
                </label>
                <Toggle
                  checked={enableThinking}
                  onChange={() => setEnableThinking(!enableThinking)}
                  size="md"
                />
              </div>
              <p className="text-xs text-[#888579]">{t.settings.extendedThinkingDescription}</p>
            </div>

            {enableThinking && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-[#656358] font-medium">{t.settings.thinkingBudget}</label>
                  <span className="text-xs font-mono text-[#29261b]">{thinkingBudget.toLocaleString()}</span>
                </div>
                <input
                  type="range"
                  min="1000"
                  max="50000"
                  step="1000"
                  value={thinkingBudget}
                  onChange={(e) => setThinkingBudget(parseInt(e.target.value))}
                  className="w-full slider-filled"
                  style={{ '--slider-progress': `${((thinkingBudget - 1000) / 49000) * 100}%` } as React.CSSProperties}
                />
                <div className="flex justify-between text-[10px] text-[#888579]">
                  <span>{t.settings.thinkingBudgetFast}</span>
                  <span>{t.settings.thinkingBudgetDeep}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
