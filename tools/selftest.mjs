/**
 * Runs the in-game self-tests headlessly and exits non-zero if any fail:
 *
 *   npm test                 every test
 *   npm test -- liquids      only tests whose name contains "liquids"
 *   SEED=7 npm test          with Math.random seeded, to replay a failure
 *   npm run bench            time crowded scenes instead (npm run bench -- pile: one scene)
 *   npm run bench -- --live  run 100 people in real time on the graphics card, frames held to
 *                            a 60 Hz display (--hz=144 for another), and report the speed
 *   npm run mixcheck         measure the sound mix: busy scenes rendered offline, and every sound's level
 *   npm run mixcheck -- --wav  ...and save each scene's mix to mix-renders/<scene>.wav to listen to
 *
 * Opens the game in headless Chrome (see browser.mjs), runs `bp.selftest()` in
 * the page and prints the results.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { openGame } from './browser.mjs';

const args = process.argv.slice(2);
const benchMode = args.includes('--bench');
const liveMode = benchMode && args.includes('--live');
const hz = Number(args.find((a) => a.startsWith('--hz='))?.slice(5) ?? 60);
const mixMode = args.includes('--mix');
const wavMode = args.includes('--wav');
const filter = args.find((a) => !a.startsWith('--')) ?? '';
const seed = process.env.SEED ? Number(process.env.SEED) >>> 0 : null;

let exitCode = 1;
let page;
try {
  // the bench times the CPU: headless Chrome draws in software, and a full-size
  // window's drawing slows the physics steps beside it (by up to half)
  page = await openGame({ still: seed !== null, ...(liveMode ? { gpu: true, vsync: hz } : benchMode ? { width: 320, height: 200 } : {}) });
  const { evaluate, errors } = page;

  if (seed !== null) {
    // mulberry32: the same sequence every run
    await evaluate(`(() => { let a = ${seed}; Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })()`);
    console.log(`Math.random seeded with ${seed}`);
  }
  if (mixMode) {
    console.log('Recording busy scenes and rendering them offline through the master bus...\n');
    const pad = (s, n) => String(s).padEnd(n);
    const reports = JSON.parse(await evaluate(`bp.mixcheck.scenes(${JSON.stringify(filter)}, ${wavMode}).then((r) => JSON.stringify(r))`, 15 * 60 * 1000));
    if (wavMode) {
      mkdirSync('mix-renders', { recursive: true });
      for (const r of reports) {
        writeFileSync(`mix-renders/${r.scene}.wav`, Buffer.from(r.wav, 'base64'));
        delete r.wav;
      }
      console.log(`Saved ${reports.map((r) => `mix-renders/${r.scene}.wav`).join(', ')}\n`);
    }
    console.log(pad('scene', 9) + pad('sounds', 8) + pad('refused', 9) + pad('cut', 6) + pad('voices', 8) + pad('peak in', 9) + pad('peak out', 10) + pad('over %', 8) + pad('at vol 1', 10) + pad('over %', 8) + pad('loudest', 9) + 'mean (dBFS RMS)');
    for (const r of reports) {
      console.log(pad(r.scene, 9) + pad(r.sounds, 8) + pad(r.dropped, 9) + pad(r.cut, 6) + pad(r.voices, 8) + pad(r.peakIn, 9) + pad(r.peakOut, 10) + pad(r.over, 8) + pad(r.peakFull, 10) + pad(r.overFull, 8) + pad(r.loudest, 9) + r.mean);
      console.log('    peaks: ' + r.top.map(([k, p, n]) => `${k} ${p} (${n})`).join(' · '));
    }
    if (!filter) {
      console.log('\nEach sound on its own (dBFS before the master volume and bus): peak / loudest 50 ms');
      const levels = JSON.parse(await evaluate('bp.mixcheck.levels().then((r) => JSON.stringify(r))', 5 * 60 * 1000));
      for (const l of levels) console.log('  ' + pad(l.sound, 22) + pad(l.peak, 8) + l.loud);
    }
    if (errors.length) console.log(`\nPage errors:\n  ${errors.join('\n  ')}`);
    exitCode = errors.length ? 1 : 0;
  } else if (liveMode) {
    const gpu = await evaluate(`(() => { const gl = bp.game.renderer.gl.getContext(); const x = gl.getExtension('WEBGL_debug_renderer_info'); return x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })()`);
    console.log(`Running crowded scenes in real time on ${gpu}, frames held to ${hz} Hz...\n`);
    const rows = JSON.parse(await evaluate(`bp.benchLive(${JSON.stringify(filter || 'pile battle')}).then((r) => JSON.stringify(r))`, 15 * 60 * 1000));
    console.log('Each 3 s: speed (% of real time) / frames a second / step ms (L: the long step)\n');
    for (const r of rows) {
      console.log(`${r.scene.padEnd(12)}${String(r.speed).padStart(4)}%   ` + r.windows.map((w) => `${w.speed}%/${w.fps}/${w.step}${w.long ? 'L' : ''}`).join('  '));
    }
    console.log('\nThe first column: speed after the first 3 s (a scene too heavy for the short step switches to the long one within it).');
    if (errors.length) console.log(`\nPage errors:\n  ${errors.join('\n  ')}`);
    exitCode = errors.length ? 1 : 0;
  } else if (benchMode) {
    console.log(`Timing crowded scenes${filter ? ` matching "${filter}"` : ''} (physics and frame CPU time; the GPU draw is software here and not counted)...\n`);
    const rows = JSON.parse(await evaluate(`bp.bench(${JSON.stringify(filter)}).then((r) => JSON.stringify(r))`, 15 * 60 * 1000));
    const pad = (s, n) => String(s).padEnd(n);
    console.log(pad('scene', 14) + pad('bodies', 8) + pad('step ms', 10) + pad('p95', 8) + pad('max', 8) + pad('frame ms', 10) + pad('load', 7) + pad('coarse', 8) + 'draws');
    for (const r of rows) {
      console.log(pad(r.scene, 14) + pad(r.bodies, 8) + pad(r.step.mean, 10) + pad(r.step.p95, 8) + pad(r.step.max, 8) + pad(r.frame, 10) + pad(r.load, 7) + pad(r.coarseLoad ?? '', 8) + r.draws);
      console.log('    ' + Object.entries(r.stages).map(([k, v]) => `${k} ${v}`).join(' · '));
    }
    console.log('\nload: share of a 60 Hz frame the scene needs at full speed (over 1 runs slower than real time);');
    console.log('coarse: the same at the longer physics step the game switches to when load is over 0.9.');
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
