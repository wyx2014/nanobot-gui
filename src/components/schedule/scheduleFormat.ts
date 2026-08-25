import type { SupportedLocale, TranslationDict } from '@/i18n';
import type { ScheduleConfig, ScheduleFrequency } from '@/types/schedule';

export function getScheduleFrequencyLabel(
  frequency: ScheduleFrequency,
  t: TranslationDict,
): string {
  const labels: Record<ScheduleFrequency, string> = {
    once: t.schedule.frequencyOnce,
    hourly: t.schedule.frequencyHourly,
    daily: t.schedule.frequencyDaily,
    weekly: t.schedule.frequencyWeekly,
    monthly: t.schedule.frequencyMonthly,
    weekdays: t.schedule.frequencyWeekdays,
    custom: t.schedule.frequencyCustom,
    manual: t.schedule.frequencyManual,
  };
  return labels[frequency];
}

function formatInterval(milliseconds: number, locale: SupportedLocale): string {
  const units = [
    { milliseconds: 86_400_000, zh: '天', en: 'day' },
    { milliseconds: 3_600_000, zh: '小时', en: 'hour' },
    { milliseconds: 60_000, zh: '分钟', en: 'minute' },
    { milliseconds: 1_000, zh: '秒', en: 'second' },
  ];
  const unit = units.find((item) => milliseconds % item.milliseconds === 0);
  if (!unit) return `${milliseconds} ms`;

  const value = milliseconds / unit.milliseconds;
  if (locale === 'zh-CN') return `${value} ${unit.zh}`;
  return `${value} ${unit.en}${value === 1 ? '' : 's'}`;
}

function timezoneSuffix(schedule: ScheduleConfig): string {
  return schedule.timezone ? ` · ${schedule.timezone}` : '';
}

export function getScheduleDescription(
  schedule: ScheduleConfig,
  t: TranslationDict,
  locale: SupportedLocale,
): string {
  const frequency = getScheduleFrequencyLabel(schedule.frequency, t);

  if (schedule.frequency === 'once' && schedule.at) {
    const date = new Date(schedule.at);
    if (!Number.isNaN(date.getTime())) {
      try {
        const formatted = new Intl.DateTimeFormat(locale, {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
          timeZone: schedule.timezone,
        }).format(date);
        return `${frequency} · ${formatted}${timezoneSuffix(schedule)}`;
      } catch {
        return `${frequency} · ${date.toLocaleString(locale)}`;
      }
    }
  }

  if (schedule.frequency === 'custom') {
    if (schedule.cronExpression) {
      return `${t.schedule.customCron.replace('{expression}', schedule.cronExpression)}${timezoneSuffix(schedule)}`;
    }
    if (schedule.everyMs && schedule.everyMs > 0) {
      return t.schedule.customEvery.replace('{duration}', formatInterval(schedule.everyMs, locale));
    }
    return frequency;
  }

  const time = schedule.time;
  if (!time) return frequency;

  if (schedule.frequency === 'hourly') {
    return `${frequency} :${time.minute.toString().padStart(2, '0')}${timezoneSuffix(schedule)}`;
  }

  const timeText = `${time.hour.toString().padStart(2, '0')}:${time.minute.toString().padStart(2, '0')}`;
  if (schedule.frequency === 'weekly') {
    const days = [
      t.schedule.sunday,
      t.schedule.monday,
      t.schedule.tuesday,
      t.schedule.wednesday,
      t.schedule.thursday,
      t.schedule.friday,
      t.schedule.saturday,
    ];
    return `${frequency} ${days[schedule.dayOfWeek ?? 1]} ${timeText}${timezoneSuffix(schedule)}`;
  }

  if (schedule.frequency === 'monthly') {
    const monthDay = t.schedule.monthDay.replace('{day}', String(schedule.dayOfMonth ?? 1));
    return `${frequency} ${monthDay} ${timeText}${timezoneSuffix(schedule)}`;
  }

  return `${frequency} ${timeText}${timezoneSuffix(schedule)}`;
}
