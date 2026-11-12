'use strict';
// Nan's desktop apps: one small Windows shell per app.
// The shell opens the app's live address, so every web update reaches the desktop app
// the next time it opens. The app's own service worker keeps it working offline.
// The shell itself updates through electron-updater from the public releases of nansan1/desktop.

const { app, BrowserWindow, Menu, shell, dialog, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');

const pkg = require('../package.json');
const APPS = require('../apps.json');
const ID = process.env.DESKTOP_APP || pkg.desktopApp || 'keel';
const CFG = APPS[ID];
if (!CFG) throw new Error('Unknown desktop app: ' + ID);
const APP_URL = process.env.DESKTOP_URL || CFG.url; // DESKTOP_URL is only for local testing
const ORIGIN = new URL(APP_URL).origin;
const SHELL_VERSION = app.getVersion();

app.setName(CFG.name);
if (process.platform === 'win32') app.setAppUserModelId('com.nan2nan.' + ID);

// Sign-in pages (Helm's Google and Outlook connect) refuse apps that say "Electron".
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/\S+/, '')
  .replace(new RegExp('\\s' + CFG.name + '\\/\\S+'), '')
  .replace(/\snan-desktop\/\S+/, '');

const AUTH_HOSTS = /(^|\.)(accounts\.google\.com|google\.com|gstatic\.com|login\.microsoftonline\.com|login\.live\.com|microsoft\.com|live\.com|appleid\.apple\.com)$/i;
const OTHER_APPS = Object.entries(APPS)
  .filter(([k]) => k !== ID)
  .map(([k, a]) => ({ id: k, origin: new URL(a.url).origin, protocol: a.protocol, name: a.name }));

let win = null;
let pendingFiles = [];
let rendererReady = false;

// ---------- one copy of each app at a time ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    handleArgs(argv);
  });
}

// ---------- links from other apps (nan-keel://open?u=...) and double-clicked files ----------
function setProtocol() {
  try {
    if (process.defaultApp && process.argv.length >= 2) {
      app.setAsDefaultProtocolClient(CFG.protocol, process.execPath, [path.resolve(process.argv[1])]);
    } else {
      app.setAsDefaultProtocolClient(CFG.protocol);
    }
  } catch (e) { /* not fatal */ }
}

function openExts() { return (CFG.files || []).map(f => f.ext).concat(CFG.openAlso || []); }

function handleArgs(argv) {
  for (const a of argv.slice(1)) {
    if (!a || a.startsWith('--')) continue;
    if (a.toLowerCase().startsWith(CFG.protocol + '://')) { openProtocolUrl(a); continue; }
    const ext = path.extname(a).slice(1).toLowerCase();
    if (ext && openExts().includes(ext) && fs.existsSync(a)) queueFile(a);
  }
}

function openProtocolUrl(raw) {
  try {
    const u = new URL(raw).searchParams.get('u');
    if (!u || new URL(u).origin !== ORIGIN || !win) return;
    const cur = new URL(win.webContents.getURL() || APP_URL);
    const next = new URL(u);
    if (cur.origin === next.origin && cur.pathname === next.pathname) {
      // Only the #part changed (Helm links): set it and reload so the app reads it on start.
      win.webContents.executeJavaScript('location.hash=' + JSON.stringify(next.hash) + ';location.reload()').catch(() => win.loadURL(u));
    } else {
      win.loadURL(u);
    }
  } catch (e) { /* ignore bad links */ }
}

function queueFile(p) {
  pendingFiles.push(p);
  flushFiles();
}

function flushFiles() {
  if (!win || !rendererReady || !CFG.bridge) return;
  while (pendingFiles.length) {
    const p = pendingFiles.shift();
    try {
      const buf = fs.readFileSync(p);
      const name = path.basename(p);
      const f = CFG.fileFormat === 'text' ? { name, text: buf.toString('utf8') } : { name, data: buf.toString('base64') };
      win.webContents.send('open-file', f);
    } catch (e) {
      dialog.showMessageBox(win, { type: 'error', message: 'Could not open ' + path.basename(p), detail: String(e.message || e) });
    }
  }
}

// ---------- opening links ----------
function otherAppFor(url) {
  try { const o = new URL(url).origin; return OTHER_APPS.find(a => a.origin === o) || null; } catch (e) { return null; }
}

function handOff(url) {
  const other = otherAppFor(url);
  if (other) {
    // If that app's Windows app is installed, open the link there; otherwise in the browser.
    let installed = '';
    try { installed = app.getApplicationNameForProtocol(other.protocol + '://'); } catch (e) {}
    if (installed) return shell.openExternal(other.protocol + '://open?u=' + encodeURIComponent(url));
  }
  if (/^(https?|mailto|tel):/i.test(url)) return shell.openExternal(url);
}

function isAuthUrl(url) {
  try { return AUTH_HOSTS.test(new URL(url).hostname); } catch (e) { return false; }
}

