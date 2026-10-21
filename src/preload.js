const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['settings', 'message', 'message-delete', 'media', 'voice', 'connection', 'input-mode', 'edit-mode'];

contextBridge.exposeInMainWorld('overlay', {
  on(channel, cb) {
    if (!CHANNELS.includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => cb(data));
  },
  send(content) { ipcRenderer.send('send', content); },
  endInput() { ipcRenderer.send('end-input'); },
});
