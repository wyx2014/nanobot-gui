export interface PromptHubUser {
  id: string;
  username: string;
  role: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface PromptHubLoginData {
  token: string;
  user: PromptHubUser;
}

interface PromptHubResponse<T> {
  code: number;
  message: string;
  data: T;
}

export interface PromptHubSkill {
  id: string;
  _id?: string;
  slug?: string;
  name?: string;
  displayName?: string;
  description?: string;
  summary?: string;
  version?: string;
  category?: string;
  tags?: string | string[];
  latestVersionId?: string;
  visibility?: string;
  approvalStatus?: string;
  updatedAt?: number;
}

interface PromptHubPublicSkillEntry {
  skill: PromptHubSkill;
}

interface PromptHubPublicSkillPage {
  page?: PromptHubPublicSkillEntry[];
  items?: PromptHubPublicSkillEntry[];
}

export interface PromptHubSkillPage {
  records: PromptHubSkill[];
  total: number;
  current: number;
  size: number;
}

export interface PromptHubFileMeta {
  path: string;
  size: number;
  sha256: string;
  contentType: string;
}

export interface PromptHubSkillDetail {
  skill: PromptHubSkill;
  latestVersion?: { id: string; version: string } | null;
  files: PromptHubFileMeta[];
}

export interface PromptHubFileContent extends PromptHubFileMeta {
  content: string;
}

export interface PromptHubPublishResult {
  status: string;
  skillId: string;
  versionId: string;
  fingerprint: string;
  fileCount: number;
}

async function promptHubRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const res = await fetch(url, {
    ...(init ?? {}),
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(init?.headers ?? {}),
    },
  });
  const payload = await res.json() as PromptHubResponse<T>;
  if (!res.ok || payload.code !== 200) {
    throw new Error(payload.message || `PromptHub HTTP ${res.status}`);
  }
  return payload.data;
}

async function promptHubRawRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...(init ?? {}),
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`PromptHub HTTP ${res.status}`);
  }
  return await res.json() as T;
}

export async function loginPromptHub(
  baseUrl: string,
  username: string,
  passwordHash: string,
): Promise<PromptHubLoginData> {
  return promptHubRequest<PromptHubLoginData>(`${baseUrl.replace(/\/+$/, '')}/api/users/login`, {
    method: 'POST',
    body: JSON.stringify({ username, passwordHash }),
  });
}

function authHeader(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

function hubBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export async function fetchPromptHubSkills(
  baseUrl: string,
  token: string,
  _pageSize = 100,
): Promise<PromptHubSkillPage> {
  const payload = await promptHubRawRequest<PromptHubPublicSkillPage>(`${hubBase(baseUrl)}/api/convex/query`, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ path: 'skills:listPublicPageV4', args: {} }),
  });
  const entries = payload.page ?? payload.items ?? [];
  const records = entries.map((entry) => ({
    ...entry.skill,
    id: entry.skill.id || entry.skill._id || '',
  })).filter((skill) => skill.id);
  return { records, total: records.length, current: 1, size: records.length };
}

export async function fetchPromptHubSkillDetail(
  baseUrl: string,
  token: string,
  id: string,
): Promise<PromptHubSkillDetail> {
  return promptHubRequest<PromptHubSkillDetail>(
    `${hubBase(baseUrl)}/api/skills/${encodeURIComponent(id)}`,
    { headers: authHeader(token) },
  );
}

export async function fetchPromptHubFile(
  baseUrl: string,
  token: string,
  versionId: string,
  path: string,
): Promise<PromptHubFileContent> {
  const query = new URLSearchParams({ versionId, path });
  return promptHubRequest<PromptHubFileContent>(
    `${hubBase(baseUrl)}/api/skill-versions/files?${query}`,
    { headers: authHeader(token) },
  );
}

export async function publishPromptHubSkill(
  baseUrl: string,
  token: string,
  params: { slug: string; displayName: string; content: string; version?: string },
): Promise<PromptHubPublishResult> {
  const form = new FormData();
  form.set('slug', params.slug);
  form.set('displayName', params.displayName);
  form.set('version', params.version || '1.0.0');
  form.set('changelog', '');
  form.set('visibility', 'public');
  form.set('category', 'general');
  form.set('tags', '');
  form.append('files', new File([params.content], 'SKILL.md', { type: 'text/markdown' }));
  return promptHubRequest<PromptHubPublishResult>(`${hubBase(baseUrl)}/api/skills/publish`, {
    method: 'POST',
    headers: authHeader(token),
    body: form,
  });
}
