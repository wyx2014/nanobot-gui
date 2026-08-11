import { beforeEach, describe, expect, it } from 'vitest';

import { PROMPT_HUB_BASE_URL } from '@/config/deployment';
import { usePromptHubStore } from './promptHubStore';

const legacyUser = {
  id: 'legacy-user',
  username: 'legacy',
  role: 'user',
};

function resetPromptHubState() {
  usePromptHubStore.setState({
    baseUrl: PROMPT_HUB_BASE_URL,
    token: null,
    user: null,
    isLoggingIn: false,
    loginOpen: false,
    error: null,
  });
}

beforeEach(() => {
  usePromptHubStore.persist.clearStorage();
  resetPromptHubState();
});

describe('PromptHub deployment endpoint', () => {
  it('uses the packaged deployment configuration and has no user setter', () => {
    expect(PROMPT_HUB_BASE_URL).toBe('http://localhost:8080');
    expect(usePromptHubStore.getState().baseUrl).toBe(PROMPT_HUB_BASE_URL);
    expect(usePromptHubStore.getState()).not.toHaveProperty('setBaseUrl');
  });

  it('ignores a persisted endpoint and clears credentials from another server', async () => {
    localStorage.setItem('ruyi-prompthub', JSON.stringify({
      version: 1,
      state: {
        baseUrl: 'https://legacy.example.com',
        token: 'legacy-token',
        user: legacyUser,
      },
    }));

    await usePromptHubStore.persist.rehydrate();

    expect(usePromptHubStore.getState().baseUrl).toBe(PROMPT_HUB_BASE_URL);
    expect(usePromptHubStore.getState().token).toBeNull();
    expect(usePromptHubStore.getState().user).toBeNull();
  });

  it('preserves credentials only when they belong to the configured server', async () => {
    localStorage.setItem('ruyi-prompthub', JSON.stringify({
      version: 2,
      state: {
        baseUrl: `${PROMPT_HUB_BASE_URL}/`,
        token: 'current-token',
        user: legacyUser,
      },
    }));

    await usePromptHubStore.persist.rehydrate();

    expect(usePromptHubStore.getState().baseUrl).toBe(PROMPT_HUB_BASE_URL);
    expect(usePromptHubStore.getState().token).toBe('current-token');
    expect(usePromptHubStore.getState().user).toEqual(legacyUser);
  });
});
