import { FilePlus2 } from 'lucide-react';
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
  const buttonClass = 'inline-flex min-h-7 shrink-0 items-center justify-center gap-1 rounded px-1.5 text-xs text-[#56534c] hover:bg-black/5 disabled:opacity-40 dark:text-[#d8d4cc] dark:hover:bg-white/10';
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <button type="button" disabled={disabled} title={supplement} aria-label={`${roleTitle} ${supplement}`} className={buttonClass} onClick={() => onReviseRole(runId, roleId)}>
        <FilePlus2 className="size-3.5 shrink-0" />{supplement}
      </button>
    </span>
  );
}

export default function ExpertTeamRevisionActions({ plan, disabled, onReviseRole }: {
  plan?: TurnPlanResource | null;
  disabled?: boolean;
  onReviseRole: RevisionAction;
}) {
  const source = researchRevisionSource(plan);
  if (!source) return null;

  return (
    <section data-research-revision-actions className="mt-5 flex min-w-0 justify-end border-t border-black/10 pt-3 dark:border-white/10">
      <RoleRevisionActions
        runId={source.runId}
        roleId={source.defaultRole.id}
        roleTitle={source.defaultRole.title}
        disabled={disabled}
        onReviseRole={onReviseRole}
      />
    </section>
  );
}
