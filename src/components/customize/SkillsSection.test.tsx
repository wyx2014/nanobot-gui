import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initLanguage } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { usePromptHubStore } from '@/stores/promptHubStore';
import type { NanobotSkillInfo } from '@/core/types';
import SkillsSection from './SkillsSection';

const mocks = vi.hoisted(() => ({
  fetchSkills: vi.fn(), fetchSkillDetail: vi.fn(), refresh: vi.fn(),
}));
vi.mock('@/core/api', () => ({
  fetchSkills: mocks.fetchSkills, fetchSkillDetail: mocks.fetchSkillDetail,
  runSkillAction: vi.fn(), saveSkill: vi.fn(),
}));
vi.mock('@/core/nanobotClient', () => ({
  getNanobotStatus: vi.fn().mockResolvedValue({ ready: true, port: 8900 }),
  getNanobotToken: vi.fn().mockReturnValue('token'), refreshNanobotAuth: vi.fn(),
}));
vi.mock('@/stores/discoveryStore', () => ({
  useDiscoveryStore: () => ({ refresh: mocks.refresh }),
}));

const skill: NanobotSkillInfo = {
  name: 'libai-1.0.4', description: '润色专家',
  path: '/workspace/skills/libai-1.0.4/SKILL.md', source: 'workspace',
  enabled: true, available: true, missing: '', user_invocable: true, always: false, tags: [],
};
const content = '---\nname: libai-skill\n---\n# 李白.Skill\n';
const payload = { skills: [skill], disabled: [], installed_count: 1 };
let root: Root;
let container: HTMLDivElement;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  initLanguage('zh-CN');
  useSettingsStore.setState({ toolboxSearchQuery: '' });
  usePromptHubStore.setState({ token: null });
  mocks.fetchSkills.mockReset().mockResolvedValue(payload);
  mocks.fetchSkillDetail.mockReset().mockResolvedValue({ ...payload, skills: [{ ...skill, content }] });
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderMySkills() {
  await act(async () => root.render(<SkillsSection />));
  await act(async () => {
    const tab = [...container.querySelectorAll<HTMLButtonElement>('[data-skill-tab]')]
      .find((node) => node.textContent?.includes('我的技能'))!;
    tab.click();
  });
}

it('loads versioned skill details using the original directory name', async () => {
  await renderMySkills();
  await act(async () => container.querySelector<HTMLElement>('[data-skill-card]')!.click());
  expect(mocks.fetchSkillDetail).toHaveBeenCalledWith('token', 'libai-1.0.4', 'http://127.0.0.1:8900');
  expect(container.querySelector('[data-skill-detail] pre')?.textContent).toBe(content);
});

it('shows the actual detail error in the open panel and allows retry', async () => {
  mocks.fetchSkillDetail.mockRejectedValueOnce(new Error('invalid skill name'));
  await renderMySkills();
  await act(async () => container.querySelector<HTMLElement>('[data-skill-card]')!.click());
  const panel = container.querySelector('[data-skill-detail]')!;
  expect(panel.querySelector('[role="alert"]')?.textContent).toContain('invalid skill name');
  expect(panel.textContent).not.toContain('未读取到技能内容');
  await act(async () => panel.querySelector<HTMLButtonElement>('[role="alert"] button')!.click());
  expect(panel.querySelector('[role="alert"]')).toBeNull();
  expect(panel.querySelector('pre')?.textContent).toBe(content);
});

it('discovers a copied skill when returning to the app', async () => {
  mocks.fetchSkills.mockResolvedValueOnce({ ...payload, skills: [], installed_count: 0 });
  await renderMySkills();
  expect(container.querySelector('[data-skill-card]')).toBeNull();
  mocks.refresh.mockClear();
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(container.querySelector('[data-skill-card]')?.textContent).toContain('libai-1.0.4');
  expect(mocks.refresh).toHaveBeenCalled();
});
