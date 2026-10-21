const { app, screen, globalShortcut, ipcMain, BrowserWindow } = require('electron');
const path = require('path');

// 개발 실행(npm start)과 설치본이 같은 설정 폴더를 쓰게 고정
app.setPath('userData', path.join(app.getPath('appData'), 'kuruma-overlay'));
const config = require('./config');
const { makeOverlay, placeOverlay } = require('./overlay');
const { startRelay } = require('./relay');
const { startMock } = require('./mock');
const { setupSettings, openSettings, notifySettings } = require('./settings');
const { createTray } = require('./tray');
const { startTunnel } = require('./tunnel');

const MOCK = process.argv.includes('--mock');
const wins = {};
let feed = null;
let feedKey = '';
let connection = { state: 'setup' };
let tunnel = null;
let tunnelKey = '';
let tunnelState = { state: 'off' };
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
  const { overlays, appearance } = cfg;
  const bgOpacity = appearance.bgOpacity;
  wins.chat.webContents.send('settings', { fadeSec: overlays.chat.fadeSec, maxLines: overlays.chat.maxLines, fontSize: overlays.chat.fontSize, bgOpacity });
  wins.media.webContents.send('settings', { fadeSec: overlays.media.fadeSec, maxItems: overlays.media.maxItems });
  wins.voice.webContents.send('settings', { scale: overlays.voice.scale, gap: overlays.voice.gap, showControls: overlays.voice.showControls, bgOpacity });
}

function registerHotkey(cfg = config.get()) {
  if (registeredHotkey === cfg.hotkeys.input) return;
  if (registeredHotkey) globalShortcut.unregister(registeredHotkey);
  registeredHotkey = globalShortcut.register(cfg.hotkeys.input, () => setInputMode(!inputMode)) ? cfg.hotkeys.input : null;
}

function setConnection(c) {
  connection = c;
  for (const w of Object.values(wins)) w.webContents.send('connection', c);
  notifySettings('connection', c);
}

// SSH 터널: 설정이 바뀌었을 때만 다시 열기
function syncTunnel(cfg = config.get()) {
  const s = cfg.ssh;
  const on = !MOCK && s.enabled && s.host && s.user && s.keyPath;
  const key = on ? JSON.stringify(s) : '';
  if (key === tunnelKey) return;
  tunnel && tunnel.stop();
  tunnel = null;
  tunnelKey = key;
  if (!on) { tunnelState = { state: 'off' }; notifySettings('tunnel', tunnelState); return; }
  tunnel = startTunnel(s, (st) => { tunnelState = st; notifySettings('tunnel', st); });
}

// SSH 터널을 쓰고 서버 주소가 비어 있으면 터널 주소로
const serverUrlOf = (cfg) => cfg.serverUrl || (cfg.ssh.enabled ? `ws://127.0.0.1:${cfg.ssh.localPort}` : '');

function syncLaunch(cfg = config.get()) {
  // 개발 실행일 때는 electron.exe에 앱 폴더를 넘겨야 함
  app.setLoginItemSettings({ openAtLogin: !!cfg.launch.atLogin, path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] });
}

// 접속 정보가 바뀌었을 때만 다시 연결
function startFeed(cfg = config.get()) {
  const url = serverUrlOf(cfg);
  const key = MOCK ? 'mock' : JSON.stringify([url, cfg.sessionToken, cfg.subscribe]);
  // 같은 정보라도 토큰 오류로 멈춘 상태면 저장할 때 다시 시도
  if (feed && key === feedKey && connection.state !== 'error') return;
  feed && feed.stop();
  feed = null;
  feedKey = key;
  for (const w of Object.values(wins)) w.webContents.send('reset');
  if (MOCK) feed = startMock(emit);
  else if (url && cfg.sessionToken) feed = startRelay({ ...cfg, serverUrl: url }, emit);
  else setConnection({ state: 'setup' });
}

function applyConfig(cfg) {
  layoutAll(cfg);
  sendSettings(cfg);
  registerHotkey(cfg);
  syncTunnel(cfg);
  syncLaunch(cfg);
  startFeed(cfg);
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
        text: payload.content || (media.length ? (media[0].kind === 'video' ? '영상을 보냄' : '사진을 보냄') : ''),
        mediaOnly: !payload.content && media.length > 0,
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
      setConnection(payload);
      break;
    default:
      break;
  }
}

const settingsDeps = {
  config,
  resolveDisplay: (role) => resolveDisplay(role),
  getConnection: () => connection,
  getTunnel: () => tunnelState,
  isMock: () => MOCK,
  applyConfig,
  previewConfig: (partial) => {
    const merged = config.merge(config.get(), partial);
    layoutAll(merged);
    sendSettings(merged);
  },
  setEditMode,
};

app.whenReady().then(() => {
  for (const name of ['chat', 'media', 'voice']) {
    wins[name] = makeOverlay(path.join(__dirname, '..', 'renderer', `${name}.html`));
  }

  Promise.all(Object.values(wins).map((w) => new Promise((r) => w.webContents.once('did-finish-load', r)))).then(() => {
    sendSettings();
    syncTunnel();
    if (config.get().launch.atLogin) syncLaunch();   // 설치 위치가 바뀌었을 수 있어서 다시 등록
    startFeed();
    const cfg = config.get();
    // 첫 실행이거나 접속 정보가 없으면 설정 창부터
    if (!cfg.monitors.main || (!MOCK && !(serverUrlOf(cfg) && cfg.sessionToken))) openSettings(settingsDeps);
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

  createTray({
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
  ipcMain.on('open-settings', () => openSettings(settingsDeps));
  // 설정 버튼 위에 마우스가 있는 동안만 클릭을 받음 (채팅 입력 모드 중인 채팅 창은 건드리지 않음)
  ipcMain.on('set-clickable', (e, on) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || (win === wins.chat && inputMode)) return;
    win.setIgnoreMouseEvents(!on, { forward: true });
  });
});

app.on('second-instance', () => openSettings(settingsDeps));

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  feed && feed.stop();
  tunnel && tunnel.stop();
});

// 설정 창을 닫아도 오버레이와 트레이는 계속 실행
app.on('window-all-closed', (e) => e.preventDefault());
