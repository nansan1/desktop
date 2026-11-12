'use strict';
// Gives each app the same desktop bridge its old Windows app had
// (window.holdfastDesktop, gwDesktop, deskDesktop, spkDesktop), but only on the app's own address.
const { contextBridge, ipcRenderer } = require('electron');

const arg = k => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : ''; };
const ID = arg('nan-app');
const ORIGIN = arg('nan-origin');
const VERSION = arg('nan-version');
// sandboxed preloads cannot read files, so the shell passes what it needs as arguments
const CFG = { name: decodeURIComponent(arg('nan-name')), bridge: arg('nan-bridge'), saveBackup: arg('nan-save') === '1', printPdf: arg('nan-print') === '1' };

if (location.protocol === 'file:') {
  // the "can't reach the app" page
  contextBridge.exposeInMainWorld('nanShell', { retry: () => ipcRenderer.send('retry'), name: CFG.name || '' });
} else if (location.origin === ORIGIN && window === window.top) {
  const handlers = [];
  const queue = [];
  ipcRenderer.on('open-file', (_e, f) => { if (handlers.length) handlers.forEach(h => { try { h(f); } catch (e) {} }); else queue.push(f); });

  const info = { app: ID, shellVersion: VERSION, platform: 'windows' };
  contextBridge.exposeInMainWorld('nanDesktop', info);

  if (CFG.bridge) {
    const bridge = {
      shellVersion: VERSION,
      onOpenFile: cb => {
        if (typeof cb !== 'function') return;
        handlers.push(cb);
        while (queue.length) { const f = queue.shift(); try { cb(f); } catch (e) {} }
        ipcRenderer.send('renderer-ready');
      }
    };
    if (CFG.saveBackup) bridge.saveBackup = (name, bytes) => ipcRenderer.invoke('save-backup', String(name), bytes);
    if (CFG.printPdf) bridge.printPdf = o => ipcRenderer.invoke('print-pdf', o && { name: String(o.name || ''), w: Number(o.w) || 0, h: Number(o.h) || 0 });
    contextBridge.exposeInMainWorld(CFG.bridge, bridge);
  }
}
