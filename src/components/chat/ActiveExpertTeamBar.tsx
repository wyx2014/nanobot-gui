import { Users } from 'lucide-react';

import { useActiveConversation } from '@/stores/chatStore';

export default function ActiveExpertTeamBar() {
  const conversation = useActiveConversation();
  const team = conversation?.expertTeam;
  if (!team) return null;

  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="text-[11px] font-medium text-[#656358]">专家团队</span>
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e7d7cc] bg-[#fff7f1] px-2.5 py-1 text-[11px] font-medium text-[#a65034]">
        <Users className="h-3.5 w-3.5" />
        {team.name || team.id}
        <span className="text-[#b9826f]">· 4 位专家</span>
      </span>
    </div>
  );
}
