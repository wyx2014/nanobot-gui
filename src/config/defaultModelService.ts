import { ASSET_DEEPSEEK_MODEL_SERVICE } from './builtinModelServices';

/**
 * Deployment-managed model service installed into a new desktop profile.
 *
 * This module is imported by the Electron main process only. Do not import it
 * from renderer code: the credential must never be rendered, logged, or stored
 * in the browser-side settings store.
 */
export interface DesktopDefaultModelServiceConfig {
  providerId: string;
  providerLabel: string;
  apiKey: string;
  apiBase: string;
  apiType: 'auto' | 'chat_completions' | 'responses';
  fallbackModels: readonly string[];
  preferredDefaultModel: string;
}

export const DEFAULT_DESKTOP_MODEL_SERVICE = Object.freeze({
  providerId: ASSET_DEEPSEEK_MODEL_SERVICE.providerId,
  providerLabel: ASSET_DEEPSEEK_MODEL_SERVICE.providerLabel,
  apiKey: 'sk-rsjkBOmdfQtzfc382d4e8cC1F5084dEb819c30FcD6C23a4f',
  apiBase: 'http://192.168.0.228:1025/v1',
  apiType: 'auto',
  fallbackModels: ['deepseek-r1', 'deepseek_v4_flash'],
  preferredDefaultModel: 'deepseek_v4_flash',
} satisfies DesktopDefaultModelServiceConfig);

type ModelCatalogFetch = (
  input: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/** Fetch the current model IDs without exposing the managed credential to the renderer. */
export async function discoverDesktopDefaultModels(
  service: DesktopDefaultModelServiceConfig = DEFAULT_DESKTOP_MODEL_SERVICE,
  fetchCatalog: ModelCatalogFetch = fetch,
): Promise<string[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetchCatalog(`${service.apiBase.replace(/\/+$/, '')}/models`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${service.apiKey}`,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`model catalog returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    const container = payload && typeof payload === 'object'
      ? payload as { data?: unknown; models?: unknown }
      : {};
    const rows = Array.isArray(payload)
      ? payload
      : Array.isArray(container.data)
        ? container.data
        : Array.isArray(container.models)
          ? container.models
          : [];
    const models = Array.from(new Set(rows.flatMap((row) => {
      const modelId = typeof row === 'string'
        ? row
        : row && typeof row === 'object' && 'id' in row
          ? String((row as { id: unknown }).id)
          : '';
      const normalized = modelId.trim();
      return normalized ? [normalized] : [];
    })));
    if (!models.length) {
      throw new Error('model catalog returned no models');
    }
    return models;
  } finally {
    clearTimeout(timeout);
  }
}
