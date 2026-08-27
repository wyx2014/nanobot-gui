import { useState } from 'react';
import { Check, Globe2, Monitor, Moon, Sparkles, Sun } from 'lucide-react';
import appIcon from '../../../TPCowork-3_512x512.png';
import { useI18n } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { getNanobotStatus, getNanobotToken, refreshNanobotAuth } from '@/core/nanobotClient';
import { fetchPersonalization, savePersonalization } from '@/core/api';
import { cn } from '@/lib/utils';

interface FirstRunWelcomeProps {
  onContinue: () => void;
}

type CommunicationStyle = 'casual' | 'professional' | 'technical';
type ResponseLength = 'brief' | 'detailed' | 'adaptive';
type TechnicalLevel = 'beginner' | 'intermediate' | 'expert';

interface ProfileAnswers {
  name: string;
  communicationStyle: CommunicationStyle;
  responseLength: ResponseLength;
  technicalLevel: TechnicalLevel;
}

/** Replace one "## Section" (up to the next "## " header) in a markdown file. */
function replaceSection(markdown: string, title: string, body: string): string {
  const lines = markdown.split('\n');
  const header = `## ${title}`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) {
    const anchor = lines.findIndex((line, index) => index > 0 && line.trim().startsWith('## '));
    const insertAt = anchor === -1 ? lines.length : anchor;
    return [...lines.slice(0, insertAt), header, body, '', ...lines.slice(insertAt)].join('\n');
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith('## ')) {
      end = index;
      break;
    }
  }
  return [...lines.slice(0, start), header, '', body, ...lines.slice(end)].join('\n');
}

function checkbox(selected: boolean, label: string): string {
  return `- [${selected ? 'x' : ' '}] ${label}`;
}

function buildUserProfileMarkdown(
  existing: string,
  answers: ProfileAnswers,
  labels: {
    casual: string; professional: string; technical: string;
    brief: string; detailed: string; adaptive: string;
    beginner: string; intermediate: string; expert: string;
  },
): string {
  const basic = [
    `- **Name**: ${answers.name.trim() || '(your name)'}`,
    '- **Timezone**: Asia/Shanghai (UTC+8)',
    '- **Language**: 中文',
  ].join('\n');

  const preferences = [
    '### Communication Style',
    '',
    checkbox(answers.communicationStyle === 'casual', labels.casual),
    checkbox(answers.communicationStyle === 'professional', labels.professional),
    checkbox(answers.communicationStyle === 'technical', labels.technical),
    '',
    '### Response Length',
    '',
    checkbox(answers.responseLength === 'brief', labels.brief),
    checkbox(answers.responseLength === 'detailed', labels.detailed),
    checkbox(answers.responseLength === 'adaptive', labels.adaptive),
    '',
    '### Technical Level',
    '',
    checkbox(answers.technicalLevel === 'beginner', labels.beginner),
    checkbox(answers.technicalLevel === 'intermediate', labels.intermediate),
    checkbox(answers.technicalLevel === 'expert', labels.expert),
    '',
    '### Language',
    '',
    checkbox(false, 'English'),
    checkbox(true, '中文'),
  ].join('\n');

  return replaceSection(
    replaceSection(existing, 'Basic Information', basic),
    'Preferences',
    preferences,
  );
}

function ProfileField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[13px] font-semibold text-[#474238] dark:text-[#d5d0c6]">{label}</div>
      {children}
    </div>
  );
}

function PillGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-xl border px-3.5 py-2 text-[13px] font-medium transition-colors',
              active
                ? 'border-[#d2c9ba] bg-[#eee9df] text-[#29261b] dark:border-[#806355] dark:bg-[#332a26] dark:text-[#f7f2e9]'
                : 'border-[#dedad1] bg-white/55 text-[#5f5a50] hover:bg-[#f2eee6] dark:border-[#43413d] dark:bg-[#242424] dark:text-[#c8c3b9] dark:hover:bg-[#30302f]',
            )}
          >
            {option.label}
            {active && <Check className="ml-1.5 inline h-3.5 w-3.5 text-[#b96346]" />}
          </button>
        );
      })}
    </div>
  );
}

