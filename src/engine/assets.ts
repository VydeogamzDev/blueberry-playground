/**
 * Fetches a file from public/ by its path there (e.g. 'sfx/manifest.json'). The
 * standalone page (npm run standalone) carries its files inside itself, since a
 * page opened from disk can't fetch any: its loader puts them in
 * window.BP_ASSETS before the game starts (see tools/standalone.mjs).
 */
export function fetchAsset(path: string): Promise<Response> {
  const packed = (globalThis as { BP_ASSETS?: Record<string, Uint8Array<ArrayBuffer>> }).BP_ASSETS?.[path];
  return packed ? Promise.resolve(new Response(packed)) : fetch(import.meta.env.BASE_URL + path);
}
