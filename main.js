// Buddy's Register — Windows app.
// Opens the register screen full screen, talks to the receipt printer and cash drawer,
// and keeps itself up to date — any time of day, but never in the middle of a sale:
//   • Screen updates: every 5 minutes it checks GitHub for a newer register.html.
//     When no ticket or pop-up is open, the screen refreshes itself in about a second.
//   • App updates (new installer on GitHub Releases): downloaded in the background,
//     then the app restarts by itself once the register has been idle for a minute.
const { app, BrowserWindow, ipcMain, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');
const printer = require('./printer');

let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch (e) { autoUpdater = null; }

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// Where the newest register screen lives (the public GitHub repository).
const SCREEN_URL = 'https://raw.githubusercontent.com/asijasatyam40-hash/buddys-register/main/register.html';
const SCREEN_EVERY = 5 * 60 * 1000;
const IDLE_BEFORE_RESTART = 60 * 1000;

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
let idleSince = Date.now();
const logFile = () => path.join(app.getPath('userData'), 'register.log');
function log(msg) { try { fs.appendFileSync(logFile(), `${new Date().toISOString()} ${msg}\n`); } catch (e) { /* ignore */ } }

/* ---------- which register screen to show ---------- */
const bundledScreen = () => path.join(__dirname, 'register.html');
const downloadedScreen = () => path.join(app.getPath('userData'), 'screen', 'register.html');
const versionOf = html => { const m = /BUDDYS_SCREEN_VERSION\s*=\s*'([\d.]+)'/.exec(html || ''); return m ? m[1] : '0'; };
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
const readSafe = p => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } };
function bestScreen() {
  const b = versionOf(readSafe(bundledScreen())), d = versionOf(readSafe(downloadedScreen()));
  return newer(d, b) ? { file: downloadedScreen(), version: d } : { file: bundledScreen(), version: b };
}
let shown = { file: '', version: '0' }, waitingScreen = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1024, height: 768, minWidth: 800, minHeight: 600,
    fullscreen: !!settings.kiosk, kiosk: !!settings.kiosk,
    autoHideMenuBar: true, backgroundColor: '#13253b', title: "Buddy's Register",
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  shown = bestScreen();
  win.loadFile(shown.file);
  // If a downloaded screen ever fails to load, fall back to the one that came with the app.
  win.webContents.on('did-fail-load', () => { if (shown.file !== bundledScreen()) { log('downloaded screen failed, using built-in'); shown = { file: bundledScreen(), version: versionOf(readSafe(bundledScreen())) }; win.loadFile(shown.file); } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.on('close', e => {
    if (!forceQuit && busy) { e.preventDefault(); win.webContents.send('hw:close-blocked'); }
  });
  win.on('closed', () => { win = null; });
}

/* ---------- screen updates (fast, no reinstall) ---------- */
async function checkScreen() {
  try {
    const res = await net.fetch(`${SCREEN_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return { ok: false, msg: `GitHub said ${res.status}` };
    const html = await res.text();
    const v = versionOf(html);
    if (!html.includes('</html>') || !html.includes('buddysHW') || v === '0') return { ok: false, msg: 'Downloaded screen looked incomplete' };
    if (!newer(v, shown.version)) return { ok: true, msg: 'Screen is up to date', version: shown.version };
    fs.mkdirSync(path.dirname(downloadedScreen()), { recursive: true });
    fs.writeFileSync(downloadedScreen() + '.tmp', html);
    fs.renameSync(downloadedScreen() + '.tmp', downloadedScreen());
    waitingScreen = v; log(`screen ${v} downloaded`);
    if (win) win.webContents.send('hw:update-ready', `screen ${v}`);
    return { ok: true, msg: `Screen ${v} downloaded`, version: v };
  } catch (e) { return { ok: false, msg: e.message }; }
}
function applyScreen() {
  if (!waitingScreen || !win || busy) return false;
  const next = bestScreen();
  if (!newer(next.version, shown.version)) { waitingScreen = null; return false; }
  log(`showing screen ${next.version}`);
  shown = next; waitingScreen = null; win.loadFile(shown.file);
  return true;
}

/* ---------- app updates (installer) ---------- */
function setupUpdates() {
  if (!app.isPackaged || !autoUpdater) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-downloaded', info => {
    updateReady = info.version; log(`app update ${info.version} downloaded`);
    if (win) win.webContents.send('hw:update-ready', info.version);
  });
  autoUpdater.on('error', e => log(`update error: ${e && e.message}`));
  const check = () => autoUpdater.checkForUpdates().catch(e => log(`update check failed: ${e && e.message}`));
  setTimeout(check, 20 * 1000);
  setInterval(check, 30 * 60 * 1000);
}
function maybeRestartForUpdate() {
  if (!updateReady || !autoUpdater || busy) return;
  if (Date.now() - idleSince < IDLE_BEFORE_RESTART) return;
  log(`installing app update ${updateReady} while idle`);
  forceQuit = true; autoUpdater.quitAndInstall(true, true);
}
function startUpdateLoops() {
  setTimeout(checkScreen, 30 * 1000);
  setInterval(checkScreen, SCREEN_EVERY);
  setInterval(() => { applyScreen(); maybeRestartForUpdate(); }, 10 * 1000);
}

/* ---------- bridge for the register screen ---------- */
ipcMain.handle('hw:info', () => ({ version: app.getVersion(), screenVersion: shown.version, packaged: app.isPackaged, updateReady, screenReady: waitingScreen, settings }));
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
ipcMain.on('hw:state', (e, st) => {
  const wasBusy = busy;
  busy = !!st.busy; signedIn = !!st.signedIn;
  if (busy) idleSince = Infinity; else if (wasBusy || idleSince === Infinity) idleSince = Date.now();
  if (!busy) setTimeout(applyScreen, 500);
});
// "Check for updates" button: look now, and apply right away if the register is free.
ipcMain.handle('hw:check-updates', async () => {
  const screen = await checkScreen();
  let appMsg = 'App updates work in the installed app only';
  if (app.isPackaged && autoUpdater) {
    try { const r = await autoUpdater.checkForUpdates(); appMsg = r && r.updateInfo && newer(r.updateInfo.version, app.getVersion()) ? `App ${r.updateInfo.version} is downloading` : 'App is up to date'; }
    catch (e) { appMsg = `App check failed: ${e.message}`; }
  }
  return { screen, app: appMsg, version: app.getVersion(), screenVersion: shown.version, updateReady, screenReady: waitingScreen };
});
ipcMain.handle('hw:install-update', () => {
  if (busy) return false;
  if (waitingScreen) return applyScreen();
  if (!updateReady || !autoUpdater) return false;
  forceQuit = true; setImmediate(() => autoUpdater.quitAndInstall(true, true)); return true;
});
ipcMain.handle('hw:quit', () => { if (busy) return false; forceQuit = true; app.quit(); return true; });

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => { applyAutoStart(settings); createWindow(); setupUpdates(); startUpdateLoops(); log(`started ${app.getVersion()} screen ${shown.version}`); });
app.on('window-all-closed', () => app.quit());
