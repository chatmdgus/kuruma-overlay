const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsApi', {
  get: () => ipcRenderer.invoke('settings:get'),
  preview: (partial) => ipcRenderer.invoke('settings:preview', partial),
  save: (partial) => ipcRenderer.invoke('settings:save', partial),
  close: () => ipcRenderer.invoke('settings:close'),
  onConnection: (cb) => ipcRenderer.on('connection', (_e, c) => cb(c)),
  onTunnel: (cb) => ipcRenderer.on('tunnel', (_e, t) => cb(t)),
  pickKey: () => ipcRenderer.invoke('settings:pick-key'),
  login: (partial) => ipcRenderer.invoke('settings:login', partial),
  logout: () => ipcRenderer.invoke('settings:logout'),
  update: (action) => ipcRenderer.invoke('settings:update', action),
  onUpdate: (cb) => ipcRenderer.on('update', (_e, u) => cb(u)),
});
