import { useState, useEffect } from 'react';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useI18n } from '@/i18n';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import type { ScheduleFrequency, ScheduleConfig } from '@/types/schedule';
import WindowModalBackdrop from '@/components/common/WindowModalBackdrop';
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
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const workspaceOptions = projects
    .filter((project) => project.kind === 'workspace' && project.status === 'active' && Boolean(project.rootPath))
    .map((project) => ({
      value: project.rootPath,
      label: `${project.name || project.rootPath} · ${project.rootPath}`,
    }));
  const selectedWorkspacePath = workspaceOptions.some((option) => option.value === workspacePath)
    ? workspacePath
    : '';

  // Initialize form when editing task changes
  useEffect(() => {
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

    if (editingTask) {
      setName(editingTask.name);
      setDescription(editingTask.description ?? '');
      setPrompt(editingTask.prompt);
      initializeSchedule(editingTask.schedule);
      setSkillName(editingTask.skillName ?? '');
      setWorkspacePath(editingTask.workspacePath ?? '');
    } else {
      setName(editorDraft?.name ?? '');
      setDescription(editorDraft?.description ?? '');
      setPrompt(editorDraft?.prompt ?? '');
      initializeSchedule(editorDraft?.schedule);
      setSkillName(editorDraft?.skillName ?? '');
      setWorkspacePath(editorDraft?.workspacePath ?? '');
    }
    setSaveError(null);
  }, [editingTask, editorDraft, showEditor]);

  // Close on Escape key
  useEffect(() => {
    if (!showEditor) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeEditor();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showEditor, closeEditor]);

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
        });
      } else {
        await createTask({
          name: name.trim(),
          description: description.trim() || undefined,
          prompt: prompt.trim(),
          schedule,
          skillName: skillName || undefined,
          workspacePath: workspacePath || undefined,
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
    <div data-schedule-editor-overlay className="window-modal-viewport fixed inset-0 z-50 flex items-center justify-center">
      <WindowModalBackdrop />
      <div data-schedule-editor className="relative flex max-h-[85vh] w-[480px] flex-col rounded-2xl border border-black/5 bg-white shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 shrink-0">
          <h2 className="text-[16px] font-semibold text-[#29261b]">
            {editingTaskId ? t.schedule.editTask : t.schedule.newTask}
          </h2>
          <button
            onClick={closeEditor}
            aria-label={t.common.close}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <div className="px-6 py-4 space-y-4 overflow-auto flex-1">
          {/* Task name */}
          <div>
            <label className="block text-[13px] font-medium text-[#29261b] mb-1.5">
              {t.schedule.taskName}
            </label>
            <input
              name="schedule-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.schedule.taskNamePlaceholder}
              className="w-full h-10 px-3 bg-white border border-[#e8e4dd] rounded-lg text-sm text-[#29261b] focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757]"
            />
          </div>

          {/* Task description */}
          <div>
            <label className="block text-[13px] font-medium text-[#29261b] mb-1.5">
              {t.schedule.description}
            </label>
            <textarea
              name="schedule-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t.schedule.descriptionPlaceholder}
              rows={2}
              className="w-full px-3 py-2 bg-white border border-[#e8e4dd] rounded-lg text-sm text-[#29261b] focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757] resize-none"
            />
          </div>

          {/* Task prompt */}
          <div>
            <label className="block text-[13px] font-medium text-[#29261b] mb-1.5">
              {t.schedule.taskPrompt}
            </label>
            <textarea
              name="schedule-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t.schedule.taskPromptPlaceholder}
              rows={4}
              className="w-full px-3 py-2 bg-white border border-[#e8e4dd] rounded-lg text-sm text-[#29261b] focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757] resize-none"
            />
          </div>

          {/* Frequency selector */}
          <div>
            <label className="block text-[13px] font-medium text-[#29261b] mb-1.5">
              {t.schedule.frequency}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {frequency === 'custom' && (
                <span className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-[#d97757] text-white">
                  {frequencyLabels.custom}
                </span>
              )}
              {FREQUENCIES.map((freq) => (
                <button
                  key={freq}
                  onClick={() => setFrequency(freq)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors',
                    frequency === freq
                      ? 'bg-[#d97757] text-white'
                      : 'bg-[#f5f3ee] text-[#3d3929] hover:bg-[#e8e5de]'
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
              <label className="block text-[13px] font-medium text-[#29261b] mb-1.5">
                {t.schedule.executionDate}
              </label>
              <input
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
              <label className="block text-[13px] font-medium text-[#29261b] mb-1.5">
                {frequency === 'hourly' ? t.schedule.minuteOfHour : t.schedule.executionTime}
              </label>
              <div className="flex items-center gap-2">
                {showHourSelector && (
                  <>
                    <Select
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
              <label className="block text-[13px] font-medium text-[#29261b] mb-1.5">
                {t.schedule.dayOfWeek}
              </label>
              <div className="flex flex-wrap gap-1.5">
                {dayLabels.map((label, idx) => (
                  <button
                    key={idx}
                    onClick={() => setDayOfWeek(idx)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors',
                      dayOfWeek === idx
                        ? 'bg-[#d97757] text-white'
                        : 'bg-[#f5f3ee] text-[#3d3929] hover:bg-[#e8e5de]'
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
              <label className="block text-[13px] font-medium text-[#29261b] mb-1.5">
                {t.schedule.dayOfMonth}
              </label>
              <Select
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

          {/* Skill binding */}
          {skills.length > 0 && (
            <div>
              <label className="block text-[13px] font-medium text-[#29261b] mb-1.5">
                {t.schedule.bindSkill}
              </label>
              <Select
                value={skillName}
                onChange={setSkillName}
                placeholder={t.schedule.bindSkillNone}
                options={[
                  { value: '', label: t.schedule.bindSkillNone },
                  ...skills
                    .filter((s) => s.userInvocable)
                    .map((s) => ({ value: s.name, label: s.name })),
                ]}
              />
            </div>
          )}

          {/* Workspace path */}
          <div>
            <label className="block text-[13px] font-medium text-[#29261b] mb-1.5">
              {t.schedule.workspacePath}
            </label>
            {workspaceOptions.length > 0 ? (
              <div className="mb-2">
                <Select
                  value={selectedWorkspacePath}
                  onChange={setWorkspacePath}
                  placeholder={isEnglish ? 'Select an existing workspace' : '选择已有工作空间'}
                  options={[
                    { value: '', label: isEnglish ? 'No workspace selected' : '不指定工作空间' },
                    ...workspaceOptions,
                  ]}
                />
              </div>
            ) : null}
            <input
              name="schedule-workspace"
              type="text"
              value={workspacePath}
              onChange={(e) => setWorkspacePath(e.target.value)}
              placeholder={workspaceOptions.length > 0
                ? (isEnglish ? 'Or enter a custom path' : '或手动输入自定义路径')
                : t.schedule.workspacePathPlaceholder}
              className="w-full h-10 px-3 bg-white border border-[#e8e4dd] rounded-lg text-sm text-[#29261b] focus:outline-none focus:ring-2 focus:ring-[#d97757]/30 focus:border-[#d97757]"
            />
          </div>

          {saveError && (
            <div role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[12px] text-red-600">
              {saveError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-neutral-100 shrink-0">
          <button
            onClick={closeEditor}
            className="px-4 py-2 rounded-lg text-[13px] text-[#3d3929] hover:bg-[#f5f3ee] transition-colors"
          >
            {t.common.cancel}
          </button>
          <button
            onClick={handleSave}
            data-schedule-editor-save
            disabled={isSaving || !name.trim() || !prompt.trim()}
            className={cn(
              'px-4 py-2 rounded-lg text-[13px] font-medium transition-colors',
              !isSaving && name.trim() && prompt.trim()
                ? 'bg-[#d97757] text-white hover:bg-[#c8664a]'
                : 'bg-[#e8e4dd] text-[#656358] cursor-not-allowed'
            )}
          >
            {isSaving ? t.common.loading : t.common.save}
          </button>
        </div>
      </div>
    </div>
  );
}
