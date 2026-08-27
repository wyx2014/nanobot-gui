/**
 * Public metadata for model services managed by the desktop application.
 *
 * Renderer code may import this module. Credentials and private endpoints must
 * stay in defaultModelService.ts, which is imported by Electron main only.
 */
export const ASSET_DEEPSEEK_MODEL_SERVICE = Object.freeze({
  providerId: 'asset-deepseek',
  providerLabel: '资产DeepSeek',
});
export const LEGACY_ASSET_DEEPSEEK_MODEL_PRESET_ID = 'asset-deepseek-r1';

export function isProtectedBuiltinModelProvider(provider: string): boolean {
  return provider === ASSET_DEEPSEEK_MODEL_SERVICE.providerId;
}
