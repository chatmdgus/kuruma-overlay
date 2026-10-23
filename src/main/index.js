const { app, screen, globalShortcut, ipcMain, BrowserWindow, safeStorage } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

// 개발 실행(npm start)과 설치본이 같은 설정 폴더를 쓰게 고정
app.setPath('userData', path.join(app.getPath('appData'), 'kuruma-overlay'));
const config = require('./config');
const { makeOverlay, placeOverlay } = require('./overlay');
const { startRelay } = require('./relay');
const { startMock } = require('./mock');
const { setupSettings, openSettings, notifySettings } = require('./settings');
const { createTray } = require('./tray');
const { startTunnel } = require('./tunnel');
const { login, describeLoginError } = require('./login');
const { watchForeground, foregroundWindow, restoreForeground, foregroundIsFullscreen } = require('./foreground');
const { shell } = require('electron');
const { setupUpdater } = require('./updater');

const MOCK = process.argv.includes('--mock');
const wins = {};
let feed = null;
let feedKey = '';
let connection = { state: 'setup' };
const channelNames = new Map();   // 채널 ID → 이름 (서버의 ready 메시지에서 받음)
let sendChannelId = null;
let lastMsgTs = 0;
let manualTarget = false;         // 입력창에서 채널을 직접 골랐으면 자동으로 안 바꿈
let channelList = [];             // 볼 수 있는 텍스트 채널 [{id, name}] (서버 순서)                // 마지막으로 글이 올라온 시각 (그 채널로 답장)         // 오버레이에서 쓴 글을 보낼 채널
let tunnel = null;
let tunnelKey = '';
let tunnelState = { state: 'off' };
let prevForeground = null;  // 입력을 시작하기 전 맨 앞 창 (끝나면 여기로 포커스를 돌려줌)
let inputOn = true;        // 채팅 입력창이 보이는지 (단축키로 켜고 끔, 기본은 켜짐)
let userHidden = false;
let registeredHotkey = null;
let quitting = false;
let discordFront = false;
let editing = false;               // 설정 창이 열려 있으면 GIF 자리도 보여줌          // 디스코드 창이 맨 앞에 있는지
let updater = null;
let trayApi = null;
let lastUpdateKey = '';
// 종료 중에는 창이 먼저 없어질 수 있어서 확인하고 보냄
const post = (w, ...args) => { if (w && !w.isDestroyed()) w.webContents.send(...args); };
const alive = () => Object.values(wins).filter((w) => !w.isDestroyed());

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
  if (quitting) return;
  for (const [name, win] of Object.entries(wins)) {
    if (win.isDestroyed()) continue;
    const o = cfg.overlays[name];
    // 음성 오버레이는 쓰지 않음 (디스코드 기본 오버레이 사용)
    const hideForDiscord = discordFront && cfg.appearance.hideOnDiscord;
    const noGif = name === 'gif' && !o.file && !editing;   // GIF 를 아직 안 골랐으면 숨김 (배치 중엔 자리 표시)
    if (!o.enabled || userHidden || hideForDiscord || noGif || name === 'voice') { win.hide(); continue; }
    const d = resolveDisplay(o.monitor, cfg);
    const tall = d.bounds.height > d.bounds.width;
    placeOverlay(win, d, tall ? (o.rectTall || config.DEFAULTS.overlays[name].rectTall) : o.rect);
    win.showInactive();
  }
  chatOnTop();
}

// 채팅 창이 사진 창과 겹치면 채팅이 위에 오게
function chatOnTop() {
  const c = wins.chat;
  if (c && !c.isDestroyed() && c.isVisible()) c.moveTop();
}

function sendSettings(cfg = config.get()) {
  const { overlays, appearance } = cfg;
  const bgOpacity = appearance.bgOpacity;
  const theme = appearance.theme || 'dark';
  post(wins.chat, 'settings', { fadeSec: overlays.chat.fadeSec, maxLines: overlays.chat.maxLines, fontSize: overlays.chat.fontSize, bgOpacity, theme });
  post(wins.media, 'settings', { fadeSec: overlays.media.fadeSec, maxItems: overlays.media.maxItems, theme });
  const g = overlays.gif;
  post(wins.gif, 'settings', { src: g.file ? pathToFileURL(g.file).href : '', opacity: g.opacity ?? 1, theme });
  post(wins.voice, 'settings', { scale: overlays.voice.scale, gap: overlays.voice.gap, showControls: overlays.voice.showControls, bgOpacity, theme });
}

