import { create } from 'zustand';
import type { SkillMetadata, SubagentMetadata, ExpertMetadata } from '../types';
import { expertRegistry } from '../core/expert/registry';
import { fetchSkills } from '../core/api';
import { getNanobotStatus, getNanobotToken, refreshNanobotAuth } from '../core/nanobotClient';

interface DiscoveryState {
  skills: SkillMetadata[];
  agents: SubagentMetadata[];
  experts: ExpertMetadata[];
  isLoading: boolean;
}

interface DiscoveryActions {
  refresh: () => Promise<void>;
}

export type DiscoveryStore = DiscoveryState & DiscoveryActions;

export const useDiscoveryStore = create<DiscoveryStore>()((set) => ({
  skills: [],
  agents: [],
  experts: [],
  isLoading: false,

  refresh: async () => {
    set({ isLoading: true });
    try {
      const status = await getNanobotStatus();
      let token = getNanobotToken();
      let baseUrl = status.ready ? `http://127.0.0.1:${status.port}` : "";
      if (status.ready && !token) {
        const refreshed = await refreshNanobotAuth();
        token = refreshed.token;
        baseUrl = refreshed.baseUrl;
      }
      const [skillsPayload, experts] = await Promise.all([
        status.ready && token
          ? fetchSkills(token, baseUrl)
          : Promise.resolve({ skills: [] }),
        expertRegistry.discoverExperts(),
      ]);
      const skills: SkillMetadata[] = skillsPayload.skills
        .filter((skill) => skill.enabled && skill.available && skill.user_invocable !== false)
        .map((skill) => ({
          name: skill.name,
          description: skill.description,
          userInvocable: skill.user_invocable,
          tags: [skill.source, ...skill.tags],
        }));
      set({ skills, agents: [], experts, isLoading: false });
    } catch (err) {
      console.warn('Discovery refresh failed:', err);
      set({ isLoading: false });
    }
  },
}));
