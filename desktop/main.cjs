'use strict';
/**
 * The desktop app: Blueberry Playground in its own window (Electron), the same
 * game as the browser's, built and started by `npm run desktop` (see
 * tools/desktop.mjs). What it does that a browser tab can't:
 * - it never slows the game down behind other windows (no timer throttling or
 *   backgrounding: a multiplayer host keeps going at full speed);
 * - it uses the graphics card where Chrome's blocklist would draw in software;
 * - with a frame rate cap above the screen's refresh (or Unlimited) it starts
 *   with Chromium's frame-rate limit and V-sync off, so those frames are shown,
 *   not only made (the switches take only at launch: Settings offers a restart);
 * - it keeps saves in a file in its data folder (no browser quota, not cleared
 *   with a browser's site data), and syncs them with the browser version
 *   through a folder, Documents\Blueberry Playground (see src/engine/Sync.ts).
 * The game's files load from disk through the app:// scheme, a privileged one,
 * so storage, workers, WebAssembly and fetch behave as on a real site.
 */
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, screen, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ORIGIN = 'app://blueberry';
/** The built game, beside this file (see tools/desktop.mjs). */
const GAME = path.join(__dirname, 'game');
const SYNC_FILE = 'blueberry-sync.json';
/** The store is written to disk this long after a change (ms), with whatever else changed meanwhile. */
const WRITE_WAIT = 400;

const args = process.argv.slice(1);
/** --name=value: the value ('' for a bare --name), or null when not given. */
function flag(name) {
  const a = args.find((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  return a === undefined ? null : a.slice(name.length + 3);
}
const smoke = flag('smoke') !== null;
/** The self-check's cap (--fps=unlimited, display or a number), or null: the saved one. */
const smokeFps = (() => {
  const v = flag('fps');
  return v === 'display' || v === 'unlimited' ? v : Number(v) > 0 ? Number(v) : null;
})();

// a self-check keeps its data (and so its sync folder) apart from the player's: a temporary folder
if (smoke) app.setPath('userData', flag('data') || fs.mkdtempSync(path.join(os.tmpdir(), 'bp-smoke-')));
const dataDir = app.getPath('userData');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Writes beside the file and then swaps it in, so a crash or a full disk never leaves half a file. */
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      // (Windows: a virus scanner or a cloud drive may hold the old file for a moment)
      if (i < 5 && ['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
        continue;
      }
      fs.rmSync(tmp, { force: true });
      throw e;
    }
  }
}

// ---- what went wrong (the page's errors, a hang, a crash), kept for the player to send in

const logFile = path.join(dataDir, 'log.txt');
/** The log moves to log-old.txt once it's this big (bytes). */
const LOG_MOST = 512 * 1024;
/** Lines kept a session at most (a page erring every frame would fill the disk). */
const LOG_LINES = 300;
let logged = 0;
let lastLogged = '';

/** Adds a line, with the time, to log.txt in the data folder (a line the same as the last is left out). */
function log(text) {
  const line = String(text).slice(0, 4000);
  if (line === lastLogged || ++logged > LOG_LINES) return;
  lastLogged = line;
  try {
    if ((fs.statSync(logFile, { throwIfNoEntry: false })?.size ?? 0) > LOG_MOST) fs.renameSync(logFile, path.join(dataDir, 'log-old.txt'));
    fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // (nowhere to write it: it goes unkept)
  }
}

// ---- the app's own settings: the window's place, the sync folder, the screen's refresh last seen

