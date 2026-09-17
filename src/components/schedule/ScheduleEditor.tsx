import { useState, useEffect, useRef } from 'react';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useI18n } from '@/i18n';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { fetchMcpPresets } from '@/core/api';
import { getNanobotStatus, getNanobotToken, refreshNanobotAuth } from '@/core/nanobotClient';
import type { McpPresetInfo } from '@/core/types';
import { projectNameFromPath } from '@/core/workspace';
import { MCP_PRESETS_CHANGED_EVENT, installedMcpPresetsFromPayload, isMcpPresetsPayload } from '@/lib/mcp-preset-events';
import type { ScheduleFrequency, ScheduleConfig } from '@/types/schedule';
import { getScheduleDescription } from './scheduleFormat';

const FREQUENCIES: Exclude<ScheduleFrequency, 'custom'>[] = [
  'once',
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'weekdays',
  'manual',
];

function toLocalDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultOnceDate(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return toLocalDateValue(tomorrow);
}

function parseOnceDate(at: string | undefined): Date | null {
  if (!at) return null;
  const parsed = new Date(at);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export default function ScheduleEditor() {
  const { t, locale } = useI18n();
  const { showEditor, editingTaskId, editorDraft, closeEditor, createTask, updateTask, tasks } =
    useScheduleStore();
  const skills = useDiscoveryStore((s) => s.skills);
  const projects = useWorkspaceStore((s) => s.projects);
  const isEnglish = locale === 'en-US';

  const editingTask = editingTaskId ? tasks[editingTaskId] : null;

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [frequency, setFrequency] = useState<ScheduleFrequency>('once');
  const [onceDate, setOnceDate] = useState(defaultOnceDate);
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [skillName, setSkillName] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [connectorNames, setConnectorNames] = useState<string[]>([]);
  const [connectors, setConnectors] = useState<McpPresetInfo[]>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(false);
  const [connectorsLoadFailed, setConnectorsLoadFailed] = useState(false);
  const [connectorRefreshKey, setConnectorRefreshKey] = useState(0);
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const workspacePickerPortal = useRef<HTMLDivElement>(null);
  const workspaceOptions = projects
    .filter((project) => project.kind === 'workspace' && project.status === 'active' && Boolean(project.rootPath))
    .map((project) => ({
      value: project.rootPath,
      label: project.name || projectNameFromPath(project.rootPath),
    }));
  if (workspacePath && !workspaceOptions.some((option) => option.value === workspacePath)) {
    workspaceOptions.push({ value: workspacePath, label: t.schedule.workspaceUnavailable });
  }

  useEffect(() => {
    if (!showEditor) return;
    let cancelled = false;
    const applyConnectors = (items: McpPresetInfo[]) => {
      if (!cancelled) setConnectors(items.filter((preset) => preset.available));
    };
    const loadConnectors = async () => {
      setConnectorsLoading(true);
      setConnectorsLoadFailed(false);
      try {
        const status = await getNanobotStatus();
        let token = getNanobotToken();
        let base = `http://127.0.0.1:${status.port}`;
        if (!token) {
          const refreshed = await refreshNanobotAuth();
          token = refreshed.token;
          base = refreshed.baseUrl;
        }
        const payload = await fetchMcpPresets(token, base);
        applyConnectors(installedMcpPresetsFromPayload(payload));
      } catch {
        if (!cancelled) setConnectorsLoadFailed(true);
      } finally {
        if (!cancelled) setConnectorsLoading(false);
      }
    };
    const handleChange = (event: Event) => {
      const payload = (event as CustomEvent<unknown>).detail;
      if (isMcpPresetsPayload(payload)) {
        applyConnectors(installedMcpPresetsFromPayload(payload));
      } else {
        void loadConnectors();
      }
    };
    void loadConnectors();
    window.addEventListener(MCP_PRESETS_CHANGED_EVENT, handleChange);
    return () => {
      cancelled = true;
      window.removeEventListener(MCP_PRESETS_CHANGED_EVENT, handleChange);
    };
  }, [showEditor, connectorRefreshKey]);

  // Initialize form when editing task changes
  useEffect(() => {
    if (!showEditor) return;
    const initialTask = editingTaskId ? useScheduleStore.getState().tasks[editingTaskId] : null;
    const initializeSchedule = (schedule: ScheduleConfig | undefined) => {
      const nextFrequency = schedule?.frequency ?? 'once';
      const once = nextFrequency === 'once' ? parseOnceDate(schedule?.at) : null;
      setFrequency(nextFrequency);
      setOnceDate(once ? toLocalDateValue(once) : defaultOnceDate());
      setHour(once ? once.getHours() : (schedule?.time?.hour ?? 9));
      setMinute(once ? once.getMinutes() : (schedule?.time?.minute ?? 0));
      setDayOfWeek(schedule?.dayOfWeek ?? 1);
      setDayOfMonth(schedule?.dayOfMonth ?? 1);
    };

    if (initialTask) {
      setName(initialTask.name);
      setDescription(initialTask.description ?? '');
      setPrompt(initialTask.prompt);
      initializeSchedule(initialTask.schedule);
      setSkillName(initialTask.skillName ?? '');
      setWorkspacePath(initialTask.workspacePath ?? '');
      setConnectorNames(initialTask.mcpPresets?.map((preset) => preset.name) ?? []);
    } else {
      setName(editorDraft?.name ?? '');
      setDescription(editorDraft?.description ?? '');
      setPrompt(editorDraft?.prompt ?? '');
      initializeSchedule(editorDraft?.schedule);
      setSkillName(editorDraft?.skillName ?? '');
      setWorkspacePath(editorDraft?.workspacePath ?? '');
      setConnectorNames(editorDraft?.mcpPresets?.map((preset) => preset.name) ?? []);
    }
    setSaveError(null);
  }, [editingTaskId, editorDraft, showEditor]);

  if (!showEditor) return null;

  const frequencyLabels: Record<ScheduleFrequency, string> = {
    once: t.schedule.frequencyOnce,
    hourly: t.schedule.frequencyHourly,
    daily: t.schedule.frequencyDaily,
    weekly: t.schedule.frequencyWeekly,
    monthly: t.schedule.frequencyMonthly,
    weekdays: t.schedule.frequencyWeekdays,
    custom: t.schedule.frequencyCustom,
    manual: t.schedule.frequencyManual,
  };

  const dayLabels = [
    t.schedule.sunday,
    t.schedule.monday,
    t.schedule.tuesday,
    t.schedule.wednesday,
    t.schedule.thursday,
    t.schedule.friday,
    t.schedule.saturday,
  ];

  const sourceSchedule = editingTask?.schedule ?? editorDraft?.schedule;
  const showTimeSelector = frequency !== 'manual' && frequency !== 'custom';
  const showHourSelector = frequency !== 'hourly';
  const showDateSelector = frequency === 'once';
  const showDaySelector = frequency === 'weekly';
  const showMonthDaySelector = frequency === 'monthly';
  const unavailableConnectors = connectorNames.filter((name) => !connectors.some((preset) => preset.name === name));

  const toggleConnector = (name: string) => {
    setConnectorNames((current) => current.includes(name)
      ? current.filter((item) => item !== name)
      : current.length < 8 ? [...current, name] : current);
  };

  const handleSave = async () => {
    if (!name.trim() || !prompt.trim()) return;

    let schedule: ScheduleConfig;
    if (frequency === 'once') {
      const [year, month, day] = onceDate.split('-').map(Number);
      const at = new Date(year, month - 1, day, hour, minute, 0, 0);
      if (
        !onceDate
        || !year
        || !month
        || !day
        || Number.isNaN(at.getTime())
        || at.getTime() <= Date.now()
      ) {
        setSaveError(t.schedule.onceTimePast);
        return;
      }
      schedule = {
        frequency: 'once',
        at: at.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    } else if (frequency === 'custom') {
      schedule = { ...(sourceSchedule ?? { frequency: 'custom' }), frequency: 'custom' };
    } else {
      schedule = {
        frequency,
        time: frequency !== 'manual' ? { hour, minute } : undefined,
        dayOfWeek: frequency === 'weekly' ? dayOfWeek : undefined,
        dayOfMonth: frequency === 'monthly' ? dayOfMonth : undefined,
      };
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      if (editingTaskId) {
        await updateTask(editingTaskId, {
          name: name.trim(),
          description: description.trim() || undefined,
          prompt: prompt.trim(),
          schedule,
          skillName: skillName || undefined,
          workspacePath: workspacePath || undefined,
          mcpPresets: connectorNames.map((connector) => ({ name: connector })),
        });
      } else {
        await createTask({
          name: name.trim(),
          description: description.trim() || undefined,
          prompt: prompt.trim(),
          schedule,
          skillName: skillName || undefined,
          workspacePath: workspacePath || undefined,
          mcpPresets: connectorNames.map((connector) => ({ name: connector })),
        });
      }
      closeEditor();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div data-schedule-editor className="flex min-h-0 flex-1 flex-col bg-[#fbfaf7] dark:bg-[#191919]">
      <header className="flex min-h-[64px] shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#ebe7df] bg-[#fbfaf7] px-5 py-3 dark:border-white/10 dark:bg-[#1b1b1b] sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={closeEditor} disabled={isSaving} aria-label={t.schedule.backToList} className="grid size-8 shrink-0 place-items-center rounded-lg text-[#656358] hover:bg-[#f0eeea] disabled:opacity-40 dark:text-[#aaa69d] dark:hover:bg-white/10">
            <ArrowLeft className="size-4" />
          </button>
          <h1 className="truncate text-[17px] font-semibold text-[#29261b] dark:text-[#eeeae2]">
            {editingTaskId ? t.schedule.editTask : t.schedule.addAutomation}
          </h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={closeEditor} disabled={isSaving} className="rounded-lg px-3 py-2 text-[13px] text-[#656358] hover:bg-[#f0eeea] disabled:opacity-40 dark:text-[#c8c3ba] dark:hover:bg-white/10">
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={handleSave}
            data-schedule-editor-save
            disabled={isSaving || !name.trim() || !prompt.trim()}
            className="rounded-lg bg-[#292722] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#171613] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[#d97757] dark:hover:bg-[#e18463]"
          >
            {isSaving ? t.common.loading : t.common.save}
          </button>
        </div>
      </header>

      {saveError && (
        <div role="alert" className="shrink-0 border-b border-red-200 bg-red-50 px-8 py-2 text-[12px] text-red-700 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-300">
          {saveError}
        </div>
      )}

      <div data-schedule-editor-scroll data-workspace-picker-open={workspacePickerOpen || undefined} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto grid w-full max-w-[1140px] gap-8 px-5 py-7 sm:px-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.85fr)] lg:gap-12 lg:py-9">
          <div className="min-w-0 space-y-6">
            <div>
              <label htmlFor="schedule-name" className="mb-2 block text-[13px] font-medium">{t.schedule.taskName}</label>
              <Input id="schedule-name" name="schedule-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.schedule.taskNamePlaceholder} className="h-11 text-[14px]" />
            </div>
            <div>
              <label htmlFor="schedule-prompt" className="mb-2 block text-[13px] font-medium">{t.schedule.taskPrompt}</label>
              <Textarea id="schedule-prompt" name="schedule-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t.schedule.taskPromptPlaceholder} rows={13} className="min-h-[300px] px-4 py-3 text-[14px] leading-6" />
            </div>
            <div>
              <label htmlFor="schedule-description" className="mb-2 block text-[13px] font-medium">{t.schedule.description}</label>
              <Textarea id="schedule-description" name="schedule-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t.schedule.descriptionPlaceholder} rows={2} className="min-h-[72px]" />
            </div>
          </div>

          <aside className="min-w-0 space-y-7 lg:border-l lg:border-[#e8e4dd] lg:pl-8 dark:lg:border-white/10">
            <section className="space-y-4">
              <h2 className="text-[14px] font-semibold">{t.schedule.schedule}</h2>
              <div>
                <div id="schedule-frequency-label" className="mb-2 text-[13px] font-medium">{t.schedule.frequency}</div>
                <div role="group" aria-labelledby="schedule-frequency-label" className="flex flex-wrap gap-1.5">
              {frequency === 'custom' && (
                <span className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#d97757] text-white">
                  {frequencyLabels.custom}
                </span>
              )}
              {FREQUENCIES.map((freq) => (
                <button
                  type="button"
                  key={freq}
                  aria-pressed={frequency === freq}
                  onClick={() => setFrequency(freq)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors',
                    frequency === freq
                      ? 'bg-[#d97757] text-white'
                      : 'bg-[#f0eeea] text-[#3d3929] hover:bg-[#e8e5de] dark:bg-[#292929] dark:text-[#d5d0c7] dark:hover:bg-[#333333]'
                  )}
                >
                  {frequencyLabels[freq]}
                </button>
              ))}
            </div>
          </div>

          {/* One-time date selector */}
          {showDateSelector && (
            <div data-schedule-once-date>
              <label htmlFor="schedule-date" className="mb-1.5 block text-[13px] font-medium">
                {t.schedule.executionDate}
              </label>
              <input
                id="schedule-date"
                name="schedule-date"
                type="date"
                min={toLocalDateValue(new Date())}
                value={onceDate}
                onChange={(event) => setOnceDate(event.target.value)}
                className="h-10 w-full rounded-lg border border-[#e8e4dd] bg-white px-3 text-sm text-[#29261b] focus:border-[#d97757] focus:outline-none focus:ring-2 focus:ring-[#d97757]/30"
              />
              <p className="mt-1.5 text-[11px] text-[#8a867c]">{t.schedule.onceHint}</p>
            </div>
          )}

          {/* Canonical custom schedule */}
          {frequency === 'custom' && sourceSchedule && (
            <div data-schedule-custom className="rounded-lg border border-[#e8e4dd] bg-[#faf8f5] px-3 py-2.5">
              <div className="text-[12px] font-medium text-[#3d3929]">
                {getScheduleDescription(sourceSchedule, t, locale)}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-[#8a867c]">
                {t.schedule.customScheduleHint}
              </p>
            </div>
          )}

          {/* Time selector */}
          {showTimeSelector && (
            <div>
              <div className="mb-1.5 text-[13px] font-medium">
                {frequency === 'hourly' ? t.schedule.minuteOfHour : t.schedule.executionTime}
              </div>
              <div className="flex items-center gap-2">
                {showHourSelector && (
                  <>
                    <Select
                      ariaLabel={isEnglish ? 'Hour' : '小时'}
                      value={String(hour)}
                      onChange={(v) => setHour(Number(v))}
                      options={Array.from({ length: 24 }, (_, i) => ({
                        value: String(i),
                        label: i.toString().padStart(2, '0'),
                      }))}
                      className="w-20"
                    />
                    <span className="text-[#656358]">:</span>
                  </>
                )}
                <Select
                  ariaLabel={frequency === 'hourly' ? t.schedule.minuteOfHour : (isEnglish ? 'Minute' : '分钟')}
                  value={String(minute)}
                  onChange={(v) => setMinute(Number(v))}
                  options={Array.from({ length: 60 }, (_, i) => ({
                    value: String(i),
                    label: i.toString().padStart(2, '0'),
                  }))}
                  className="w-20"
                />
              </div>
            </div>
          )}

          {/* Day of week selector */}
          {showDaySelector && (
            <div>
              <div className="mb-1.5 text-[13px] font-medium">
                {t.schedule.dayOfWeek}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {dayLabels.map((label, idx) => (
                  <button
                    type="button"
                    key={idx}
                    aria-pressed={dayOfWeek === idx}
                    onClick={() => setDayOfWeek(idx)}
                    className={cn(
                    'px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors',
                    dayOfWeek === idx
                      ? 'bg-[#d97757] text-white'
                      : 'bg-[#f0eeea] text-[#3d3929] hover:bg-[#e8e5de] dark:bg-[#292929] dark:text-[#d5d0c7] dark:hover:bg-[#333333]'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Day of month selector */}
          {showMonthDaySelector && (
            <div data-schedule-month-day>
              <div className="mb-1.5 text-[13px] font-medium">
                {t.schedule.dayOfMonth}
              </div>
              <Select
                ariaLabel={t.schedule.dayOfMonth}
                value={String(dayOfMonth)}
                onChange={(value) => setDayOfMonth(Number(value))}
                options={Array.from({ length: 31 }, (_, index) => ({
                  value: String(index + 1),
                  label: t.schedule.monthDay.replace('{day}', String(index + 1)),
                }))}
                className="w-32"
              />
              {dayOfMonth > 28 && (
                <p className="mt-1.5 text-[11px] text-[#8a867c]">
                  {t.schedule.monthDayHint}
                </p>
              )}
            </div>
          )}
            </section>

            <section className="border-t border-[#e8e4dd] pt-6 dark:border-white/10">
              <h2 className="mb-3 text-[14px] font-semibold">{t.schedule.workspacePath}</h2>
              <Select
                ariaLabel={t.schedule.workspacePath}
                value={workspacePath}
                onChange={setWorkspacePath}
                placeholder={t.schedule.selectWorkspace}
                options={[
                  { value: '', label: t.schedule.noWorkspace },
                  ...workspaceOptions,
                ]}
                searchPlaceholder={t.schedule.searchWorkspaces}
                emptySearchLabel={t.schedule.noMatchingWorkspaces}
                portalled
                portalLayer={60}
                portalContainer={() => workspacePickerPortal.current}
                onOpenChange={setWorkspacePickerOpen}
              />
              {workspaceOptions.length === 0 && <p className="mt-2 text-[12px] text-[#777267] dark:text-[#aaa69d]">{t.schedule.noWorkspaces}</p>}
            </section>

            {skills.some((skill) => skill.userInvocable) && (
              <section className="border-t border-[#e8e4dd] pt-6 dark:border-white/10">
                <h2 className="mb-3 text-[14px] font-semibold">{t.schedule.bindSkill}</h2>
                <Select
                  ariaLabel={t.schedule.bindSkill}
                  value={skillName}
                  onChange={setSkillName}
                  options={[
                    { value: '', label: t.schedule.bindSkillNone },
                    ...skills.filter((skill) => skill.userInvocable).map((skill) => ({ value: skill.name, label: skill.name })),
                  ]}
                />
              </section>
            )}

            <section className="border-t border-[#e8e4dd] pt-6 dark:border-white/10">
              <h2 className="mb-3 text-[14px] font-semibold">{t.schedule.bindConnectors}</h2>
              {connectorsLoadFailed && (
                <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-[#777267] dark:text-[#aaa69d]">
                  <span>{t.schedule.connectorsLoadFailed}</span>
                  <button type="button" onClick={() => setConnectorRefreshKey((key) => key + 1)} className="font-medium text-[#d97757] hover:underline">{t.schedule.retry}</button>
                </div>
              )}
              {connectorsLoading && connectors.length === 0 ? (
                <span role="status" className="inline-flex items-center gap-2 text-[12px] text-[#777267]"><Loader2 className="size-3.5 animate-spin" />{t.common.loading}</span>
              ) : connectors.length === 0 && unavailableConnectors.length === 0 ? (
                !connectorsLoadFailed && <p className="text-[12px] text-[#777267] dark:text-[#aaa69d]">{t.schedule.noConnectors}</p>
              ) : (
                <div data-schedule-connectors className="max-h-52 overflow-y-auto border-y border-[#e8e4dd] dark:border-white/10">
                  {connectors.map((connector) => (
                    <label key={connector.name} className="flex min-h-10 cursor-pointer items-center gap-2 border-b border-[#e8e4dd] py-2 text-[13px] last:border-0 dark:border-white/10">
                      <input type="checkbox" checked={connectorNames.includes(connector.name)} disabled={connectorNames.length >= 8 && !connectorNames.includes(connector.name)} onChange={() => toggleConnector(connector.name)} className="size-4 shrink-0 accent-[#d97757]" />
                      <span className="min-w-0 truncate" title={connector.display_name}>{connector.display_name || connector.name}</span>
                    </label>
                  ))}
                  {unavailableConnectors.map((connector) => (
                    <label key={connector} className="flex min-h-10 cursor-pointer items-center gap-2 border-b border-[#e8e4dd] py-2 text-[13px] last:border-0 dark:border-white/10">
                      <input type="checkbox" checked onChange={() => toggleConnector(connector)} className="size-4 shrink-0 accent-[#d97757]" />
                      <span className="min-w-0 truncate">{connector} ({connectorsLoadFailed ? t.schedule.connectorUnverified : t.schedule.connectorUnavailable})</span>
                    </label>
                  ))}
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>
      <div ref={workspacePickerPortal} className="contents" />
    </div>
  );
}
