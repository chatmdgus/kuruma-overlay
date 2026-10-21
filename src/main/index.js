const { app, screen, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const config = require('./config');
const { makeOverlay, placeOverlay } = require('./overlay');
const { startRelay } = require('./relay');
const { startMock } = require('./mock');
const { setupSettings, openSettings } = require('./settings');
const { createTray } = require('./tray');

const wins = {};
let feed = null;
let tray = null;
let inputMode = false;
let userHidden = false;
let registeredHotkey = null;

if (!app.requestSingleInstanceLock()) app.quit();

function resolveDisplay(role, cfg = config.get()) {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  const saved = displays.find((d) => String(d.id) === String(cfg.monitors[role]));
  if (saved) return saved;
  if (role === 'sub') return displays.find((d) => d.id !== primary.id) || primary;
  return primary;
}

function layoutAll(cfg = config.get()) {
  for (const [name, win] of Object.entries(wins)) {
    const o = cfg.overlays[name];
    if (!o.enabled || userHidden) { win.hide(); continue; }
    placeOverlay(win, resolveDisplay(o.monitor, cfg), o.rect);
    win.showInactive();
  }
}

function sendSettings(cfg = config.get()) {
  const { overlays } = cfg;
  wins.chat.webContents.send('settings', { fadeSec: overlays.chat.fadeSec, maxLines: overlays.chat.maxLines });
  wins.media.webContents.send('settings', { fadeSec: overlays.media.fadeSec });
}

function registerHotkey(cfg = config.get()) {
  if (registeredHotkey === cfg.hotkeys.input) return;
  if (registeredHotkey) globalShortcut.unregister(registeredHotkey);
  registeredHotkey = globalShortcut.register(cfg.hotkeys.input, () => setInputMode(!inputMode)) ? cfg.hotkeys.input : null;
}

function applyConfig(cfg) {
  layoutAll(cfg);
  sendSettings(cfg);
  registerHotkey(cfg);
}

function setEditMode(on) {
  for (const win of Object.values(wins)) win.webContents.send('edit-mode', on);
}

function setInputMode(on) {
  if (on && (userHidden || !config.get().overlays.chat.enabled)) return;
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

const settingsDeps = {
  config,
  resolveDisplay: (role) => resolveDisplay(role),
  applyConfig,
  previewConfig: (partial) => layoutAll(config.merge(config.get(), partial)),
  setEditMode,
};

app.whenReady().then(() => {
  for (const name of ['chat', 'media', 'voice']) {
    wins[name] = makeOverlay(path.join(__dirname, '..', 'renderer', `${name}.html`));
  }

  Promise.all(Object.values(wins).map((w) => new Promise((r) => w.webContents.once('did-finish-load', r)))).then(() => {
    sendSettings();
    const cfg = config.get();
    feed = process.argv.includes('--mock') || !cfg.serverUrl ? startMock(emit) : startRelay(cfg, emit);
    if (!cfg.monitors.main) openSettings(settingsDeps); // 첫 실행: 모니터부터 정하게 함
  });

  setupSettings(settingsDeps);
  layoutAll();
  registerHotkey();

  const relayout = () => layoutAll();
  screen.on('display-added', relayout);
  screen.on('display-removed', relayout);
  screen.on('display-metrics-changed', relayout);

  // 게임이 항상 위를 가로채는 경우 대비
  setInterval(() => Object.values(wins).forEach((w) => w.setAlwaysOnTop(true, 'screen-saver')), 5000);

  tray = createTray({
    onToggle: (visible) => { userHidden = !visible; if (userHidden) setInputMode(false); layoutAll(); },
    onSettings: () => openSettings(settingsDeps),
    onQuit: () => app.quit(),
  });

  ipcMain.on('send', (_e, content) => {
    const text = String(content || '').trim().slice(0, 2000);
    if (text && feed) feed.send(text);
    setInputMode(false);
  });
  ipcMain.on('end-input', () => setInputMode(false));
});

app.on('second-instance', () => openSettings(settingsDeps));

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  feed && feed.stop();
});

// 설정 창을 닫아도 오버레이와 트레이는 계속 실행
app.on('window-all-closed', (e) => e.preventDefault());
