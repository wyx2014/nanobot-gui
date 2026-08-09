import {
  ChartNoAxesCombined,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

type ExpertTeamIconKind = 'asset-research' | 'generic-team';

function iconKindForTeam(teamId?: string | null): ExpertTeamIconKind {
  const normalized = (teamId ?? '').trim().toLowerCase();
  if (normalized.startsWith('asset-research')) return 'asset-research';
  return 'generic-team';
}

const TEAM_ICONS: Record<ExpertTeamIconKind, LucideIcon> = {
  'asset-research': ChartNoAxesCombined,
  'generic-team': Users,
};

interface ExpertTeamIconProps {
  teamId?: string | null;
  className?: string;
}

export default function ExpertTeamIcon({
  teamId,
  className,
}: ExpertTeamIconProps) {
  const kind = iconKindForTeam(teamId);
  const Icon = TEAM_ICONS[kind];
  return (
    <Icon
      aria-hidden="true"
      data-expert-team-icon={kind}
      className={cn('shrink-0', className)}
    />
  );
}
