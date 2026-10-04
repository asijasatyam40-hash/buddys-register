// Buddy's Register — Windows app.
// Opens the register screen full screen, talks to the receipt printer and cash drawer,
// and keeps itself up to date from GitHub Releases. Updates install when the register
// is closed, or overnight when nobody is signed in — never in the middle of a sale.
const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const printer = require('./printer');

let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch (e) { autoUpdater = null; }

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const DEFAULTS = { mode: 'raw', printerName: '', ip: '', port: 9100, width: 42, autoPrint: true, drawerOnCash: true, kiosk: true, autoStart: true };
const settingsFile = () => path.join(app.getPath('userData'), 'hardware.json');
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch (e) { return { ...DEFAULTS }; }
}
function applyAutoStart(s) {
  if (!app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: !!s.autoStart }); } catch (e) { /* not allowed on this PC */ }
}

let win = null, settings = loadSettings(), busy = false, signedIn = false, updateReady = null, forceQuit = false;
const logFile = () => path.join(app.getPath('userData'), 'register.log');
function log(msg) { try { fs.appendFileSync(logFile(), `${new Date().toISOString()} ${msg}\n`); } catch (e) { /* ignore */ } }

function createWindow() {
  win = new BrowserWindow({
    width: 1024, height: 768, minWidth: 800, minHeight: 600,
    fullscreen: !!settings.kiosk, kiosk: !!settings.kiosk,
    autoHideMenuBar: true, backgroundColor: '#13253b', title: "Buddy's Register",
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'register.html'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.on('close', e => {
    if (!forceQuit && busy) { e.preventDefault(); win.webContents.send('hw:close-blocked'); }
  });
  win.on('closed', () => { win = null; });
}

/* ---------- updates ---------- */
function setupUpdates() {
  if (!app.isPackaged || !autoUpdater) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', info => {
    updateReady = info.version; log(`update ${info.version} downloaded`);
    if (win) win.webContents.send('hw:update-ready', info.version);
  });
  autoUpdater.on('error', e => log(`update error: ${e && e.message}`));
  const check = () => autoUpdater.checkForUpdates().catch(e => log(`update check failed: ${e && e.message}`));
  setTimeout(check, 20 * 1000);
  setInterval(check, 4 * 60 * 60 * 1000);
  // Overnight install: between 3 and 5 AM, if an update is ready and nobody is signed in.
  setInterval(() => {
    const h = new Date().getHours();
    if (updateReady && !busy && !signedIn && h >= 3 && h < 5) { log('installing update overnight'); forceQuit = true; autoUpdater.quitAndInstall(true, true); }
  }, 10 * 60 * 1000);
}

/* ---------- bridge for the register screen ---------- */
ipcMain.handle('hw:info', () => ({ version: app.getVersion(), packaged: app.isPackaged, updateReady, settings }));
ipcMain.handle('hw:printers', async () => {
  try { return (await win.webContents.getPrintersAsync()).map(p => ({ name: p.name, isDefault: !!p.isDefault })); } catch (e) { return []; }
});
ipcMain.handle('hw:save-settings', (e, s) => {
  const kioskChanged = !!s.kiosk !== !!settings.kiosk;
  settings = { ...DEFAULTS, ...s, port: Number(s.port) || 9100, width: Number(s.width) || 42 };
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 1));
  applyAutoStart(settings);
  if (kioskChanged && win) { win.setKiosk(!!settings.kiosk); win.setFullScreen(!!settings.kiosk); }
  return settings;
});
ipcMain.handle('hw:print', async (e, job) => {
  try { await printer.print(settings, job, win); return { ok: true }; }
  catch (err) { log(`print failed: ${err.message}`); return { ok: false, error: err.message }; }
});
ipcMain.handle('hw:drawer', async () => {
  try { await printer.drawer(settings); return { ok: true }; }
  catch (err) { log(`drawer failed: ${err.message}`); return { ok: false, error: err.message }; }
});
ipcMain.on('hw:state', (e, st) => { busy = !!st.busy; signedIn = !!st.signedIn; });
ipcMain.handle('hw:install-update', () => {
  if (!updateReady || busy || !autoUpdater) return false;
  forceQuit = true; setImmediate(() => autoUpdater.quitAndInstall(true, true)); return true;
});
ipcMain.handle('hw:quit', () => { if (busy) return false; forceQuit = true; app.quit(); return true; });

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => { applyAutoStart(settings); createWindow(); setupUpdates(); log(`started ${app.getVersion()}`); });
app.on('window-all-closed', () => app.quit());