const configFile = path.join(dataDir, 'desktop.json');
const config = readJson(configFile) ?? {};
const saveConfig = () => {
  try {
    writeAtomic(configFile, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error(e);
  }
};

// ---- the game's store (see src/engine/Store.ts): every key and value, in one file

const storeFile = path.join(dataDir, 'blueberry-store.json');
const values = {};
for (const [k, v] of Object.entries(readJson(storeFile)?.values ?? {})) if (typeof v === 'string') values[k] = v;
let writeTimer = null;

function saveStore() {
  clearTimeout(writeTimer);
  writeTimer = null;
  try {
    writeAtomic(storeFile, JSON.stringify({ blueberryStore: 1, values }));
  } catch (e) {
    console.error('The saves could not be written:', e);
  }
}

function applyChanges(changes) {
  if (!changes || typeof changes !== 'object') return false;
  let any = false;
  for (const [k, v] of Object.entries(changes)) {
    if (typeof v === 'string') values[k] = v;
    else if (v === null) delete values[k];
    else continue;
    any = true;
  }
  return any;
}

// ---- the frame rate: Chromium's limit and V-sync are set at launch, from the saved cap

/** A cap the screen can't show at its refresh rate: the frame-rate limit and V-sync must be off for it. */
const pastRefresh = (cap, hz) => cap === 'unlimited' || (typeof cap === 'number' && cap > hz * 1.05);

function savedCap() {
  try {
    return JSON.parse(values['blueberry-graphics'] ?? '{}').fps ?? 'display';
  } catch {
    return 'display';
  }
}

// (the screen's refresh isn't known before the app is ready: the one seen last time)
const uncapped = pastRefresh(smoke && smokeFps !== null ? smokeFps : savedCap(), config.displayHz || 60);

// never held back: not behind other windows, not minimized
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// the graphics card even where Chrome's list of troublesome ones would draw in software
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// the physics engine's WebAssembly all optimized in the background soon after it loads,
// not each function once it's run a while: the first time 100 people are crushed runs
// code nothing ran before, and ran it unoptimized (its worst steps a quarter slower)
app.commandLine.appendSwitch('js-flags', '--no-wasm-dynamic-tiering');
if (uncapped) {
  app.commandLine.appendSwitch('disable-frame-rate-limit');
  app.commandLine.appendSwitch('disable-gpu-vsync');
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/** app://blueberry/<path>: the game's file at that path (never one outside its folder), or a part of it (audio asks for parts). */
async function serve(req) {
  const missing = () => new Response('Not found', { status: 404 });
  let file;
  try {
    const url = new URL(req.url);
    if (url.host !== 'blueberry') return missing();
    const rel = decodeURIComponent(url.pathname);
    file = path.join(GAME, rel === '/' ? 'index.html' : rel);
  } catch {
    return missing();
  }
  if (!file.startsWith(GAME + path.sep)) return missing();
  let data;
  try {
    data = await fs.promises.readFile(file);
  } catch {
    return missing();
  }
  const headers = {
    'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    // cross-origin isolated, so the physics engine's threads can share memory (see vite.config.ts)
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, data.length - Number(range[2]));
    const end = Math.min(range[1] && range[2] ? Number(range[2]) : data.length - 1, data.length - 1);
    if (start >= data.length || end < start) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${data.length}` } });
    return new Response(data.subarray(start, end + 1), { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${data.length}` } });
  }
  return new Response(data, { headers });
}

// ---- the window

let win = null;
/** The refresh rate of the screen the window is on (Hz). */
let hz = config.displayHz || 60;
let smokeFailed = false;

/** Whether a saved place for the window is still on a screen (one may have been unplugged). */
function onScreen(b) {
  if (![b?.x, b?.y, b?.width, b?.height].every(Number.isFinite)) return false;
  return screen.getAllDisplays().some(({ workArea: a }) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) >= 64 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) >= 64);
}

const hzOf = () => Math.round(screen.getDisplayMatching(win.getBounds()).displayFrequency) || 60;

