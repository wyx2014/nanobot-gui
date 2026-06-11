import { create } from 'zustand';
import type { SkillMetadata, SubagentMetadata, ExpertMetadata } from '../types';
import { skillLoader } from '../core/skill/loader';
import { expertRegistry } from '../core/expert/registry';

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
      const [skills, experts] = await Promise.all([
        skillLoader.discoverSkills(),
        expertRegistry.discoverExperts(),
      ]);
      set({ skills, agents: [], experts, isLoading: false });
    } catch (err) {
      console.warn('Discovery refresh failed:', err);
      set({ isLoading: false });
    }
  },
}));