export default function FirstRunWelcome({ onContinue }: FirstRunWelcomeProps) {
  const { t } = useI18n();
  const language = useSettingsStore((state) => state.language);
  const setLanguage = useSettingsStore((state) => state.setLanguage);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);

  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<ProfileAnswers>({
    name: '',
    communicationStyle: 'professional',
    responseLength: 'adaptive',
    technicalLevel: 'intermediate',
  });

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

  const saveProfileInBackground = async () => {
    try {
      const deadline = Date.now() + 60_000;
      let status = await getNanobotStatus();
      while (!status.ready && Date.now() < deadline) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
        status = await getNanobotStatus();
      }
      if (status.ready) {
        const baseUrl = `http://127.0.0.1:${status.port}`;
        let token = getNanobotToken();
        if (!token) {
          const refreshed = await refreshNanobotAuth();
          token = refreshed.token;
        }
        if (token) {
          const current = await fetchPersonalization(token, baseUrl);
          const nextUser = buildUserProfileMarkdown(current.user ?? '', answers, {
            casual: t.onboarding.communicationCasual,
            professional: t.onboarding.communicationProfessional,
            technical: t.onboarding.communicationTechnical,
            brief: t.onboarding.responseBrief,
            detailed: t.onboarding.responseDetailed,
            adaptive: t.onboarding.responseAdaptive,
            beginner: t.onboarding.levelBeginner,
            intermediate: t.onboarding.levelIntermediate,
            expert: t.onboarding.levelExpert,
          });
          await savePersonalization(token, { user: nextUser }, baseUrl);
        }
      }
    } catch (err) {
      // Best-effort: profile persistence must never block first-run.
      console.warn('[onboarding] failed to save USER.md profile:', err);
    }
  };

  const finish = () => {
    // Enter the main UI immediately. Profile persistence is best-effort and
    // may wait for the already-warming gateway only in the background.
    onContinue();
    void saveProfileInBackground();
  };

  return (
    <div className="window-modal-viewport fixed inset-0 z-[10000] flex min-h-0 flex-col overflow-hidden bg-gradient-to-br from-[#fbfaf7] via-[#faf8f3] to-[#f1ede4] text-[#29261b] dark:from-[#171717] dark:via-[#1b1b1b] dark:to-[#202020] dark:text-[#f3f0e8]">
      <header className="relative flex h-11 shrink-0 items-center justify-center border-b border-[#ded9ce]/80 px-6 dark:border-[#393734] [app-region:drag]">
        <span className="pointer-events-none text-[11px] font-medium tabular-nums tracking-[0.18em] text-[#8b877d] dark:text-[#918d85]">
          {t.onboarding.stepIndicator}
        </span>
      </header>

      <div className="mx-auto flex w-full max-w-sm shrink-0 items-end justify-center px-10 pb-4 pt-5">
        <div className="flex items-end gap-1.5">
          <span className="text-[2.2rem] font-medium leading-none tracking-[0.08em] text-[#bf694b]">
            0{step + 1}
          </span>
          <span className="mb-0.5 text-sm font-medium tabular-nums text-[#969187] dark:text-[#8e8a83]">/02</span>
        </div>
      </div>
      <div className="relative mx-auto h-4 w-full max-w-sm shrink-0 px-10">
        <span className="absolute left-10 right-10 top-1/2 h-px -translate-y-1/2 bg-[#d8d3c9] dark:bg-[#4a4742]" />
        <span
          className={cn(
            'absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center transition-[left] duration-300 ease-in-out',
            step === 0 ? 'left-1/3' : 'left-2/3',
          )}
        >
          <span className="absolute h-5 w-5 rounded-full bg-[#d97757]/15" />
          <span className="relative h-2.5 w-2.5 rounded-full border-2 border-[#fbfaf7] bg-[#d97757] shadow-[0_0_0_1px_rgba(217,119,87,0.25)] dark:border-[#1b1b1b] dark:shadow-[0_0_0_1px_rgba(217,119,87,0.5)]" />
        </span>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-2xl items-center px-8 py-6">
          {step === 0 ? (
            <div className="w-full space-y-8 py-4">
              <section className="flex flex-col items-center gap-4 text-center">
                <div className="relative">
                  <div className="absolute inset-1 rounded-[24px] bg-[#3f8ff7]/25 blur-xl dark:bg-[#5d4bf8]/25" />
                  <img
                    src={appIcon}
                    alt="TP Cowork"
                    draggable={false}
                    className="relative h-20 w-20 rounded-[22px] object-cover shadow-[0_12px_35px_rgba(49,113,224,0.22)] dark:ring-1 dark:ring-white/10 dark:shadow-[0_14px_42px_rgba(0,0,0,0.48)]"
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
          ) : (
            <div className="w-full space-y-7 py-4">
              <section className="flex flex-col items-center gap-2 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#29261b] to-[#5a5141] text-[#fff8ee] shadow-sm">
                  <Sparkles className="h-5 w-5" />
                </div>
                <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#28251d] dark:text-[#f5f1e9]">
                  {t.onboarding.profileTitle}
                </h1>
                <p className="mx-auto max-w-lg text-[13px] leading-6 text-[#777267] dark:text-[#aaa59b]">
                  {t.onboarding.profileHint}
                </p>
              </section>

              <section className="mx-auto w-full max-w-sm space-y-2">
                <ProfileField label={t.onboarding.name}>
                  <input
                    value={answers.name}
                    onChange={(event) => setAnswers((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder={t.onboarding.namePlaceholder}
                    className="h-10 w-full rounded-xl border border-[#dedad1] bg-white/70 px-3 text-[14px] text-[#29261b] outline-none transition-colors focus:border-[#d97757] dark:border-[#43413d] dark:bg-[#242424] dark:text-[#f3f0e8] dark:placeholder:text-[#8f8b83]"
                  />
                </ProfileField>
              </section>

              <section className="mx-auto w-full max-w-sm space-y-2">
                <div className="text-[13px] font-semibold text-[#474238] dark:text-[#d5d0c6]">{t.onboarding.communicationStyle}</div>
                <PillGroup
                  value={answers.communicationStyle}
                  onChange={(value) => setAnswers((prev) => ({ ...prev, communicationStyle: value }))}
                  options={[
                    { value: 'casual', label: t.onboarding.communicationCasual },
                    { value: 'professional', label: t.onboarding.communicationProfessional },
                    { value: 'technical', label: t.onboarding.communicationTechnical },
                  ]}
                />
              </section>

              <section className="mx-auto w-full max-w-sm space-y-2">
                <div className="text-[13px] font-semibold text-[#474238] dark:text-[#d5d0c6]">{t.onboarding.responseLength}</div>
                <PillGroup
                  value={answers.responseLength}
                  onChange={(value) => setAnswers((prev) => ({ ...prev, responseLength: value }))}
                  options={[
                    { value: 'brief', label: t.onboarding.responseBrief },
                    { value: 'detailed', label: t.onboarding.responseDetailed },
                    { value: 'adaptive', label: t.onboarding.responseAdaptive },
                  ]}
                />
              </section>

              <section className="mx-auto w-full max-w-sm space-y-2">
                <div className="text-[13px] font-semibold text-[#474238] dark:text-[#d5d0c6]">{t.onboarding.technicalLevel}</div>
                <PillGroup
                  value={answers.technicalLevel}
                  onChange={(value) => setAnswers((prev) => ({ ...prev, technicalLevel: value }))}
                  options={[
                    { value: 'beginner', label: t.onboarding.levelBeginner },
                    { value: 'intermediate', label: t.onboarding.levelIntermediate },
                    { value: 'expert', label: t.onboarding.levelExpert },
                  ]}
                />
              </section>
            </div>
          )}
        </div>
      </main>

      <footer className="flex h-[68px] shrink-0 items-center justify-between border-t border-[#ded9ce]/80 bg-[#fbfaf7]/80 px-6 backdrop-blur-sm dark:border-[#393734] dark:bg-[#181818]/90">
        {step === 1 ? (
          <button
            type="button"
            onClick={() => setStep(0)}
            className="h-9 rounded-lg border border-[#dedad1] bg-white/55 px-5 text-[14px] font-medium text-[#5f5a50] transition-colors hover:bg-[#f2eee6] dark:border-[#43413d] dark:bg-[#242424] dark:text-[#c8c3b9] dark:hover:bg-[#30302f]"
          >
            {t.onboarding.back}
          </button>
        ) : <span />}
        <button
          type="button"
          onClick={() => {
            if (step === 0) {
              setStep(1);
            } else {
              finish();
            }
          }}
          className="h-9 rounded-lg bg-[#29261b] px-5 text-[14px] font-semibold text-white shadow-sm transition-colors hover:bg-[#423d32] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/35 dark:bg-[#d97757] dark:hover:bg-[#c86c4d]"
        >
          {step === 0 ? t.onboarding.next : t.onboarding.start}
        </button>
      </footer>
    </div>
  );
}
