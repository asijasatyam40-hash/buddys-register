// The only doorway between the register screen and the computer.
// The screen can print, open the drawer, read/save hardware settings and
// ask for an update — nothing else on the PC is reachable from the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddysHW', {
  info: () => ipcRenderer.invoke('hw:info'),
  printers: () => ipcRenderer.invoke('hw:printers'),
  saveSettings: s => ipcRenderer.invoke('hw:save-settings', s),
  print: job => ipcRenderer.invoke('hw:print', job),
  drawer: () => ipcRenderer.invoke('hw:drawer'),
  setState: st => ipcRenderer.send('hw:state', st),
  installUpdate: () => ipcRenderer.invoke('hw:install-update'),
  checkUpdates: () => ipcRenderer.invoke('hw:check-updates'),
  quit: () => ipcRenderer.invoke('hw:quit'),
  onUpdateReady: cb => ipcRenderer.on('hw:update-ready', (e, v) => cb(v)),
  onCloseBlocked: cb => ipcRenderer.on('hw:close-blocked', () => cb()),
});
