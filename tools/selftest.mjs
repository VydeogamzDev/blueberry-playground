/**
 * Runs the in-game self-tests headlessly and exits non-zero if any fail:
 *
 *   npm test                 every test
 *   npm test -- liquids      only tests whose name contains "liquids"
 *   SEED=7 npm test          with Math.random seeded, to replay a failure
 *   npm run bench            time crowded scenes instead (npm run bench -- pile: one scene)
 *
 * Opens the game in headless Chrome (see browser.mjs), runs `bp.selftest()` in
 * the page and prints the results.
 */
import { openGame } from './browser.mjs';

const args = process.argv.slice(2);
const benchMode = args.includes('--bench');
const filter = args.find((a) => !a.startsWith('--')) ?? '';
const seed = process.env.SEED ? Number(process.env.SEED) >>> 0 : null;

let exitCode = 1;
let page;
try {
  page = await openGame();
  const { evaluate, errors } = page;

  if (seed !== null) {
    // mulberry32: the same sequence every run
    await evaluate(`(() => { let a = ${seed}; Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })()`);
    console.log(`Math.random seeded with ${seed}`);
  }
  if (benchMode) {
    console.log(`Timing crowded scenes${filter ? ` matching "${filter}"` : ''} (physics and frame CPU time; the GPU draw is software here and not counted)...\n`);
    const rows = JSON.parse(await evaluate(`bp.bench(${JSON.stringify(filter)}).then((r) => JSON.stringify(r))`, 15 * 60 * 1000));
    const pad = (s, n) => String(s).padEnd(n);
    console.log(pad('scene', 14) + pad('bodies', 8) + pad('step ms', 10) + pad('p95', 8) + pad('max', 8) + pad('frame ms', 10) + pad('load', 7) + 'draws');
    for (const r of rows) {
      console.log(pad(r.scene, 14) + pad(r.bodies, 8) + pad(r.step.mean, 10) + pad(r.step.p95, 8) + pad(r.step.max, 8) + pad(r.frame, 10) + pad(r.load, 7) + r.draws);
      console.log('    ' + Object.entries(r.stages).map(([k, v]) => `${k} ${v}`).join(' · '));
    }
    if (errors.length) console.log(`\nPage errors:\n  ${errors.join('\n  ')}`);
    exitCode = errors.length ? 1 : 0;
  } else {
    console.log(`Running self-tests${filter ? ` matching "${filter}"` : ''} in ${page.browser} (headless)...\n`);
    const t0 = Date.now();
    const results = JSON.parse(await evaluate(`bp.selftest(${JSON.stringify(filter)}).then((r) => JSON.stringify(r))`, 15 * 60 * 1000));
    let failed = 0;
    for (const r of results) {
      if (!r.pass) failed++;
      console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  (${(r.ms / 1000).toFixed(1)} s)${r.pass ? '' : `\n      ${r.detail}`}`);
    }
    console.log(`\n${results.length - failed}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    if (errors.length) console.log(`\nPage errors:\n  ${errors.join('\n  ')}`);
    exitCode = failed || !results.length ? 1 : 0;
  }
} catch (e) {
  console.error(`Self-test run failed: ${e.message}`);
  exitCode = 1;
} finally {
  await page?.close();
}
process.exit(exitCode);