function sameOrigin(url) {
  try { return new URL(url).origin === ORIGIN; } catch (e) { return false; }
}

// ---------- window ----------
const stateFile = () => path.join(app.getPath('userData'), 'window.json');
function loadState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return {}; } }
function saveState() {
  if (!win) return;
  try {
    const s = { maximized: win.isMaximized(), bounds: win.isMaximized() ? (loadState().bounds || win.getBounds()) : win.getBounds() };
    fs.writeFileSync(stateFile(), JSON.stringify(s));
  } catch (e) {}
}

function iconPath() {
  const p = path.join(__dirname, '..', 'build', 'icons', CFG.icon + '.png');
  return fs.existsSync(p) ? p : undefined;
}

function webPrefs() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: true,
    additionalArguments: [
      '--nan-app=' + ID, '--nan-origin=' + ORIGIN, '--nan-version=' + SHELL_VERSION,
      '--nan-name=' + encodeURIComponent(CFG.name), '--nan-bridge=' + (CFG.bridge || ''),
      '--nan-save=' + (CFG.saveBackup ? '1' : '0'), '--nan-print=' + (CFG.printPdf ? '1' : '0')
    ]
  };
}

function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    width: (st.bounds && st.bounds.width) || 1280,
    height: (st.bounds && st.bounds.height) || 840,
    x: st.bounds && st.bounds.x,
    y: st.bounds && st.bounds.y,
    minWidth: 480,
    minHeight: 400,
    title: CFG.name,
    icon: iconPath(),
    autoHideMenuBar: true,
    backgroundColor: '#FFF4FA',
    show: false,
    webPreferences: webPrefs()
  });
  if (st.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  ['resize', 'move', 'close'].forEach(ev => win.on(ev, saveState));
  win.on('closed', () => { win = null; });

  const wc = win.webContents;

  wc.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url.startsWith('blob:') || sameOrigin(url)) {
      // the app's own windows (Spinnaker's audience window, previews)
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: iconPath(), webPreferences: webPrefs() } };
    }
    handOff(url);
    return { action: 'deny' };
  });

  wc.on('will-navigate', (e, url) => {
    if (sameOrigin(url) || isAuthUrl(url) || url.startsWith('file:')) return;
    e.preventDefault();
    handOff(url);
  });

  wc.on('did-start-navigation', (_e, url, inPage, isMain) => { if (isMain && !inPage) rendererReady = false; });
  wc.on('did-finish-load', () => {
    if (sameOrigin(wc.getURL())) { rendererReady = true; setTimeout(flushFiles, 300); }
  });

  wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return; // -3 = navigation replaced, not an error
    if (!sameOrigin(url)) return;
    win.loadFile(path.join(__dirname, 'offline.html'), { query: { name: CFG.name, err: desc || String(code) } });
  });

  wc.on('page-title-updated', (e, title) => {
    e.preventDefault();
    win.setTitle(title && title !== 'offline' ? title : CFG.name);
  });

  wc.on('context-menu', (_e, p) => contextMenu(p));

  win.loadURL(APP_URL);
}

