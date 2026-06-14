/**
 * Legacy GUI sandbox helpers.
 *
 * Runtime tool boundaries are enforced by nanobot gateway. These helpers only
 * keep the older renderer-side network-proxy compatibility surface alive; they
 * do not enable nanobot's OS-level exec sandbox.
 */

import { isMacOS } from '@/utils/platform';
import { useSettingsStore } from '@/stores/settingsStore';
import { ipc } from '@/lib/ipc-factory';

/** Legacy workspace-restriction toggle mirrored from settingsStore. */
export function isSandboxEnabled(): boolean {
  if (!isMacOS()) return false;
  return useSettingsStore.getState().sandboxEnabled;
}

/** Whether the legacy proxy-based domain whitelist is enabled. */
export function isNetworkIsolationEnabled(): boolean {
  if (!isMacOS()) return false;
  const state = useSettingsStore.getState();
  return state.sandboxEnabled && state.networkIsolationEnabled;
}

let proxyStarted = false;

/** Start the network proxy if network isolation is enabled. Call once at app init. */
export async function initNetworkProxy(): Promise<void> {
  if (proxyStarted || !isMacOS()) return;

  const state = useSettingsStore.getState();
  if (!state.networkIsolationEnabled) return;

  try {
    const port = await ipc.invoke<number>('start_network_proxy', {
      whitelist: state.networkWhitelist,
      allowPrivateNetworks: state.allowPrivateNetworks,
    });
    proxyStarted = true;
    console.log(`[sandbox] Network proxy started on port ${port}`);
  } catch (err) {
    console.error('[sandbox] Failed to start network proxy:', err);
  }
}

/** Sync whitelist changes to the running proxy. */
export async function syncNetworkWhitelist(): Promise<void> {
  if (!proxyStarted) return;
  const state = useSettingsStore.getState();
  try {
    await ipc.invoke('update_network_whitelist', {
      whitelist: state.networkWhitelist,
      allowPrivateNetworks: state.allowPrivateNetworks,
    });
  } catch (err) {
    console.error('[sandbox] Failed to update whitelist:', err);
  }
}
