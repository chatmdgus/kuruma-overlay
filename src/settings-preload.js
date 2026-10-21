const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsApi', {
  get: () => ipcRenderer.invoke('settings:get'),
  preview: (partial) => ipcRenderer.invoke('settings:preview', partial),
  save: (partial) => ipcRenderer.invoke('settings:save', partial),
  close: () => ipcRenderer.invoke('settings:close'),
});