/** A link out of the game opens in the system's browser; nothing but the game opens in the window. */
function openOutside(url) {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

function createWindow() {
  const saved = smoke ? null : config.window;
  const place = onScreen(saved) ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : { width: 1280, height: 800 };
  win = new BrowserWindow({
    ...place,
    minWidth: 640,
    minHeight: 400,
    show: false,
    backgroundColor: '#16171a',
    title: 'Blueberry Playground',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  if (saved?.maximized) win.maximize();
  if (saved?.fullscreen) win.setFullScreen(true);
  hz = hzOf();
  win.once('ready-to-show', () => win.show());

  win.on('moved', () => {
    const now = hzOf();
    if (now === hz) return;
    hz = now;
    win.webContents.send('display-hz', hz);
  });
  win.on('close', () => {
    if (smoke) return;
    config.window = { ...win.getNormalBounds(), maximized: win.isMaximized(), fullscreen: win.isFullScreen() };
    config.displayHz = hz;
    saveConfig();
  });
  win.on('closed', () => (win = null));

  const page = win.webContents;
  page.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    } else if (input.key === 'F12' && !app.isPackaged) {
      page.toggleDevTools();
      e.preventDefault();
    }
  });
  page.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: 'deny' };
  });
  page.on('will-navigate', (e, url) => {
    if (url.startsWith(`${ORIGIN}/`)) return;
    e.preventDefault();
    openOutside(url);
  });
  // what goes wrong goes in the log (see log()); a hang or a crash offers to start the game again
  page.on('console-message', (e) => {
    if (e.level === 'error') log(`[page] ${e.message}`);
  });
  let waiting = null;
  let restarting = false;
  win.on('unresponsive', () => {
    log('the game stopped responding');
    if (smoke || waiting) return;
    waiting = new AbortController();
    void dialog
      .showMessageBox(win, {
        type: 'warning',
        title: 'Blueberry Playground',
        message: 'The game isn’t responding',
        detail: `It may come back by itself. Restart starts it again (the scene in the sandbox is lost). What happened is noted in ${logFile}.`,
        buttons: ['Wait', 'Restart'],
        defaultId: 0,
        cancelId: 0,
        signal: waiting.signal,
      })
      .then((r) => {
        waiting = null;
        if (r.response !== 1 || !win) return;
        log('restarted by the player');
        restarting = true;
        page.forcefullyCrashRenderer();
        page.reload();
      });
  });
  win.on('responsive', () => {
    log('the game responds again');
    waiting?.abort();
  });
  page.on('render-process-gone', (_e, d) => {
    log(`the game's page died (${d.reason}, exit code ${d.exitCode})`);
    if (smoke || d.reason === 'clean-exit' || restarting) {
      restarting = false;
      return;
    }
    void dialog
      .showMessageBox(win, {
        type: 'error',
        title: 'Blueberry Playground',
        message: 'The game crashed',
        detail: `(${d.reason}) Restart starts it again. What happened is noted in ${logFile}.`,
        buttons: ['Restart', 'Quit'],
        defaultId: 0,
      })
      .then((r) => {
        if (!win) return;
        if (r.response === 0) page.reload();
        else app.quit();
      });
  });
  if (smoke) {
    page.on('console-message', (e) => {
      if (e.level === 'error') console.error(`[page] ${e.message}`);
    });
    page.on('render-process-gone', (_e, d) => {
      console.error(`smoke: the page died (${d.reason})`);
      app.exit(1);
    });
    page.on('did-fail-load', (_e, code, desc, url) => {
      console.error(`smoke: ${url} failed to load (${code} ${desc})`);
      app.exit(1);
    });
  }
  void win.loadURL(`${ORIGIN}/index.html`);
}

// ---- what the page asks of the app (desktop/preload.cjs passes it on)

/** Only the game's own window is answered. */
const ours = (e) => !!win && e.sender === win.webContents;

/** The folder saves sync through: Documents\Blueberry Playground unless the player picked another, or unlinked it (null). */
function syncFolder() {
  if (smoke) return path.join(dataDir, 'sync');
  if (config.syncFolder === null) return null;
  return typeof config.syncFolder === 'string' ? config.syncFolder : path.join(app.getPath('documents'), 'Blueberry Playground');
}

