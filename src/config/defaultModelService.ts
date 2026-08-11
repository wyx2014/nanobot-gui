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
  model: string;
  presetId: string;
}

export const DEFAULT_DESKTOP_MODEL_SERVICE = Object.freeze({
  providerId: ASSET_DEEPSEEK_MODEL_SERVICE.providerId,
  providerLabel: ASSET_DEEPSEEK_MODEL_SERVICE.providerLabel,
  apiKey: 'sk-rsjkBOmdfQtzfc382d4e8cC1F5084dEb819c30FcD6C23a4f',
  apiBase: 'http://192.168.0.228:1025/v1',
  apiType: 'auto',
  model: ASSET_DEEPSEEK_MODEL_SERVICE.model,
  presetId: ASSET_DEEPSEEK_MODEL_SERVICE.presetId,
} satisfies DesktopDefaultModelServiceConfig);
