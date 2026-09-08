import { fetchGatewayResponse } from './api';
import { getNanobotStatus, getNanobotToken, refreshNanobotAuth } from './nanobotClient';

export type PresentationFamily = 'taiping' | 'guizang' | 'kimi';
export interface PresentationSelection {
  template_id: string;
  document_id: string;
  name: string;
  sample_first: boolean;
  page?: number;
}
export interface PresentationTemplate {
  id: string;
  family: PresentationFamily;
  name: string;
  name_en: string;
  category: string;
  format: 'pptx' | 'html';
  version: number;
  available: boolean;
  missing: string[];
  requires_network: boolean;
  previews: string[];
}
export interface PresentationDocument {
  document_id: string;
  template_id: string;
  name: string;
  title: string;
  format: 'pptx' | 'html';
  family: PresentationFamily;
  status: 'draft' | 'ready';
  project_path: string;
  updated_at: number;
  page_count?: number;
  artifacts: Array<{ path: string; name: string; mime_type: string }>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const status = await getNanobotStatus();
  let token = getNanobotToken();
  let base = `http://127.0.0.1:${status.port}`;
  if (!token) ({ token, baseUrl: base } = await refreshNanobotAuth());
  let response = await fetchGatewayResponse(`${base}/api/presentations/${path}`, token, init, 40000);
  if (response.status === 401) {
    ({ token, baseUrl: base } = await refreshNanobotAuth());
    response = await fetchGatewayResponse(`${base}/api/presentations/${path}`, token, init, 40000);
  }
  if (!response.ok) throw new Error(await response.text() || `HTTP ${response.status}`);
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Gateway returned a non-JSON presentation response');
  }
  return response.json() as Promise<T>;
}

export interface PresentationCatalog {
  templates: PresentationTemplate[];
  previews_pending?: boolean;
}

let cachedCatalog: PresentationCatalog | undefined;
let pendingCatalog: Promise<PresentationCatalog> | undefined;

export const getCachedPresentationTemplates = () => cachedCatalog;

export function fetchPresentationTemplates(): Promise<PresentationCatalog> {
  if (pendingCatalog) return pendingCatalog;
  const pending = request<PresentationCatalog>('templates').then((catalog) => {
    cachedCatalog = catalog;
    return catalog;
  }).finally(() => { if (pendingCatalog === pending) pendingCatalog = undefined; });
  pendingCatalog = pending;
  return pending;
}

export const fetchPresentationPreviews = (templateId: string) => request<{ previews: string[] }>(`previews?template_id=${encodeURIComponent(templateId)}`);
export const fetchPresentationDocuments = (chatId: string) => request<{ documents: PresentationDocument[] }>(`documents?chat_id=${encodeURIComponent(chatId)}`);

export function normalizePresentationSelection(value: unknown): PresentationSelection | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Partial<PresentationSelection>;
  if (typeof item.template_id !== 'string' || typeof item.document_id !== 'string' || typeof item.name !== 'string') return undefined;
  return { template_id: item.template_id, document_id: item.document_id, name: item.name,
    sample_first: item.sample_first !== false,
    ...(Number.isInteger(item.page) && item.page! >= 1 && item.page! <= 100 ? { page: item.page } : {}),
  };
}
