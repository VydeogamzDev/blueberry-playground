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

/**
 * Apple's WebKit (Safari, and every browser on an iPhone or iPad) can't be relied
 * on to decode Ogg Vorbis (older iOS can't play it at all): it's given the MP3
 * made beside each (npm run apple-audio).
 */
const oggOk = (() => {
  if (typeof document === 'undefined') return true;
  if (/Apple/.test(navigator.vendor)) return false;
  return document.createElement('audio').canPlayType('audio/ogg; codecs="vorbis"') !== '';
})();

/** The file of public/ to load for a recording listed as an Ogg: the Ogg, or on Apple's devices its MP3. (The standalone page carries the Ogg.) */
export function audioPath(path: string): string {
  if (oggOk || !path.endsWith('.ogg') || (globalThis as { BP_ASSETS?: Record<string, unknown> }).BP_ASSETS?.[path]) return path;
  return path.slice(0, -4) + '.mp3';
}
