/**
 * Convert a Uint8Array to a base64 string without spreading all bytes at once.
 * The naive `btoa(String.fromCharCode(...bytes))` throws RangeError for arrays
 * larger than ~64 KB because it exceeds the maximum call-stack argument limit.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }
  return btoa(binary);
}
