import { useState, useEffect } from 'react';
import { useScheduleStore } from '@/stores/scheduleStore';
import { useDiscoveryStore } from '@/stores/discoveryStore';
import { useI18n } from '@/i18n';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import type { ScheduleFrequency, ScheduleConfig } from '@/types/schedule';
import WindowModalBackdrop from '@/components/common/WindowModalBackdrop';

const FREQUENCIES: ScheduleFrequency[] = ['hourly', 'daily', 'weekly', 'monthly', 'weekdays', 'manual'];

export default function ScheduleEditor() {
  const { t } = useI18n();
  const { showEditor, editingTaskId, editorDraft, closeEditor, createTask, updateTask, tasks } =
    useScheduleStore();
  const skills = useDiscoveryStore((s) => s.skills);

  const editingTask = editingTaskId ? tasks[editingTaskId] : null;

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [frequency, setFrequency] = useState<ScheduleFrequency>('daily');
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [skillName, setSkillName] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Initialize form when editing task changes
  useEffect(() => {
    if (editingTask) {
      setName(editingTask.name);
      setDescription(editingTask.description ?? '');
      setPrompt(editingTask.prompt);
      setFrequency(editingTask.schedule.frequency);
      setHour(editingTask.schedule.time?.hour ?? 9);
      setMinute(editingTask.schedule.time?.minute ?? 0);
      setDayOfWeek(editingTask.schedule.dayOfWeek ?? 1);
      setDayOfMonth(editingTask.schedule.dayOfMonth ?? 1);
      setSkillName(editingTask.skillName ?? '');
      setWorkspacePath(editingTask.workspacePath ?? '');
    } else {
      setName(editorDraft?.name ?? '');
      setDescription(editorDraft?.description ?? '');
      setPrompt(editorDraft?.prompt ?? '');
      setFrequency(editorDraft?.schedule.frequency ?? 'daily');
      setHour(editorDraft?.schedule.time?.hour ?? 9);
      setMinute(editorDraft?.schedule.time?.minute ?? 0);
      setDayOfWeek(editorDraft?.schedule.dayOfWeek ?? 1);
      setDayOfMonth(editorDraft?.schedule.dayOfMonth ?? 1);
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
    hourly: t.schedule.frequencyHourly,
    daily: t.schedule.frequencyDaily,
    weekly: t.schedule.frequencyWeekly,
    monthly: t.schedule.frequencyMonthly,
    weekdays: t.schedule.frequencyWeekdays,
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

  const showTimeSelector = frequency !== 'manual';
  const showHourSelector = frequency !== 'hourly';
  const showDaySelector = frequency === 'weekly';
  const showMonthDaySelector = frequency === 'monthly';

  const handleSave = async () => {
    if (!name.trim() || !prompt.trim()) return;

    const schedule: ScheduleConfig = {
      frequency,
      time: frequency !== 'manual' ? { hour, minute } : undefined,
      dayOfWeek: frequency === 'weekly' ? dayOfWeek : undefined,
      dayOfMonth: frequency === 'monthly' ? dayOfMonth : undefined,
    };

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
    <div data-schedule-editor-overlay className="fixed inset-0 z-50 flex items-center justify-center animate-in fade-in duration-150">
      <WindowModalBackdrop />
      <div data-schedule-editor className="relative bg-white rounded-2xl shadow-xl w-[480px] max-h-[85vh] flex flex-col">
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
            <input
              name="schedule-workspace"
              type="text"
              value={workspacePath}
              onChange={(e) => setWorkspacePath(e.target.value)}
              placeholder={t.schedule.workspacePathPlaceholder}
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
