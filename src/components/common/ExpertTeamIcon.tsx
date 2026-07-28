import {
  ChartCandlestick,
  ChartNoAxesCombined,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

type ExpertTeamIconKind = 'asset-research' | 'trading-analysis' | 'generic-team';

function iconKindForTeam(teamId?: string | null): ExpertTeamIconKind {
  const normalized = (teamId ?? '').trim().toLowerCase();
  if (normalized.startsWith('asset-research')) return 'asset-research';
  if (normalized.startsWith('trading-analysis')) return 'trading-analysis';
  return 'generic-team';
}

const TEAM_ICONS: Record<ExpertTeamIconKind, LucideIcon> = {
  'asset-research': ChartNoAxesCombined,
  'trading-analysis': ChartCandlestick,
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