// ---------- right-click menu (spelling, cut, copy, paste) ----------
function contextMenu(p) {
  const t = [];
  if (p.misspelledWord) {
    (p.dictionarySuggestions || []).slice(0, 6).forEach(s => t.push({ label: s, click: () => win.webContents.replaceMisspelling(s) }));
    if (!(p.dictionarySuggestions || []).length) t.push({ label: 'No suggestions', enabled: false });
    t.push({ label: 'Add to dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
    t.push({ type: 'separator' });
  }
  if (p.linkURL && !p.linkURL.startsWith('javascript:')) {
    t.push({ label: 'Open link', click: () => (sameOrigin(p.linkURL) ? win.loadURL(p.linkURL) : handOff(p.linkURL)) });
    t.push({ label: 'Copy link', click: () => require('electron').clipboard.writeText(p.linkURL) });
    t.push({ type: 'separator' });
  }
  if (p.isEditable) {
    t.push({ role: 'undo', enabled: p.editFlags.canUndo }, { role: 'redo', enabled: p.editFlags.canRedo }, { type: 'separator' });
    t.push({ role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste }, { role: 'pasteAndMatchStyle', label: 'Paste as plain text', enabled: p.editFlags.canPaste }, { role: 'selectAll' });
  } else if (p.selectionText && p.selectionText.trim()) {
    t.push({ role: 'copy' });
  }
  if (p.mediaType === 'image' && p.srcURL) {
    t.push({ label: 'Copy image', click: () => win.webContents.copyImageAt(p.x, p.y) });
  }
  if (!t.length) t.push({ label: 'Reload', click: () => win.webContents.reload() });
  while (t.length && t[t.length - 1].type === 'separator') t.pop();
  Menu.buildFromTemplate(t).popup({ window: win });
}

// ---------- menu bar (hidden; press Alt to show) ----------
function buildMenu() {
  const tpl = [
    { label: 'File', submenu: [
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => win && (sameOrigin(win.webContents.getURL()) ? win.webContents.reload() : win.loadURL(APP_URL)) },
      { label: 'Go to start', click: () => win && win.loadURL(APP_URL) },
      { type: 'separator' },
      { label: 'Check for desktop updates', click: () => checkUpdates(true) },
      { type: 'separator' },
      { role: 'quit', label: 'Quit ' + CFG.name }
    ] },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'pasteAndMatchStyle', label: 'Paste as plain text' }, { role: 'selectAll' }
    ] },
    { label: 'View', submenu: [
      { role: 'resetZoom', label: 'Actual size' }, { role: 'zoomIn', label: 'Zoom in' }, { role: 'zoomIn', accelerator: 'CmdOrCtrl+=', visible: false }, { role: 'zoomOut', label: 'Zoom out' },
      { type: 'separator' },
      { label: 'Full screen', accelerator: 'F11', click: () => win && win.setFullScreen(!win.isFullScreen()) },
      { type: 'separator' },
      { role: 'toggleDevTools', label: 'Developer tools' }
    ] },
    { label: 'Help', submenu: [
      { label: 'About ' + CFG.name + ' for Windows', click: about },
      { label: 'Open ' + CFG.name + ' in the browser', click: () => shell.openExternal(APP_URL) }
    ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

function about() {
  dialog.showMessageBox(win, {
    type: 'info',
    title: 'About ' + CFG.name,
    message: CFG.name + ' for Windows',
    detail: 'Desktop shell ' + SHELL_VERSION + '\n\nThe app itself loads from ' + APP_URL + ', so it is always the latest version (its version number is in the app\'s own settings). The shell updates itself; you never need to download it again.'
  });
}

// ---------- shell updates ----------
let updater = null;
let manualCheck = false;
function setupUpdater() {
  if (!app.isPackaged || process.env.DESKTOP_NO_UPDATES) return;
  try { updater = require('electron-updater').autoUpdater; } catch (e) { return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on('update-not-available', () => {
    if (manualCheck) dialog.showMessageBox(win, { type: 'info', message: CFG.name + ' for Windows is up to date', detail: 'Desktop shell ' + SHELL_VERSION + '.' });
    manualCheck = false;
  });
  updater.on('update-available', info => {
    if (manualCheck) dialog.showMessageBox(win, { type: 'info', message: 'Downloading desktop update ' + info.version, detail: 'You can keep working. You will be asked to restart when it is ready.' });
    manualCheck = false;
  });
  updater.on('error', err => {
    if (manualCheck) dialog.showMessageBox(win, { type: 'warning', message: 'Could not check for desktop updates', detail: String((err && err.message) || err).slice(0, 400) });
    manualCheck = false;
  });
  updater.on('update-downloaded', async info => {
    const r = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: 'Desktop update ' + info.version + ' is ready',
      detail: 'Restart ' + CFG.name + ' to finish. Everything you have done is already saved. If you choose Later, it installs the next time you close ' + CFG.name + '.'
    });
    if (r.response === 0) setImmediate(() => updater.quitAndInstall(true, true));
  });
  setTimeout(() => checkUpdates(false), 8000);
  setInterval(() => checkUpdates(false), 6 * 60 * 60 * 1000);
}

function checkUpdates(manual) {
  if (!updater) {
    if (manual) dialog.showMessageBox(win, { type: 'info', message: 'Updates work in the installed app only.' });
    return;
  }
  manualCheck = manual;
  updater.checkForUpdates().catch(() => {});
}

// ---------- the app's desktop features ----------
ipcMain.handle('save-backup', async (e, name, bytes) => {
  const w = BrowserWindow.fromWebContents(e.sender) || win;
  const r = await dialog.showSaveDialog(w, { defaultPath: path.join(app.getPath('documents'), String(name || 'backup')) });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(bytes));
  return r.filePath;
});

ipcMain.handle('print-pdf', async (e, o) => {
  const w = BrowserWindow.fromWebContents(e.sender) || win;
  o = o || {};
  const data = await e.sender.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
    pageSize: o.w && o.h ? { width: Number(o.w), height: Number(o.h) } : 'Letter',
    margins: { top: 0, bottom: 0, left: 0, right: 0 }
  });
  const r = await dialog.showSaveDialog(w, { defaultPath: path.join(app.getPath('documents'), String(o.name || CFG.name + '.pdf')), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return false;
  fs.writeFileSync(r.filePath, data);
  return true;
});

ipcMain.on('retry', () => { if (win) win.loadURL(APP_URL); });
ipcMain.on('renderer-ready', () => { rendererReady = true; setTimeout(flushFiles, 100); });

// ---------- start ----------
app.whenReady().then(() => {
  setProtocol();
  buildMenu();
  // Downloads ask where to save, starting in Downloads.
  session.defaultSession.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
  });
  createWindow();
  handleArgs(process.argv);
  setupUpdater();
});

app.on('window-all-closed', () => app.quit());
