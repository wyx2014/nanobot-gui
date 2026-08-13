import type { LucideIcon } from 'lucide-react';
import {
  BookOpenCheck,
  ChartNoAxesCombined,
  MailCheck,
  Newspaper,
  NotebookTabs,
  Sunrise,
} from 'lucide-react';
import { useI18n } from '@/i18n';
import { useScheduleStore } from '@/stores/scheduleStore';
import { getAutomationTemplates, type AutomationTemplateIcon } from './automationTemplates';

const templateIcons: Record<AutomationTemplateIcon, LucideIcon> = {
  weeklyReport: NotebookTabs,
  morningBrief: Sunrise,
  news: Newspaper,
  monthlyReview: ChartNoAxesCombined,
  knowledge: BookOpenCheck,
  mail: MailCheck,
};

export default function ScheduleTemplateGallery() {
  const { t, locale } = useI18n();
  const openEditor = useScheduleStore((state) => state.openEditor);
  const templates = getAutomationTemplates(locale);

  return (
    <section data-automation-templates aria-labelledby="automation-template-title">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 id="automation-template-title" className="text-[17px] font-semibold tracking-[-0.01em] text-[#29261b] dark:text-[#eeeae2]">
            {t.schedule.templateTitle}
          </h2>
          <p className="mt-0.5 text-[12px] text-[#777267] dark:text-[#9d9990]">
            {t.schedule.templateHint}
          </p>
        </div>
        <span className="shrink-0 text-[11px] text-[#9a968c] dark:text-[#77736c]">
          {t.schedule.templateCount.replace('{count}', String(templates.length))}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 min-[760px]:grid-cols-2 min-[1180px]:grid-cols-3">
        {templates.map((template) => {
          const Icon = templateIcons[template.icon];
          return (
            <button
              key={template.id}
              type="button"
              data-automation-template={template.id}
              onClick={() => openEditor(undefined, template.draft)}
              className="group flex min-h-[96px] items-center gap-4 rounded-2xl border border-[#ebe7df]/90 bg-white px-5 py-4 text-left shadow-[0_8px_24px_rgba(50,43,33,0.035)] transition-all hover:-translate-y-0.5 hover:border-[#d9d3c9] hover:shadow-[0_12px_32px_rgba(50,43,33,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d97757]/35 dark:border-white/10 dark:bg-[#242424] dark:shadow-none dark:hover:border-white/20 dark:hover:bg-[#292929]"
              title={t.schedule.useTemplate}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f5f2ec] text-[#36332d] transition-colors group-hover:bg-[#efe9df] group-hover:text-[#d97757] dark:bg-[#30302e] dark:text-[#d8d3ca] dark:group-hover:bg-[#38332f] dark:group-hover:text-[#e49375]">
                <Icon className="h-[21px] w-[21px]" strokeWidth={1.75} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold text-[#29261b] dark:text-[#eeeae2]">
                  {template.draft.name}
                </span>
                <span className="mt-1 block line-clamp-2 text-[12px] leading-5 text-[#777267] dark:text-[#aaa69d]">
                  {template.draft.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
