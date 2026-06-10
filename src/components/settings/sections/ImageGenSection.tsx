import { useState } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useI18n } from '@/i18n';
import { Eye, EyeOff } from 'lucide-react';
import { Select } from '@/components/ui/select';

const IMAGE_MODELS = [
  { id: 'dall-e-3', label: 'DALL-E 3' },
  { id: 'dall-e-2', label: 'DALL-E 2' },
  { id: '__custom__', label: 'Custom' },
];

/** Inline mode: renders only the form fields without section header */
export function ImageGenForm() {
  const {
    imageGenApiKey,
    imageGenBaseUrl,
    imageGenModel,
    setImageGenApiKey,
    setImageGenBaseUrl,
    setImageGenModel,
  } = useSettingsStore();
  const { t } = useI18n();
  const [showKey, setShowKey] = useState(false);
  const [customModel, setCustomModel] = useState(
    IMAGE_MODELS.some((m) => m.id === imageGenModel) ? '' : imageGenModel
  );

  const isCustomModel = !IMAGE_MODELS.some((m) => m.id === imageGenModel) || imageGenModel === '__custom__';

  const handleModelChange = (value: string) => {
    if (value === '__custom__') {
      setImageGenModel(customModel || '__custom__');
    } else {
      setImageGenModel(value);
    }
  };

  const handleCustomModelChange = (value: string) => {
    setCustomModel(value);
    if (value) {
      setImageGenModel(value);
    }
  };

  return (
    <div className="space-y-4">
      {/* API Key */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-[#29261b]">{t.settings.imageGenApiKey}</label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={imageGenApiKey}
            onChange={(e) => setImageGenApiKey(e.target.value)}
            placeholder={t.settings.imageGenApiKeyPlaceholder}
            className="w-full px-3 py-2 pr-10 text-sm border border-[#e8e4dd] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757] text-[#29261b]"
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#888579] hover:text-[#29261b] rounded"
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-xs text-[#888579]">{t.settings.imageGenApiKeyDesc}</p>
      </div>

      {/* Base URL */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-[#29261b]">{t.settings.imageGenBaseUrl}</label>
        <input
          type="text"
          value={imageGenBaseUrl}
          onChange={(e) => setImageGenBaseUrl(e.target.value)}
          placeholder={t.settings.imageGenBaseUrlPlaceholder}
          className="w-full px-3 py-2 text-sm border border-[#e8e4dd] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757] text-[#29261b]"
        />
        <p className="text-xs text-[#888579]">{t.settings.imageGenBaseUrlDesc}</p>
      </div>

      {/* Model */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-[#29261b]">{t.settings.imageGenModel}</label>
        <Select
          value={isCustomModel ? '__custom__' : imageGenModel}
          onChange={handleModelChange}
          options={IMAGE_MODELS.map((m) => ({ value: m.id, label: m.label }))}
        />
      </div>

      {/* Custom model name input */}
      {isCustomModel && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-[#29261b]">{t.settings.imageGenCustomModel}</label>
          <input
            type="text"
            value={customModel}
            onChange={(e) => handleCustomModelChange(e.target.value)}
            placeholder="gpt-image-1"
            className="w-full px-3 py-2 text-sm border border-[#e8e4dd] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757] text-[#29261b] font-mono"
          />
        </div>
      )}
    </div>
  );
}

export default function ImageGenSection() {
  const { t } = useI18n();
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-[#29261b]">{t.settings.imageGen}</h3>
        <p className="text-sm text-[#888579] mt-1">{t.settings.imageGenDescription}</p>
      </div>
      <ImageGenForm />
    </div>
  );
}
