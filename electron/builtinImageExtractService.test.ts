import { afterEach, describe, expect, it } from 'vitest';

import {
  desktopImageExtractGatewayEnvironment,
  getDesktopImageExtractService,
  IMAGE_EXTRACT_ENV,
} from './builtinImageExtractService';

describe('desktop image extraction service', () => {
  const original = {
    apiUrl: process.env[IMAGE_EXTRACT_ENV.apiUrl],
    apiKey: process.env[IMAGE_EXTRACT_ENV.apiKey],
    model: process.env[IMAGE_EXTRACT_ENV.model],
  };

  afterEach(() => {
    for (const [name, value] of [
      [IMAGE_EXTRACT_ENV.apiUrl, original.apiUrl],
      [IMAGE_EXTRACT_ENV.apiKey, original.apiKey],
      [IMAGE_EXTRACT_ENV.model, original.model],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('uses runtime overrides and maps them to gateway-only environment names', () => {
    const service = getDesktopImageExtractService({
      [IMAGE_EXTRACT_ENV.apiUrl]: 'http://vision.example/v1/chat/completions',
      [IMAGE_EXTRACT_ENV.apiKey]: 'managed-key',
      [IMAGE_EXTRACT_ENV.model]: 'vision-model',
    });

    expect(desktopImageExtractGatewayEnvironment(service)).toEqual({
      NANOBOT_IMAGE_EXTRACT_API_URL: 'http://vision.example/v1/chat/completions',
      NANOBOT_IMAGE_EXTRACT_API_KEY: 'managed-key',
      NANOBOT_IMAGE_EXTRACT_MODEL: 'vision-model',
    });
  });

  it('does not enable the gateway service without a credential', () => {
    expect(desktopImageExtractGatewayEnvironment({
      apiUrl: 'http://vision.example',
      apiKey: '',
      model: 'qwen-vl',
    })).toEqual({});
  });
});
