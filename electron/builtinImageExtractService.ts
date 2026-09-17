/**
 * Deployment-managed image extraction service.
 *
 * Values are compiled into the Electron main bundle only and passed to the
 * nanobot gateway. They are not exposed through renderer code or shell tools.
 */

declare const __TPCOWORK_IMAGE_EXTRACT_API_URL__: string | undefined;
declare const __TPCOWORK_IMAGE_EXTRACT_API_KEY__: string | undefined;
declare const __TPCOWORK_IMAGE_EXTRACT_MODEL__: string | undefined;

const DEFAULT_IMAGE_EXTRACT_API_URL = 'http://192.168.0.228:1025/v1/chat/completions';
const DEFAULT_IMAGE_EXTRACT_MODEL = 'qwen-vl';

export const IMAGE_EXTRACT_ENV = Object.freeze({
  apiUrl: 'NANOBOT_IMAGE_EXTRACT_API_URL',
  apiKey: 'NANOBOT_IMAGE_EXTRACT_API_KEY',
  model: 'NANOBOT_IMAGE_EXTRACT_MODEL',
} as const);

export interface DesktopImageExtractService {
  apiUrl: string;
  apiKey: string;
  model: string;
}

function compiledService(): DesktopImageExtractService {
  return {
    apiUrl: typeof __TPCOWORK_IMAGE_EXTRACT_API_URL__ === 'string'
      ? __TPCOWORK_IMAGE_EXTRACT_API_URL__.trim()
      : '',
    apiKey: typeof __TPCOWORK_IMAGE_EXTRACT_API_KEY__ === 'string'
      ? __TPCOWORK_IMAGE_EXTRACT_API_KEY__.trim()
      : '',
    model: typeof __TPCOWORK_IMAGE_EXTRACT_MODEL__ === 'string'
      ? __TPCOWORK_IMAGE_EXTRACT_MODEL__.trim()
      : '',
  };
}

export function getDesktopImageExtractService(
  env: NodeJS.ProcessEnv = process.env,
): DesktopImageExtractService {
  const bundled = compiledService();
  return {
    apiUrl: env[IMAGE_EXTRACT_ENV.apiUrl]?.trim()
      || bundled.apiUrl
      || DEFAULT_IMAGE_EXTRACT_API_URL,
    apiKey: env[IMAGE_EXTRACT_ENV.apiKey]?.trim() || bundled.apiKey,
    model: env[IMAGE_EXTRACT_ENV.model]?.trim()
      || bundled.model
      || DEFAULT_IMAGE_EXTRACT_MODEL,
  };
}

export function desktopImageExtractGatewayEnvironment(
  service: DesktopImageExtractService = getDesktopImageExtractService(),
): Record<string, string> {
  if (!service.apiKey.trim()) return {};
  return {
    [IMAGE_EXTRACT_ENV.apiUrl]: service.apiUrl.trim(),
    [IMAGE_EXTRACT_ENV.apiKey]: service.apiKey.trim(),
    [IMAGE_EXTRACT_ENV.model]: service.model.trim(),
  };
}
