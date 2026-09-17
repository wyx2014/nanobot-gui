import { create } from 'zustand';
import type { SkillMetadata, SubagentMetadata, ExpertMetadata } from '../types';
import { expertRegistry } from '../core/expert/registry';
import { fetchSkills } from '../core/api';
import { getNanobotStatus, getNanobotToken, refreshNanobotAuth } from '../core/nanobotClient';
import { recordDiagnostic, startDiagnostic } from '../core/diagnostics';
import { diagnosticError } from '../shared/diagnostics';
import { skillCatalogCounts } from '../core/skills/diagnostics';

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

export const useDiscoveryStore = create<DiscoveryStore>()((set, get) => ({
  skills: [],
  agents: [],
  experts: [],
  isLoading: false,

  refresh: async () => {
    const operation = startDiagnostic('renderer.skills.refresh', { details: { count: get().skills.length } });
    const context = { client_action_id: operation.client_action_id };
    let stage = 'gateway_status';
    const observe = async <T>(name: string, run: () => Promise<T>, summarize?: (value: T) => Record<string, unknown>) => {
      const step = startDiagnostic(`renderer.skills.${name}`, context);
      try {
        const result = await run();
        step.finish('completed', summarize?.(result));
        return result;
      } catch (err) {
        step.finish('failed', diagnosticError(err));
        throw err;
      }
    };
    set({ isLoading: true });
    try {
      const status = await observe('gateway_status', getNanobotStatus, (value) => ({ ready: value.ready }));
      let token = getNanobotToken();
      let baseUrl = status.ready ? `http://127.0.0.1:${status.port}` : "";
      if (status.ready && !token) {
        stage = 'authentication';
        const refreshed = await observe('authentication', refreshNanobotAuth);
        token = refreshed.token;
        baseUrl = refreshed.baseUrl;
      }
      recordDiagnostic({ ...context, event_name: 'renderer.skills.fetch_gate', status: 'completed',
        details: { ready: status.ready, auth_header_present: Boolean(token),
          stage: status.ready && token ? 'fetch' : 'skip_fetch' } });
      stage = 'parallel_load';
      const [skillsPayload, experts] = await Promise.all([
        observe('fetch', async () => status.ready && token
          ? fetchSkills(token, baseUrl)
          : Promise.resolve({ skills: [] }), skillCatalogCounts),
        observe('legacy_experts', () => expertRegistry.discoverExperts(), (value) => ({ count: Array.isArray(value) ? value.length : undefined })),
      ]);
      stage = 'filter';
      const filtered = skillsPayload.skills
        .filter((skill) => skill.enabled && skill.available && skill.user_invocable !== false);
      recordDiagnostic({ ...context, event_name: 'renderer.skills.filtered', status: 'completed', details: { count: filtered.length } });
      stage = 'map';
      const skills: SkillMetadata[] = filtered
        .map((skill) => ({
          name: skill.name,
          description: skill.description,
          userInvocable: skill.user_invocable,
          tags: [skill.source, ...skill.tags],
        }));
      set({ skills, agents: [], experts, isLoading: false });
      operation.finish('completed', { stage: 'published', count: skills.length });
    } catch (err) {
      operation.finish('failed', { stage, count: get().skills.length, ...diagnosticError(err) });
      console.warn('Discovery refresh failed:', err);
      set({ isLoading: false });
    }
  },
}));
