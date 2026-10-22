/**
 * Runs the in-game self-tests headlessly and exits non-zero if any fail:
 *
 *   npm test                 every test
 *   npm test -- liquids      only tests whose name contains "liquids"
 *   SEED=7 npm test          with Math.random seeded, to replay a failure
 *   npm run bench            time crowded scenes instead (npm run bench -- pile: one scene)
 *
 * Starts the Vite dev server, opens the game in headless Chrome (or Edge) over
 * the DevTools protocol, runs `bp.selftest()` in the page and prints the results.
 * Set CHROME=/path/to/browser if it isn't found.
 */
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const benchMode = args.includes('--bench');
const filter = args.find((a) => !a.startsWith('--')) ?? '';
const seed = process.env.SEED ? Number(process.env.SEED) >>> 0 : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const browser = candidates.find((p) => existsSync(p));
if (!browser) {
  console.error('No Chrome or Edge found. Set CHROME=/path/to/chrome and try again.');
  process.exit(2);
}

// (no file watching or hot reload: editing the source mid-run mustn't reload the page under the tests)
const server = await createServer({ server: { port: 0, strictPort: false, hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const profile = mkdtempSync(join(tmpdir(), 'bp-selftest-'));
const proc = spawn(browser, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
  '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1280,800', 'about:blank',
], { stdio: 'ignore' });

let exitCode = 1;
let ws;
try {
  // the browser writes its debugging port into the profile once it is up
  const portFile = join(profile, 'DevToolsActivePort');
  let port = null;
  for (let i = 0; i < 150 && !port; i++) {
    await sleep(100);
    if (existsSync(portFile)) port = readFileSync(portFile, 'utf8').split('\n')[0].trim() || null;
  }
  if (!port) throw new Error('browser did not start');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((t) => t.type === 'page');
  if (!target) throw new Error('no page in the browser');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let nextId = 1;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message));
      else res(msg.result);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression, timeout = 30000) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  // wait for the game to boot (physics WASM, sprites, sounds' manifest)
  let ready = false;
  for (let i = 0; i < 600 && !ready; i++) {
    await sleep(100);
    ready = await evaluate('!!(window.bp && window.bp.selftest)').catch(() => false);
  }
  if (!ready) throw new Error(`the game did not start${errors.length ? ': ' + errors.join('; ') : ''}`);

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
    console.log(`Running self-tests${filter ? ` matching "${filter}"` : ''} in ${browser.split(/[\\/]/).pop()} (headless)...\n`);
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
  try {
    ws?.close();
  } catch {}
  proc.kill();
  await server.close();
  await sleep(300);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
}
process.exit(exitCode);
