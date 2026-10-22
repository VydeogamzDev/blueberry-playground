/**
 * Opens the game in headless Chrome (or Edge) for the test scripts: starts the
 * Vite dev server, launches the browser, talks to it over the DevTools
 * protocol and waits for the game to boot. Set CHROME=/path/to/browser if it
 * isn't found.
 */
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/**
 * @param {{ width?: number, height?: number, phone?: boolean }} opts
 *   phone: emulate a 390x844 touch phone
 */
export async function openGame(opts = {}) {
  const browser = candidates.find((p) => existsSync(p));
  if (!browser) throw new Error('No Chrome or Edge found. Set CHROME=/path/to/chrome and try again.');
  // (no file watching or hot reload: editing the source mid-run mustn't reload the page under the tests)
  const server = await createServer({ server: { port: 0, strictPort: false, hmr: false, watch: null }, logLevel: 'error' });
  await server.listen();
  const url = server.resolvedUrls.local[0];
  const profile = mkdtempSync(join(tmpdir(), 'bp-test-'));
  const proc = spawn(browser, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required', `--window-size=${opts.width ?? 1280},${opts.height ?? 800}`, 'about:blank',
  ], { stdio: 'ignore' });
  let ws;
  const close = async () => {
    try {
      ws?.close();
    } catch {}
    proc.kill();
    await server.close();
    await sleep(300);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {}
  };
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
    if (opts.phone) {
      await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    }
    await send('Page.navigate', { url });
    // wait for the game to boot (physics WASM, sprites, sounds' manifest)
    let ready = false;
    for (let i = 0; i < 600 && !ready; i++) {
      await sleep(100);
      ready = await evaluate('!!(window.bp && window.bp.selftest)').catch(() => false);
    }
    if (!ready) throw new Error(`the game did not start${errors.length ? ': ' + errors.join('; ') : ''}`);
    return { send, evaluate, errors, close, browser: browser.split(/[\\/]/).pop() };
  } catch (e) {
    await close();
    throw e;
  }
}