function readSync() {
  const folder = syncFolder();
  if (!folder) return null;
  try {
    return fs.readFileSync(path.join(folder, SYNC_FILE), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function writeSync(text) {
  const folder = syncFolder();
  if (folder && typeof text === 'string') writeAtomic(path.join(folder, SYNC_FILE), text);
}

ipcMain.on('desktop:info', (e) => {
  e.returnValue = ours(e)
    ? {
        version: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        displayHz: hz,
        uncapped,
        smoke: smoke ? { fps: smokeFps, bench: flag('bench') !== null } : null,
        dataDir,
      }
    : null;
});

ipcMain.on('store:load', (e) => {
  e.returnValue = ours(e) ? values : {};
});
ipcMain.on('store:write', (e, changes) => {
  if (ours(e) && applyChanges(changes)) writeTimer ??= setTimeout(saveStore, WRITE_WAIT);
});
ipcMain.on('store:flush', (e, changes) => {
  if (ours(e) && (applyChanges(changes) || writeTimer)) saveStore();
  e.returnValue = true;
});
ipcMain.on('store:readBack', (e, key) => {
  e.returnValue = ours(e) ? (readJson(storeFile)?.values?.[key] ?? null) : null;
});

ipcMain.handle('fps:cap', (e, cap) => ours(e) && pastRefresh(cap, hz) !== uncapped);
ipcMain.on('app:restart', (e) => {
  if (!ours(e) || smoke) return;
  // (the portable app runs from a copy unpacked in a temporary folder: it starts again from the .exe itself)
  const exe = process.env.PORTABLE_EXECUTABLE_FILE;
  app.relaunch(exe ? { execPath: exe, args: [] } : undefined);
  app.quit();
});

ipcMain.handle('sync:folder', (e) => (ours(e) ? syncFolder() : null));
ipcMain.handle('sync:choose', async (e) => {
  if (!ours(e)) return null;
  const r = await dialog.showOpenDialog(win, {
    title: 'The folder to sync saves through',
    defaultPath: syncFolder() ?? app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  config.syncFolder = r.filePaths[0];
  saveConfig();
  return config.syncFolder;
});
ipcMain.handle('sync:unlink', (e) => {
  if (!ours(e)) return;
  config.syncFolder = null;
  saveConfig();
});
ipcMain.handle('sync:read', (e) => (ours(e) ? readSync() : null));
ipcMain.handle('sync:write', (e, text) => {
  if (ours(e)) writeSync(text);
});
ipcMain.on('sync:readNow', (e) => {
  try {
    e.returnValue = ours(e) ? readSync() : null;
  } catch {
    e.returnValue = null;
  }
});
ipcMain.on('sync:writeNow', (e, text) => {
  try {
    if (ours(e)) writeSync(text);
  } catch (err) {
    console.error(err);
  }
  e.returnValue = true;
});
ipcMain.on('sync:reveal', (e) => {
  const folder = syncFolder();
  if (!ours(e) || !folder) return;
  fs.mkdirSync(folder, { recursive: true });
  void shell.openPath(folder);
});

ipcMain.on('smoke:done', (e, report) => {
  if (!ours(e) || !smoke) return;
  console.log(JSON.stringify(report, null, 2));
  smokeFailed = !!report?.error || JSON.stringify(report).includes('FAILED');
  app.quit();
});

// ---- the app

// (one copy at a time: two would write over each other's saves; a self-check has its own data folder)
if (!smoke && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.setAppUserModelId('com.blueberryplayground.app');
  app.on('child-process-gone', (_e, d) => log(`the ${d.type} process died (${d.reason}, exit code ${d.exitCode})`));
  app.whenReady().then(() => {
    log(`Blueberry Playground ${app.getVersion()} started: Electron ${process.versions.electron}, ${os.type()} ${os.release()} ${os.arch()}, ${os.cpus().length} logical processors`);
    // (none on Windows; a Mac's app menu, with Quit, Hide and copy and paste)
    Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
    protocol.handle('app', serve);
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    if (writeTimer) saveStore();
    if (smoke) process.exitCode = smokeFailed ? 1 : 0;
  });
  // (a self-check that never reports has failed)
  if (smoke) {
    setTimeout(() => {
      console.error('smoke: no report after 120 s');
      app.exit(1);
    }, 120000).unref();
  }
}
