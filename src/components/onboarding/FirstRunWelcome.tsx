import { Check, Globe2, Monitor, Moon, Sparkles, Sun } from 'lucide-react';
import ruyiAvatar from '@/assets/ruyi-avatar.png';
import { useI18n } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { cn } from '@/lib/utils';

interface FirstRunWelcomeProps {
  onContinue: () => void;
}

export default function FirstRunWelcome({ onContinue }: FirstRunWelcomeProps) {
  const { t } = useI18n();
  const language = useSettingsStore((state) => state.language);
  const setLanguage = useSettingsStore((state) => state.setLanguage);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);

  const languageOptions = [
    { value: 'system' as const, label: t.onboarding.languageSystem },
    { value: 'zh-CN' as const, label: '简体中文' },
    { value: 'en-US' as const, label: 'English' },
  ];

  const themeOptions = [
    {
      value: 'system' as const,
      label: t.onboarding.themeSystem,
      description: t.onboarding.themeSystemDescription,
      icon: Monitor,
    },
    {
      value: 'light' as const,
      label: t.onboarding.themeLight,
      description: t.onboarding.themeLightDescription,
      icon: Sun,
    },
    {
      value: 'dark' as const,
      label: t.onboarding.themeDark,
      description: t.onboarding.themeDarkDescription,
      icon: Moon,
    },
  ];

  return (
    <div className="fixed inset-0 z-[10000] flex min-h-0 flex-col overflow-hidden bg-gradient-to-br from-[#fbfaf7] via-[#faf8f3] to-[#f1ede4] text-[#29261b] dark:from-[#171717] dark:via-[#1b1b1b] dark:to-[#202020] dark:text-[#f3f0e8]">
      <header className="relative flex h-11 shrink-0 items-center justify-center border-b border-[#ded9ce]/80 px-6 dark:border-[#393734] [app-region:drag]">
        <span className="pointer-events-none text-[11px] font-medium tabular-nums tracking-[0.18em] text-[#8b877d] dark:text-[#918d85]">
          {t.onboarding.stepIndicator}
        </span>
      </header>

      <div className="mx-auto flex w-full max-w-sm shrink-0 items-end justify-center px-10 pb-4 pt-5">
        <div className="flex items-end gap-1.5">
          <span className="text-[2.2rem] font-medium leading-none tracking-[0.08em] text-[#bf694b]">
            01
          </span>
          <span className="mb-0.5 text-sm font-medium tabular-nums text-[#969187] dark:text-[#8e8a83]">/01</span>
        </div>
      </div>
      <div className="relative mx-auto h-4 w-full max-w-sm shrink-0 px-10">
        <span className="absolute left-10 right-10 top-1/2 h-px -translate-y-1/2 bg-[#d8d3c9] dark:bg-[#4a4742]" />
        <span className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
          <span className="absolute h-5 w-5 rounded-full bg-[#d97757]/15" />
          <span className="relative h-2.5 w-2.5 rounded-full border-2 border-[#fbfaf7] bg-[#d97757] shadow-[0_0_0_1px_rgba(217,119,87,0.25)] dark:border-[#1b1b1b] dark:shadow-[0_0_0_1px_rgba(217,119,87,0.5)]" />
        </span>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-2xl items-center px-8 py-6">
          <div className="w-full space-y-8 py-4">
            <section className="flex flex-col items-center gap-4 text-center">
              <div className="relative">
                <div className="absolute inset-1 rounded-[24px] bg-[#d9a669]/25 blur-xl dark:bg-[#d97757]/20" />
                <img
                  src={ruyiAvatar}
                  alt=""
                  draggable={false}
                  className="relative h-20 w-20 rounded-[22px] object-cover shadow-[0_12px_35px_rgba(77,59,31,0.16)] dark:ring-1 dark:ring-white/10 dark:shadow-[0_14px_42px_rgba(0,0,0,0.48)]"
                />
                <span className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full border border-white/90 bg-[#fffaf0] text-[#c26f4f] shadow-sm dark:border-[#5a5650] dark:bg-[#262523] dark:text-[#e18462]">
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
              </div>
              <div>
                <h1 className="text-[30px] font-semibold tracking-[-0.025em] text-[#28251d] dark:text-[#f5f1e9]">
                  {t.onboarding.title}
                </h1>
                <p className="mx-auto mt-2 max-w-lg whitespace-pre-line text-[15px] leading-7 text-[#777267] dark:text-[#aaa59b]">
                  {t.onboarding.subtitle}
                </p>
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-[#474238] dark:text-[#d5d0c6]">
                <Globe2 className="h-4 w-4 text-[#817b70] dark:text-[#aaa59b]" />
                {t.onboarding.languageLabel}
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {languageOptions.map((option) => {
                  const active = language === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setLanguage(option.value)}
                      className={cn(
                        'relative h-11 rounded-xl border px-3 text-[14px] font-medium transition-colors',
                        active
                          ? 'border-[#d2c9ba] bg-[#eee9df] text-[#29261b] dark:border-[#806355] dark:bg-[#332a26] dark:text-[#f7f2e9]'
                          : 'border-[#dedad1] bg-white/55 text-[#5f5a50] hover:bg-[#f2eee6] dark:border-[#43413d] dark:bg-[#242424] dark:text-[#c8c3b9] dark:hover:bg-[#30302f]',
                      )}
                    >
                      {option.label}
                      {active && (
                        <Check className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#b96346]" />
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-[12px] text-[#928d83] dark:text-[#8f8b83]">{t.onboarding.languageHint}</p>
            </section>

            <section className="space-y-3">
              <div className="flex items-center gap-2 text-[14px] font-semibold text-[#474238] dark:text-[#d5d0c6]">
                <Monitor className="h-4 w-4 text-[#817b70] dark:text-[#aaa59b]" />
                {t.onboarding.appearanceLabel}
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {themeOptions.map((option) => {
                  const Icon = option.icon;
                  const active = theme === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setTheme(option.value)}
                      className={cn(
                        'flex min-h-14 items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors',
                        active
                          ? 'border-[#d2c9ba] bg-[#eee9df] dark:border-[#806355] dark:bg-[#332a26]'
                          : 'border-[#dedad1] bg-white/55 hover:bg-[#f2eee6] dark:border-[#43413d] dark:bg-[#242424] dark:hover:bg-[#30302f]',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-[#817b70] dark:text-[#aaa59b]" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-semibold text-[#38342c] dark:text-[#eeeae2]">{option.label}</span>
                        <span className="mt-0.5 block text-[12px] text-[#8c877d] dark:text-[#97938b]">{option.description}</span>
                      </span>
                      {active && <Check className="h-4 w-4 shrink-0 text-[#b96346]" />}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      </main>

      <footer className="flex h-[68px] shrink-0 items-center justify-end border-t border-[#ded9ce]/80 bg-[#fbfaf7]/80 px-6 backdrop-blur-sm dark:border-[#393734] dark:bg-[#181818]/90">
        <button
          type="button"
          onClick={onContinue}
          className="h-9 rounded-lg bg-[#29261b] px-5 text-[14px] font-semibold text-white shadow-sm transition-colors hover:bg-[#423d32] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/35 dark:bg-[#d97757] dark:hover:bg-[#c86c4d]"
        >
          {t.onboarding.start}
        </button>
      </footer>
    </div>
  );
}
