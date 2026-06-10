import { useSettingsStore } from '@/stores/settingsStore';
import { type LanguageSetting, useI18n } from '@/i18n';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function LanguageSection() {
  const { language, setLanguage } = useSettingsStore();
  const { t } = useI18n();

  const languageOptions: { value: LanguageSetting; label: string; desc: string }[] = [
    { value: 'system', label: t.settings.followSystem, desc: t.settings.languageDescription },
    { value: 'zh-CN', label: '简体中文', desc: 'Simplified Chinese' },
    { value: 'en-US', label: 'English', desc: 'English' },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#656358]">
        {t.settings.languageDescription}
      </p>

      <div className="space-y-2">
        {languageOptions.map((option) => (
          <button
            key={option.value}
            onClick={() => setLanguage(option.value)}
            className={cn(
              'w-full flex items-center justify-between p-4 rounded-xl border transition-all text-left',
              language === option.value
                ? 'border-[#d97757] bg-[#d97757]/5'
                : 'border-[#e8e4dd] bg-white hover:border-[#d97757]/50'
            )}
          >
            <div>
              <p className={cn(
                'text-sm font-medium',
                language === option.value ? 'text-[#d97757]' : 'text-[#29261b]'
              )}>
                {option.label}
              </p>
              <p className="text-xs text-[#888579] mt-0.5">{option.desc}</p>
            </div>
            {language === option.value && (
              <div className="w-5 h-5 rounded-full bg-[#d97757] flex items-center justify-center">
                <Check className="h-3 w-3 text-white" />
              </div>
            )}
          </button>
        ))}
      </div>

    </div>
  );
}
