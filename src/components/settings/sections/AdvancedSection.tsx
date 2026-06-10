import { useSettingsStore } from '@/stores/settingsStore';
import { useI18n, type LanguageSetting } from '@/i18n';
import { Brain, Thermometer, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Toggle } from '@/components/ui/toggle';

const languageOptions: { value: LanguageSetting; label: string; nativeLabel?: string }[] = [
  { value: 'system', label: 'Follow System', nativeLabel: '跟随系统' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English' },
];

export default function AdvancedSection() {
  const { t } = useI18n();
  const {
    temperature, enableThinking, thinkingBudget, language,
    setTemperature, setEnableThinking, setThinkingBudget, setLanguage,
  } = useSettingsStore();

  return (
    <div className="space-y-6">
      {/* Temperature slider */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-[#29261b] flex items-center gap-2">
            <Thermometer className="h-4 w-4 text-[#656358]" />
            {t.settings.temperature}
          </label>
          <span className="text-sm font-mono text-[#29261b] bg-white border border-[#e8e4dd] px-2 py-0.5 rounded">
            {temperature.toFixed(2)}
          </span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={temperature}
          onChange={(e) => setTemperature(parseFloat(e.target.value))}
          className="w-full h-2 bg-[#e8e5de] rounded-lg appearance-none cursor-pointer accent-[#d97757]"
        />
        <div className="flex justify-between text-xs text-[#656358]">
          <span>{t.settings.temperaturePrecise}</span>
          <span>{t.settings.temperatureCreative}</span>
        </div>
        <p className="text-xs text-[#656358] leading-relaxed">
          {t.settings.temperatureDescription}
        </p>
      </div>

      {/* Extended Thinking toggle */}
      <div className="p-4 rounded-lg border border-[#e8e4dd] bg-white space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-[#29261b] flex items-center gap-2">
            <Brain className="h-4 w-4 text-[#656358]" />
            {t.settings.extendedThinking}
          </label>
          <Toggle
            checked={enableThinking}
            onChange={() => setEnableThinking(!enableThinking)}
            size="lg"
          />
        </div>
        <p className="text-xs text-[#656358]">
          {t.settings.extendedThinkingDescription}
        </p>

        {/* Thinking Budget */}
        {enableThinking && (
          <div className="pt-3 border-t border-[#e8e4dd] space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm text-[#656358]">{t.settings.thinkingBudget}</label>
              <span className="text-sm font-mono text-[#29261b]">
                {thinkingBudget.toLocaleString()}
              </span>
            </div>
            <input
              type="range"
              min="1000"
              max="50000"
              step="1000"
              value={thinkingBudget}
              onChange={(e) => setThinkingBudget(parseInt(e.target.value))}
              className="w-full h-2 bg-[#e8e5de] rounded-lg appearance-none cursor-pointer accent-[#d97757]"
            />
            <div className="flex justify-between text-xs text-[#656358]">
              <span>{t.settings.thinkingBudgetFast}</span>
              <span>{t.settings.thinkingBudgetDeep}</span>
            </div>
          </div>
        )}
      </div>

      {/* Language selector */}
      <div className="p-4 rounded-lg border border-[#e8e4dd] bg-white space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-[#29261b] flex items-center gap-2">
            <Globe className="h-4 w-4 text-[#656358]" />
            {t.settings.language}
          </label>
        </div>
        <p className="text-xs text-[#656358]">
          {t.settings.languageDescription}
        </p>
        <div className="flex gap-2 pt-1">
          {languageOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => setLanguage(option.value)}
              className={cn(
                'px-3 py-1.5 text-sm rounded-lg border transition-colors',
                language === option.value
                  ? 'bg-[#29261b] text-white border-[#29261b]'
                  : 'bg-white text-[#656358] border-[#e8e4dd] hover:border-[#c5c2b8] hover:text-[#29261b]'
              )}
            >
              {option.value === 'system'
                ? t.settings.followSystem
                : option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
