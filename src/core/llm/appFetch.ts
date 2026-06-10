/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * App HTTP fetch wrapper.
 *
 * Sends requests from the Electron main process to bypass WebView CORS restrictions.
 * Falls back to global fetch in non-Electron environments (e.g. tests or custom browsers).
 */

import { isElectron, ipc } from '../../lib/ipc-factory';

export async function getAppFetch(): Promise<typeof globalThis.fetch> {
  if (isElectron) {
    // Return a function that mimics fetch but goes through IPC to bypass CORS
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!input) throw new Error('fetch failed: input (URL) is required');
      const url = typeof input === 'string' ? input : (input as URL).toString();
      
      // Simplify RequestInit to be serializable
      const options = init ? {
        method: init.method,
        headers: init.headers instanceof Headers 
          ? Object.fromEntries(init.headers.entries()) 
          : init.headers,
        body: typeof init.body === 'string' ? init.body : undefined,
      } : {};

      const result: any = await ipc.invoke('app:fetch', { url, options });
      
      // Create a fake Response object
      return {
        ok: result.ok,
        status: result.status,
        statusText: result.statusText,
        headers: new Headers(result.headers),
        json: async () => JSON.parse(result.body),
        text: async () => result.body,
        blob: async () => new Blob([result.body]),
        arrayBuffer: async () => new TextEncoder().encode(result.body).buffer,
      } as Response;
    }) as any;
  }
  return globalThis.fetch;
}
