/**
 * What kind of computer the game runs on, by what the browser tells of it (0.5.0), so
 * the settings a first game starts with suit it:
 * - weak: two cores or less, or 2 GB of memory or less (an old or cheap Chromebook);
 * - low: a Chromebook, an iPad or a phone, or four cores or 4 GB at most;
 * - touch: another touch screen (a tablet or a touch laptop);
 * - desktop: everything else.
 * `?device=weak|low|touch|desktop` in the address says which instead (for trying them).
 */
export type DeviceClass = 'weak' | 'low' | 'touch' | 'desktop';

let known: DeviceClass | null = null;

export function deviceClass(): DeviceClass {
  if (known) return known;
  known = classify();
  return known;
}

function classify(): DeviceClass {
  const nav = globalThis.navigator as (Navigator & { deviceMemory?: number }) | undefined;
  const asked = globalThis.location ? new URLSearchParams(globalThis.location.search).get('device') : null;
  if (asked === 'weak' || asked === 'low' || asked === 'touch' || asked === 'desktop') return asked;
  if (!nav) return 'desktop';
  const ua = nav.userAgent || '';
  const cores = nav.hardwareConcurrency || 4;
  const mem = nav.deviceMemory;
  // (an iPad's Safari says it's a Mac: only its touch screen gives it away)
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1);
  const phone = /iPhone|iPod|Android/.test(ua);
  const chromebook = /CrOS/.test(ua);
  if (cores <= 2 || (mem !== undefined && mem <= 2)) return 'weak';
  if (ipad || phone || chromebook || cores <= 4 || (mem !== undefined && mem <= 4)) return 'low';
  if (globalThis.matchMedia?.('(pointer: coarse)').matches) return 'touch';
  return 'desktop';
}

/** Whether a browser driven by a program runs the game (the self-tests, a benchmark): nothing adjusts itself under them. */
export function automated(): boolean {
  return !!(globalThis.navigator as Navigator | undefined)?.webdriver;
}
