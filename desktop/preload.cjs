'use strict';
/**
 * The page's only way to the desktop app (see desktop/main.cjs): window.desktop,
 * described in src/engine/Desktop.ts. The saves are read here, before the
 * game's scripts run, so the game finds them as it would localStorage's.
 */
const { contextBridge, ipcRenderer } = require('electron');

const info = ipcRenderer.sendSync('desktop:info');
const kept = ipcRenderer.sendSync('store:load');

if (info) {
  contextBridge.exposeInMainWorld('desktop', {
    ...info,
    store: {
      load: () => kept,
      write: (changes) => ipcRenderer.send('store:write', changes),
      flush: (changes) => void ipcRenderer.sendSync('store:flush', changes),
      readBack: (key) => ipcRenderer.sendSync('store:readBack', key),
    },
    sync: {
      folder: () => ipcRenderer.invoke('sync:folder'),
      choose: () => ipcRenderer.invoke('sync:choose'),
      unlink: () => ipcRenderer.invoke('sync:unlink'),
      read: () => ipcRenderer.invoke('sync:read'),
      write: (text) => ipcRenderer.invoke('sync:write', text),
      readNow: () => ipcRenderer.sendSync('sync:readNow'),
      writeNow: (text) => void ipcRenderer.sendSync('sync:writeNow', text),
      reveal: () => ipcRenderer.send('sync:reveal'),
    },
    frameCap: (cap) => ipcRenderer.invoke('fps:cap', cap),
    restart: () => ipcRenderer.send('app:restart'),
    onDisplayHz: (fn) => void ipcRenderer.on('display-hz', (_e, hz) => fn(hz)),
    smokeDone: (report) => ipcRenderer.send('smoke:done', report),
  });
}
