import { FilePlus2, RotateCcw } from 'lucide-react';
import type { TurnPlanResource } from '@/core/types';
import { researchRevisionSource } from '@/core/nanobot/revisionViewModel';
import { useI18n } from '@/i18n';
import type { RevisionAction } from './ExpertTeamRevisionDialog';

export function RoleRevisionActions({
  runId, roleId, roleTitle, disabled, onReviseRole,
}: {
  runId: string;
  roleId: string;
  roleTitle: string;
  disabled?: boolean;
  onReviseRole: RevisionAction;
}) {
  const { locale } = useI18n();
  const supplement = locale.startsWith('zh') ? '补充资料' : 'Add materials';
  const retry = locale.startsWith('zh') ? '仅重试该角色' : 'Retry this role';
  const buttonClass = 'inline-flex min-h-7 shrink-0 items-center justify-center gap-1 rounded px-1.5 text-xs text-[#56534c] hover:bg-black/5 disabled:opacity-40 dark:text-[#d8d4cc] dark:hover:bg-white/10';
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <button type="button" disabled={disabled} title={supplement} aria-label={`${roleTitle} ${supplement}`} className={buttonClass} onClick={() => onReviseRole(runId, roleId, 'supplement')}>
        <FilePlus2 className="size-3.5 shrink-0" />{supplement}
      </button>
      <button type="button" disabled={disabled} title={retry} aria-label={`${roleTitle} ${retry}`} className={buttonClass} onClick={() => onReviseRole(runId, roleId, 'retry')}>
        <RotateCcw className="size-3.5 shrink-0" />
      </button>
    </span>
  );
}

export default function ExpertTeamRevisionActions({ plan, disabled, onReviseRole }: {
  plan?: TurnPlanResource | null;
  disabled?: boolean;
  onReviseRole: RevisionAction;
}) {
  const { locale } = useI18n();
  const source = researchRevisionSource(plan);
  if (!source) return null;
  const zh = locale.startsWith('zh');
  return (
    <section data-research-revision-actions aria-label={zh ? '研究报告更新' : 'Research report update'} className="mt-5 flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-black/10 pt-3 dark:border-white/10">
      <div className="min-w-0 text-xs leading-5 text-[#656358] dark:text-[#b8b4ab]">
        <p className="font-medium">{zh ? '研究报告' : 'Research report'}{source.attentionRoles.length > 0 ? (zh ? ' · 有待补齐的角色结果' : ' · Role results need attention') : ''}</p>
        <p className="break-words">{source.defaultRole.title}</p>
      </div>
      <RoleRevisionActions runId={source.runId} roleId={source.defaultRole.id} roleTitle={source.defaultRole.title} disabled={disabled} onReviseRole={onReviseRole} />
    </section>
  );
}