function registerHotkey(cfg = config.get()) {
  if (registeredHotkey === cfg.hotkeys.input) return;
  if (registeredHotkey) globalShortcut.unregister(registeredHotkey);
  let ok = false;
  try { ok = globalShortcut.register(cfg.hotkeys.input, () => toggleInput()); } catch { ok = false; }
  registeredHotkey = ok ? cfg.hotkeys.input : null;
  notifySettings('hotkey', { accel: cfg.hotkeys.input, ok });
}

// 설정 창에서 새 단축키를 누르면: 다른 프로그램이 이미 쓰고 있는지 확인
function testHotkey(accel) {
  if (accel === registeredHotkey) return true;
  try {
    if (!globalShortcut.register(accel, () => {})) return false;
    globalShortcut.unregister(accel);
    return true;
  } catch { return false; }
}

// 설정에서 입력창 켜기/끄기를 바꿨으면 바로 반영
function syncInputOn(cfg) {
  const want = cfg.overlays.chat.inputOn !== false;
  if (want !== inputOn) setInputOn(want, { save: false });
}

function setConnection(c) {
  connection = c;
  for (const w of Object.values(wins)) post(w, 'connection', c);
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
// 서버 주소를 비워두면: SSH 터널을 쓰면 터널, 아니면 공개 서버
const serverUrlOf = (cfg) => cfg.serverUrl || (cfg.ssh.enabled ? `ws://127.0.0.1:${cfg.ssh.localPort}` : config.PUBLIC_SERVER);

function syncLaunch(cfg = config.get()) {
  // 개발 실행일 때는 electron.exe에 앱 폴더를 넘겨야 함
  app.setLoginItemSettings({ openAtLogin: !!cfg.launch.atLogin, path: process.execPath, args: app.isPackaged ? [] : [app.getAppPath()] });
}

// 세션 키는 Windows 사용자 계정으로 암호화해서 저장
function sealSession(token) {
  if (!token) return '';
  return safeStorage.isEncryptionAvailable() ? `enc:${safeStorage.encryptString(token).toString('base64')}` : `raw:${token}`;
}
function openSession(sealed) {
  if (!sealed) return '';
  try {
    if (sealed.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(sealed.slice(4), 'base64'));
    if (sealed.startsWith('raw:')) return sealed.slice(4);
  } catch { /* 다른 PC에서 옮겨온 설정이면 복호화 안 됨 */ }
  return '';
}
const authTokenOf = (cfg) => openSession(cfg.auth?.session) || cfg.sessionToken || '';

// 접속 정보가 바뀌었을 때만 다시 연결
function startFeed(cfg = config.get()) {
  const url = serverUrlOf(cfg);
  const token = authTokenOf(cfg);
  const key = MOCK ? 'mock' : JSON.stringify([url, token, cfg.subscribe]);
  // 같은 정보라도 토큰 오류로 멈춘 상태면 저장할 때 다시 시도
  if (feed && key === feedKey && connection.state !== 'error') return;
  feed && feed.stop();
  feed = null;
  feedKey = key;
  for (const w of Object.values(wins)) post(w, 'reset');
  channelNames.clear();
  if (MOCK) feed = startMock(emit);
  else if (url && token) feed = startRelay({ ...cfg, serverUrl: url, sessionToken: token }, emit);
  else setConnection({ state: 'setup' });
}

function applyConfig(cfg) {
  layoutAll(cfg);
  sendSettings(cfg);
  registerHotkey(cfg);
  syncInputOn(cfg);
  syncTunnel(cfg);
  syncLaunch(cfg);
  startFeed(cfg);
}

function setEditMode(on) {
  editing = on;
  for (const win of Object.values(wins)) post(win, 'edit-mode', on);
  layoutAll();
}

// 입력창 보이기/숨기기. 보이는 동안은 입력창 위에 마우스를 올리면 클릭해서 바로 칠 수 있음
function setInputOn(on, { focus = false, save = true } = {}) {
  inputOn = on;
  const chat = wins.chat;
  if (!chat || chat.isDestroyed()) return;
  if (!on) endTyping();
  post(chat, 'input-mode', { on, focus });
  if (on && focus) startTyping();
  if (save) config.save({ overlays: { chat: { inputOn: on } } });
  notifySettings('input', on);
}

// 단축키: 꺼져 있으면 켜고 바로 입력 / 켜져 있는데 게임 중이면 바로 입력 / 입력 중이면 끄기
function toggleInput() {
  const chat = wins.chat;
  if (!inputOn) setInputOn(true, { focus: true });
  else if (chat && !chat.isDestroyed() && !chat.isFocused()) { post(chat, 'input-mode', { on: true, focus: true }); startTyping(); }
  else setInputOn(false);
}

// 입력 시작: 지금 맨 앞 창(게임)을 기억해 두고 채팅 창에 포커스
function startTyping() {
  const chat = wins.chat;
  if (!chat || chat.isDestroyed() || userHidden || !config.get().overlays.chat.enabled) return;
  if (!chat.isFocused()) prevForeground = foregroundWindow();
  chat.setFocusable(true);
  chat.setIgnoreMouseEvents(false);   // 입력 중에는 창 전체로 휠 스크롤·링크 클릭
  chat.focus();
}

// 입력을 끝내면 게임으로 포커스를 돌려주고 다시 클릭 통과
function endTyping() {
  const chat = wins.chat;
  if (!chat || chat.isDestroyed()) return;
  chat.setIgnoreMouseEvents(true, { forward: true });
  const hadFocus = chat.isFocused();
  chat.setFocusable(false);   // 평소에는 포커스를 못 가져가게 (다른 프로그램 단축키·작업 표시줄 문제 방지)
  if (hadFocus && !restoreForeground(prevForeground)) chat.blur();
  prevForeground = null;
}

// 입력창에 "어느 채널로 보내는지" 표시. 채널을 따로 정하지 않았으면 볼 수 있는 첫 채팅 채널
// 보내기 채널 후보 = 구독 중인 채널 (따로 고르지 않았으면 전부)
function followedChannels(cfg = config.get()) {
  const ids = cfg.subscribe.channelIds || [];
  return ids.length ? channelList.filter((c) => ids.includes(c.id)) : channelList;
}

function postTarget() {
  post(wins.chat, 'target', { id: sendChannelId, name: channelNames.get(sendChannelId) || null, auto: !manualTarget });
}

function sendTarget(cfg = config.get()) {
  const list = followedChannels(cfg);
  if (MOCK) sendChannelId = 'mock';
  else if (!list.some((c) => c.id === sendChannelId)) { sendChannelId = list[0]?.id || null; manualTarget = false; }
  post(wins.chat, 'channels', list);
  postTarget();
}

function emit(type, payload) {
  switch (type) {
    case 'message': {
      const media = payload.media || [];
      post(wins.chat, 'message', {
        id: payload.id,
        author: payload.author,
        text: payload.content || (payload.stickers?.length ? '' : (media.length ? (media[0].kind === 'video' ? '영상을 보냄' : '사진을 보냄') : '')),
        stickers: (payload.stickers || []).filter((st) => st && typeof st === 'object').slice(0, 3),
        channel: channelNames.get(payload.channelId) || null,
        mediaOnly: !payload.content && media.length > 0,
      });
      for (const m of media) post(wins.media, 'media', m);
      // 채널을 따로 정하지 않았으면 마지막으로 글이 올라온 채널로 보냄 (입력 중에는 안 바꿈)
      if (!MOCK && !manualTarget && (payload.ts || 0) > lastMsgTs && channelNames.has(payload.channelId) && !wins.chat.isFocused()) {
        lastMsgTs = payload.ts;
        sendChannelId = payload.channelId;
        postTarget();
      }
      break;
    }
    case 'ready': {
      channelNames.clear();
      lastMsgTs = 0;
      channelList = [];
      for (const g of payload.guilds || []) for (const c of g.channels || []) if (c.type !== 'voice') { channelNames.set(c.id, c.name); channelList.push({ id: c.id, name: c.name }); }
      notifySettings('channels', channelList);
      sendTarget();
      break;
    }
    case 'history':
      for (const m of payload.messages || []) emit('message', m);
      break;
    case 'message_delete':
      post(wins.chat, 'message-delete', payload.id);
      break;
    case 'voice':
      post(wins.voice, 'voice', { channelName: payload.channelName || null, members: payload.members || [] });
      break;
    case 'connection':
      // 디스코드 로그인 세션이 거부되면 만료로 안내
      if (payload.state === 'error' && payload.reason === 'auth_failed' && config.get().auth?.session) payload = { ...payload, reason: 'expired' };
      setConnection(payload);
      break;
    default:
      break;
  }
}

const settingsDeps = {
  isQuitting: () => quitting,
  getUpdate: () => updater?.get() || null,
  getChannels: () => channelList,
  getHotkey: () => ({ accel: config.get().hotkeys.input, ok: registeredHotkey === config.get().hotkeys.input }),
  testHotkey,
  update: (action) => { if (action === 'install') updater?.install(); else updater?.check(); },
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
    syncInputOn(merged);
  },
  setEditMode,
  // 처음 설정 화면의 "디스코드로 로그인"
  async login(partial) {
    const cfg = config.save(partial);
    applyConfig(cfg);
    // SSH 터널을 쓰면 열릴 때까지 잠깐 기다림
    for (let i = 0; cfg.ssh.enabled && tunnelState.state !== 'open' && i < 30; i++) await new Promise((r) => setTimeout(r, 500));
    try {
      const { token, user } = await login(serverUrlOf(cfg));
      const next = config.save({ auth: { session: sealSession(token), user: { id: user.id, name: user.name } } });
      applyConfig(next);
      return { ok: true, user };
    } catch (e) {
      return { ok: false, error: describeLoginError(e) };
    }
  },
  logout() {
    feed && feed.logout && feed.logout();
    const next = config.save({ auth: { session: '', user: null } });
    applyConfig(next);
    return true;
  },
};

