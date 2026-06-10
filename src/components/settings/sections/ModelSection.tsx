import { useSettingsStore, AVAILABLE_MODELS, getEffectiveModel } from '@/stores/settingsStore';
import { useI18n } from '@/i18n';
import { CircleCheck, CircleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';

export default function ModelSection() {
  const store = useSettingsStore();
  const { provider, model, customModel, setModel, setCustomModel } = store;
  const { t } = useI18n();

  const models = AVAILABLE_MODELS[provider] ?? [];
  const effectiveModel = getEffectiveModel(store);
  const isCustomModel = model === '__custom__';
  const hasModel = effectiveModel.trim().length > 0;

  return (
    <div className="space-y-5">
      {/* Model select */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-[#29261b]">{t.settings.model}</label>
        <Select
          value={model}
          onChange={(value) => setModel(value)}
          options={[
            ...models.map((m) => ({ value: m.id, label: m.label })),
            { value: '__custom__', label: t.settings.customModelOption },
          ]}
        />
      </div>

      {/* Custom model input */}
      {isCustomModel && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-[#29261b]">{t.settings.customModelName}</label>
          <input
            type="text"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            placeholder={t.settings.customModelPlaceholder}
            className="w-full h-10 px-3 bg-white border border-[#e8e4dd] rounded-lg text-sm text-[#29261b] focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757] transition-all"
          />
          <p className="text-xs text-[#656358]">
            {t.settings.customModelDesc}
          </p>
        </div>
      )}

      {/* Current model status */}
      <div className="p-4 rounded-lg bg-white border border-[#e8e4dd]">
        <h3 className="text-sm font-medium text-[#29261b] mb-3">{t.settings.currentModel}</h3>
        <div className="flex items-center gap-2.5">
          {hasModel ? (
            <CircleCheck className="h-4 w-4 text-green-500 flex-none" />
          ) : (
            <CircleAlert className="h-4 w-4 text-amber-500 flex-none" />
          )}
          <span className={cn(
            'text-sm font-mono',
            hasModel ? 'text-[#29261b]' : 'text-[#656358]'
          )}>
            {effectiveModel || t.settings.notSet}
          </span>
        </div>
      </div>
    </div>
  );
}
