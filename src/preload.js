const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = ['settings', 'message', 'message-delete', 'media', 'voice', 'connection', 'input-mode', 'edit-mode', 'reset', 'target', 'channels', 'mirror-sources', 'mirror-closers', 'cover', 'cursor'];

contextBridge.exposeInMainWorld('overlay', {
  on(channel, cb) {
    if (!CHANNELS.includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => cb(data));
  },
  send(content) { ipcRenderer.send('send', content); },
  setClickable(on) { ipcRenderer.send('set-clickable', !!on); },
  setHover(on) { ipcRenderer.send('set-hover', !!on); },
  openSettings() { ipcRenderer.send('open-settings'); },
  endInput() { ipcRenderer.send('end-input'); },
  setTarget(id) { ipcRenderer.send('set-target', id || null); },
  fetchLottie(url) { return ipcRenderer.invoke('fetch-lottie', url); },
  closePopup(id) { ipcRenderer.send('close-popup', String(id)); },
  openLink(url) { ipcRenderer.send('open-link', url); },
  searchMembers(q) { return ipcRenderer.invoke('search-members', q); },
});