app.whenReady().then(() => {
  for (const name of ['gif', 'media', 'chat', 'voice']) {   // 만든 순서대로 쌓임: GIF가 맨 아래
    wins[name] = makeOverlay(path.join(__dirname, '..', 'renderer', `${name}.html`));
  }

  // 게임 쪽을 누르면 입력창에서 빠져나옴 → 다시 클릭 통과
  wins.chat.on('blur', () => { if (!wins.chat.isDestroyed()) { wins.chat.setIgnoreMouseEvents(true, { forward: true }); wins.chat.setFocusable(false); } });

  Promise.all(Object.values(wins).map((w) => new Promise((r) => w.webContents.once('did-finish-load', r)))).then(() => {
    sendSettings();
    setInputOn(config.get().overlays.chat.inputOn !== false, { save: false });
    syncTunnel();
    if (config.get().launch.atLogin) syncLaunch();   // 설치 위치가 바뀌었을 수 있어서 다시 등록
    startFeed();
    const cfg = config.get();
    // 첫 실행이거나 접속 정보가 없으면 설정 창부터
    if (!cfg.monitors.main || (!MOCK && !(serverUrlOf(cfg) && authTokenOf(cfg)))) openSettings(settingsDeps);
  });

  setupSettings(settingsDeps);
  layoutAll();
  registerHotkey();

  // 디스코드가 맨 앞에 있으면 오버레이 숨기기 (설정에서 끌 수 있음)
  watchForeground((front) => {
    discordFront = front;
    if (front && config.get().appearance.hideOnDiscord) endTyping();
    layoutAll();
  });

  const relayout = () => layoutAll();
  screen.on('display-added', relayout);
  screen.on('display-removed', relayout);
  screen.on('display-metrics-changed', relayout);

  // 게임이 항상 위를 가로채는 경우 대비
  // 게임이 항상 위를 가로채는 경우 대비. 단 전체화면 창(유튜브·동영상)이 맨 앞이면 건드리지 않음 → 작업 표시줄이 튀어나오지 않게
  const ownHandles = () => alive().map((w) => { const b = w.getNativeWindowHandle(); return b.length >= 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0)); });
  setInterval(() => {
    if (foregroundIsFullscreen(ownHandles())) return;
    alive().forEach((w) => w.setAlwaysOnTop(true, 'screen-saver'));
  }, 5000);

  updater = setupUpdater((u) => {
    notifySettings('update', u);
    // 트레이 메뉴는 상태가 바뀌거나 10%마다만 다시 만듦 (열려 있는 메뉴가 닫히지 않게)
    const key = `${u.state}:${u.version || ''}:${Math.floor((u.percent || 0) / 10)}`;
    if (key !== lastUpdateKey) { lastUpdateKey = key; trayApi?.refresh(); }
  });

  trayApi = createTray({
    getUpdate: () => updater?.get(),
    onUpdate: (action) => settingsDeps.update(action),
    onToggle: (visible) => { userHidden = !visible; if (userHidden) endTyping(); layoutAll(); },
    onSettings: () => openSettings(settingsDeps),
    onQuit: () => app.quit(),
  });

  ipcMain.on('send', (_e, content) => {
    const text = String(content || '').trim().slice(0, 2000);
    if (text && feed && sendChannelId) feed.send(text, sendChannelId);   // 보내고 나서도 입력창은 그대로 (이어서 칠 수 있게)
  });
  ipcMain.on('end-input', () => endTyping());
  // 입력창에서 보낼 채널 고르기 (null 이면 자동: 마지막 글이 올라온 채널)
  ipcMain.on('set-target', (_e, id) => {
    if (id && followedChannels().some((c) => c.id === id)) { sendChannelId = id; manualTarget = true; }
    else manualTarget = false;
    postTarget();
  });
  ipcMain.on('open-settings', () => openSettings(settingsDeps));
  // 디스코드 기본 스티커(Lottie json)는 브라우저에서 바로 못 받아서(CORS) 여기서 받아 넘김
  const lottieCache = new Map();
  ipcMain.handle('fetch-lottie', async (_e, url) => {
    try {
      const u = new URL(String(url));
      if (u.protocol !== 'https:' || !['discord.com', 'cdn.discordapp.com', 'media.discordapp.net'].includes(u.hostname)) return null;
      if (lottieCache.has(u.href)) return lottieCache.get(u.href);
      const res = await fetch(u.href);
      if (!res.ok) return null;
      const text = await res.text();
      if (text.length > 2e6) return null;
      const data = JSON.parse(text);
      if (lottieCache.size > 50) lottieCache.clear();
      lottieCache.set(u.href, data);
      return data;
    } catch { return null; }
  });
  // 설정 버튼 위에 마우스가 있는 동안만 클릭을 받음 (채팅 입력 모드 중인 채팅 창은 건드리지 않음)
  ipcMain.on('set-clickable', (e, on) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || (win === wins.chat && win.isFocused())) return;   // 입력 중에는 클릭 받는 상태 유지
    if (win === wins.chat) {
      // 입력창·링크 위에 마우스가 올라가면 클릭해서 포커스를 받을 수 있게. 그 전에 게임 창을 기억
      if (on) { prevForeground = foregroundWindow(); win.setFocusable(true); } else win.setFocusable(false);
    }
    win.setIgnoreMouseEvents(!on, { forward: true });
  });
  // 채팅 글 속 링크: http/https 만 브라우저로
  ipcMain.on('open-link', (_e, url) => {
    try { const u = new URL(String(url)); if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(u.href); } catch {}
  });
  // @멘션 자동완성: 서버에서 멤버 찾기
  ipcMain.handle('search-members', async (_e, query) => (feed && feed.searchMembers ? feed.searchMembers(String(query || '').slice(0, 32)) : []));
});

app.on('second-instance', () => openSettings(settingsDeps));

app.on('before-quit', () => { quitting = true; });

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  feed && feed.stop();
  tunnel && tunnel.stop();
});

// 설정 창을 닫아도 오버레이와 트레이는 계속 실행
app.on('window-all-closed', (e) => e.preventDefault());
