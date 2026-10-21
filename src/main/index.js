const { app, screen, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const config = require('./config');
const { makeOverlay, placeOverlay } = require('./overlay');
const { startRelay } = require('./relay');
const { startMock } = require('./mock');

const wins = {};
let feed = null;
let inputMode = false;

function resolveDisplay(role) {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const savedId = config.get().monitors[role];
  const saved = displays.find((d) => String(d.id) === String(savedId));
  if (saved) return saved;
  if (role === 'sub') return displays.find((d) => d.id !== primary.id) || primary;
  return primary;
}

function layoutAll() {
  const { overlays } = config.get();
  for (const [name, win] of Object.entries(wins)) {
    const o = overlays[name];
    if (!o.enabled) { win.hide(); continue; }
    placeOverlay(win, resolveDisplay(o.monitor), o.rect);
    win.showInactive();
  }
}

function setInputMode(on) {
  inputMode = on;
  const chat = wins.chat;
  chat.setFocusable(on);
  chat.setIgnoreMouseEvents(!on, { forward: true });
  if (on) chat.focus();
  chat.webContents.send('input-mode', on);
}

function emit(type, payload) {
  switch (type) {
    case 'message': {
      const media = payload.media || [];
      wins.chat.webContents.send('message', {
        id: payload.id,
        author: payload.author,
        text: payload.content || (media.length ? `[${media[0].kind === 'video' ? '영상' : '이미지'}]` : ''),
      });
      for (const m of media) wins.media.webContents.send('media', m);
      break;
    }
    case 'history':
      for (const m of payload.messages || []) emit('message', m);
      break;
    case 'message_delete':
      wins.chat.webContents.send('message-delete', payload.id);
      break;
    case 'voice':
      wins.voice.webContents.send('voice', payload.members || []);
      break;
    case 'connection':
      wins.voice.webContents.send('connection', payload.online);
      break;
    default:
      break;
  }
}

function sendSettings() {
  const { overlays } = config.get();
  wins.chat.webContents.send('settings', { fadeSec: overlays.chat.fadeSec, maxLines: overlays.chat.maxLines });
  wins.media.webContents.send('settings', { fadeSec: overlays.media.fadeSec });
}

app.whenReady().then(() => {
  for (const name of ['chat', 'media', 'voice']) {
    wins[name] = makeOverlay(path.join(__dirname, '..', 'renderer', `${name}.html`));
  }

  Promise.all(Object.values(wins).map((w) => new Promise((r) => w.webContents.once('did-finish-load', r)))).then(() => {
    sendSettings();
    const cfg = config.get();
    if (process.argv.includes('--mock') || !cfg.serverUrl) {
      feed = startMock(emit);
    } else {
      feed = startRelay(cfg, emit);
    }
  });

  layoutAll();
  screen.on('display-added', layoutAll);
  screen.on('display-removed', layoutAll);
  screen.on('display-metrics-changed', layoutAll);

  // 게임이 항상 위를 가로채는 경우 대비
  setInterval(() => Object.values(wins).forEach((w) => w.setAlwaysOnTop(true, 'screen-saver')), 5000);

  globalShortcut.register(config.get().hotkeys.input, () => setInputMode(!inputMode));

  ipcMain.on('send', (_e, content) => {
    const text = String(content || '').trim().slice(0, 2000);
    if (text && feed) feed.send(text);
    setInputMode(false);
  });
  ipcMain.on('end-input', () => setInputMode(false));
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  feed && feed.stop();
});

app.on('window-all-closed', () => app.quit());
