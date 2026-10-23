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
const { clippedTop, setOpacity, clipTop, minimizeWindow, closeWindow, hideTaskbarOver, restoreTaskbars, placeWindow, watchForeground, windowInfo, foregroundWindow, restoreForeground, foregroundIsFullscreen } = require('./foreground');
const { shell, desktopCapturer } = require('electron');
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

const mirrorShown = (cfg) => ((cfg.overlays.mirror.show || 'arrange') === 'arrange' ? closers.length > 0 && !popupsDown : mirrorKey !== '[]');

function layoutAll(cfg = config.get()) {
  if (quitting) return;
  for (const [name, win] of Object.entries(wins)) {
    if (win.isDestroyed()) continue;
    const o = cfg.overlays[name];
    // 음성 오버레이는 쓰지 않음 (디스코드 기본 오버레이 사용)
    const hideForDiscord = discordFront && cfg.appearance.hideOnDiscord;
    const noGif = (name === 'gif' && !o.file && !editing)   // GIF 를 아직 안 골랐으면 숨김 (배치 중엔 자리 표시)
      || (name === 'mirror' && !mirrorShown(cfg) && !editing);   // 비출 창(또는 닫기 버튼 놓을 팝업)이 없으면 숨김
    if (!o.enabled || userHidden || hideForDiscord || noGif || name === 'voice') { win.hide(); continue; }
    const d = resolveDisplay(o.monitor, cfg);
    const tall = d.bounds.height > d.bounds.width;
    placeOverlay(win, d, tall ? (o.rectTall || config.DEFAULTS.overlays[name].rectTall) : o.rect);
    win.showInactive();
  }
  chatOnTop();
}

// 채팅 창이 사진 창과 겹치면 채팅이 위에 오게
// ---------- 방송 화면 (창 비추기) ----------
// 3초마다 창 목록을 보고 비출 창을 정해서 mirror 창에 넘김 (창이 바뀐 칸만 다시 연결)
let mirrorKey = '[]';
async function listWindows() {
  const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
  return sources.map((s) => {
    const n = Number(String(s.id).split(':')[1]);
    const info = Number.isFinite(n) ? windowInfo(n) : null;
    return { id: s.id, name: s.name, exe: info?.exe || '', width: info?.width || 0, height: info?.height || 0 };
  });
}
// 디스코드 방송 팝업 자동 찾기: Discord.exe 창 중 본창("… - Discord", 없으면 가장 큰 창)을 뺀 나머지
function discordPopouts(all) {
  const dc = all.filter((w) => /^discord(ptb|canary)?\.exe$/i.test(w.exe) && !/updater|overlay/i.test(w.name) && w.width > 120 && w.height > 90);
  if (!dc.length) return [];
  let main = dc.find((w) => / - Discord$/.test(w.name));
  if (!main) main = dc.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
  return dc.filter((w) => w !== main);
}
// 방송이 끝나면 그 방송 팝업을 자동으로 닫음 (디스코드 팝업 자동 찾기일 때만)
// 음성 채널의 "화면 공유 중" 목록을 보고: 끝난 사람 이름이 제목에 있는 팝업을 닫고,
// 방송하는 사람이 아무도 없게 되면(또는 내가 음성 채널을 나가면) 남은 팝업을 전부 닫음
const streamers = new Map();   // 채널 → 방송 중인 사람 이름들
let lastPopouts = [];          // 마지막으로 찾은 디스코드 팝업 {id, name}
function onStreams(payload) {
  const key = payload.follow ? 'follow' : String(payload.channelId || '');
  const before = new Set([...streamers.values()].flatMap((s) => [...s]));
  streamers.set(key, new Set((payload.members || []).filter((m) => m.streaming).map((m) => m.name).filter(Boolean)));
  const now = new Set([...streamers.values()].flatMap((s) => [...s]));
  const ended = [...before].filter((n) => !now.has(n));
  const o = config.get().overlays.mirror;
  if (!ended.length || !o.enabled || o.mode === 'pick' || o.autoClose === false || !lastPopouts.length) return;
  const targets = now.size ? lastPopouts.filter((w) => ended.some((n) => w.name.includes(n))) : lastPopouts;
  for (const w of targets) {
    const n = Number(String(w.id).split(':')[1]);
    if (Number.isFinite(n)) closeWindow(n);
  }
  if (targets.length) setTimeout(() => syncMirror().catch(() => {}), 800);
}

// 디스코드 본창이 맨 앞에 오면 칸에 배치한 방송 팝업을 최소화, 벗어나면 다시 칸에 꺼내 놓음
let popupsDown = false;
function popupsForDiscord(front) {
  const cfg = config.get();
  const o = cfg.overlays.mirror;
  const on = o.enabled && (o.show || 'arrange') === 'arrange' && o.minimizeOnDiscord !== false;
  if (front && on && lastPicked.length && !popupsDown) {
    popupsDown = true;
    layoutAll();   // 닫기 버튼도 같이 숨김
    for (const w of lastPicked) {
      const n = Number(String(w.id).split(':')[1]);
      if (Number.isFinite(n)) minimizeWindow(n);
    }
  } else if (!front && popupsDown) {
    popupsDown = false;
    layoutAll();
    arrangeWindows(lastPicked, cfg, true);   // 최소화된 창은 포커스 안 뺏고 되살려서 칸에 다시 맞춤
  }
}

// 창 목록은 맨 앞에 있는 순서로 오기 때문에 팝업을 누를 때마다 순서가 바뀜
// → 처음 보인 순서대로 고정 (새 창은 뒤에 붙고, 닫힌 창은 빠짐)
const seenOrder = new Map();
let seenSeq = 0;
function stableOrder(list) {
  const ids = new Set(list.map((w) => w.id));
  for (const id of [...seenOrder.keys()]) if (!ids.has(id)) seenOrder.delete(id);
  for (const w of list) if (!seenOrder.has(w.id)) seenOrder.set(w.id, ++seenSeq);
  return [...list].sort((a, b) => seenOrder.get(a.id) - seenOrder.get(b.id));
}
async function syncMirror(cfg = config.get()) {
  if (popupsDown) return;   // 디스코드 때문에 잠깐 내려 둔 동안은 목록을 그대로 둠 (최소화된 창은 목록에서 빠질 수 있음)
  const o = cfg.overlays.mirror;
  let picked = [];
  if (o.enabled && !MOCK) {
    try {
      const all = await listWindows();
      picked = o.mode === 'pick' ? all.filter((w) => (o.titles || []).includes(w.name)) : discordPopouts(all);
    } catch (e) { console.error('[mirror]', e.message); }
  }
  picked = stableOrder(picked).slice(0, 4).map(({ id, name }) => ({ id, name }));
  lastPopouts = o.enabled && o.mode !== 'pick' ? picked : [];
  lastPicked = picked;
  const arrange = (o.show || 'arrange') === 'arrange';
  if (arrange) arrangeWindows(picked, cfg);
  else { unstyle(); if (closers.length) setClosers([]); }
  // 칸에 맞춰 배치하는 방식이면 비추는 화면은 안 씀 (빈 목록)
  const key = arrange ? '[]' : JSON.stringify(picked);
  if (key === mirrorKey) return;
  const wasEmpty = mirrorKey === '[]';
  mirrorKey = key;
  post(wins.mirror, 'mirror-sources', arrange ? [] : picked);
  if (wasEmpty !== (key === '[]')) layoutAll();   // 비출 창이 생기거나 없어지면 보이기/숨기기
}

// 팝업 창을 "방송 화면" 칸에 개수대로 나눠서 실제로 옮겨 놓음 (항상 위)
// 창 목록이나 칸 위치가 바뀔 때만 다시 맞춤 → 사용자가 잠깐 옮겨도 계속 끌어당기지는 않음
let arrangeKey = '';
let lastPicked = [];
const hwndOf = (w) => Number(String(w.id).split(':')[1]);
let closers = [];          // 칸에 놓은 팝업마다 닫기 버튼 위치 (mirror 창 기준)
const styled = new Set();  // 위 줄을 자르거나 투명하게 만든 팝업 (되돌릴 때 씀)
const clipWant = new Map(); // 팝업 → 잘라야 할 위쪽 픽셀
// 디스코드(크로미움)는 창 크기·상태가 바뀔 때 잘라낸 영역을 지워버림 → 지워졌으면 다시 자름
function keepClipped() {
  if (popupsDown) return;
  for (const [id, top] of clipWant) {
    if (!top || !styled.has(id)) continue;
    const n = hwndOf({ id });
    if (Number.isFinite(n) && clippedTop(n) === 0) clipTop(n, top);
  }
}
function setClosers(list) {
  const was = closers.length > 0;
  closers = list;
  post(wins.mirror, 'mirror-closers', list);
  if (was !== (list.length > 0)) layoutAll();
}
// 칸 배치를 그만두거나 목록에서 빠진 팝업은 원래 모습으로
function unstyle(keepIds = []) {
  for (const id of [...styled]) {
    if (keepIds.includes(id)) continue;
    const n = hwndOf({ id });
    if (Number.isFinite(n)) { clipTop(n, 0); setOpacity(n, 1); }
    styled.delete(id);
    clipWant.delete(id);
  }
}

function arrangeWindows(list, cfg = config.get(), force = false) {
  const o = cfg.overlays.mirror;
  const d = resolveDisplay(o.monitor, cfg);
  const tall = d.bounds.height > d.bounds.width;
  const r = tall ? (o.rectTall || config.DEFAULTS.overlays.mirror.rectTall) : o.rect;
  const area = { x: d.bounds.x + r.x * d.bounds.width, y: d.bounds.y + r.y * d.bounds.height, width: r.w * d.bounds.width, height: r.h * d.bounds.height };
  const T = o.titleBar ?? 22;          // 팝업 위쪽 버튼 줄 높이 (DIP). 칸 위로 밀어 올리고 잘라서 안 보이게
  const op = o.opacity ?? 1;
  const key = JSON.stringify([list.map((w) => w.id), area, T, op]);
  unstyle(list.map((w) => w.id));
  if (!list.length) { arrangeKey = ''; setClosers([]); return; }
  if (key === arrangeKey && !force) return;
  arrangeKey = key;
  const cells = gridCells(list.length, area, 6);
  list.forEach((w, i) => {
    const n = hwndOf(w);
    if (!Number.isFinite(n)) return;
    const c = cells[i];
    const dip = { x: c.x, y: c.y - T, width: c.width, height: c.height + T };
    const px = screen.dipToScreenRect(null, dip);   // 디스플레이 배율 → 실제 화면 픽셀
    placeWindow(n, px, true);
    const tpx = T ? Math.round(T * px.height / dip.height) : 0;
    setOpacity(n, op);   // 스타일을 바꾸면 디스코드가 영역을 지울 수 있어서 자르기보다 먼저
    clipTop(n, tpx);
    clipWant.set(w.id, tpx);
    styled.add(w.id);
  });
  const ox = Math.round(area.x), oy = Math.round(area.y);
  setClosers(list.map((w, i) => ({ id: w.id, x: cells[i].x - ox, y: cells[i].y - oy, width: cells[i].width, height: cells[i].height })));
  if (wins.mirror && !wins.mirror.isDestroyed()) wins.mirror.moveTop();   // 닫기 버튼이 팝업 위에 오게
  for (const ms of [150, 600, 1500]) setTimeout(keepClipped, ms);   // 크기를 바꾼 직후 디스코드가 영역을 지우는 경우
  chatOnTop();
}

// 16:9 방송이 가장 크게 들어가는 칸 나누기. 창은 칸을 꽉 채우지 않고 영상 비율에 딱 맞춰서
// 검은 여백이 안 생기게 함. 묶음은 아래·가운데 정렬 (남는 곳은 투명하게 비워 둠)
function gridCells(n, area, gap) {
  const fit = (cols) => {
    const rows = Math.ceil(n / cols);
    const cw = (area.width - gap * (cols - 1)) / cols;
    const ch = (area.height - gap * (rows - 1)) / rows;
    const w = Math.max(0, Math.min(cw, ch * 16 / 9));
    return { cols, rows, w, h: w * 9 / 16 };
  };
  let best = fit(1);
  for (let cols = 2; cols <= n; cols++) {
    const f = fit(cols);
    if (f.w > best.w * 1.01) best = f;
  }
  const { cols, rows, w, h } = best;
  const top = area.y + area.height - (rows * h + gap * (rows - 1));   // 아래에 붙이고 남는 곳은 위로 몰아서 비워 둠
  return Array.from({ length: n }, (_, i) => {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;   // 마지막 줄이 덜 차면 그 줄도 가운데로
    const left = area.x + (area.width - (inRow * w + gap * (inRow - 1))) / 2;
    return {
      x: Math.round(left + (i % cols) * (w + gap)),
      y: Math.round(top + row * (h + gap)),
      width: Math.round(w),
      height: Math.round(h),
    };
  });
}

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
  post(wins.mirror, 'settings', { fps: overlays.mirror.fps || 30, theme });
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
  syncMirror(cfg);
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
  hideTaskbarOver(prevForeground);    // 전체화면 위에서 치면 작업 표시줄이 튀어나오지 않게
  chat.focus();
}

// 전체화면 창이 다시 앞에 온 뒤에 작업 표시줄을 되돌려야 안 깜빡임. 그새 다시 입력 중이면 그대로 둠
function restoreTaskbarsLater() {
  setTimeout(() => {
    const c = wins.chat;
    if (!c || c.isDestroyed() || !c.isFocused()) restoreTaskbars();
  }, 150);
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
  restoreTaskbarsLater();
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
      onStreams(payload);
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
  // 방송 화면 "직접 고르기": 지금 열린 창 목록 (작은 미리보기 포함, 이 앱 창은 뺌)
  listWindows: async () => {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 240, height: 135 }, fetchWindowIcons: false });
    const own = new Set(alive().map((w) => w.getMediaSourceId()));
    return sources.filter((s) => !own.has(s.id) && s.name && !/^Kuruma Overlay/.test(s.name)).slice(0, 40).map((s) => {
      const n = Number(String(s.id).split(':')[1]);
      return { name: s.name, exe: (Number.isFinite(n) && windowInfo(n)?.exe) || '', thumb: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL() };
    });
  },
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
    // 배치 화면에서 방송 칸을 옮기면 팝업 창도 바로 따라감
    if (merged.overlays.mirror.enabled && (merged.overlays.mirror.show || 'arrange') === 'arrange') arrangeWindows(lastPicked, merged);
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
  for (const name of ['gif', 'mirror', 'media', 'chat', 'voice']) {   // 만든 순서대로 쌓임: GIF가 맨 아래
    wins[name] = makeOverlay(path.join(__dirname, '..', 'renderer', `${name}.html`));
  }

  // 게임 쪽을 누르면 입력창에서 빠져나옴 → 다시 클릭 통과
  wins.chat.on('blur', () => { if (!wins.chat.isDestroyed()) { wins.chat.setIgnoreMouseEvents(true, { forward: true }); wins.chat.setFocusable(false); } });
  wins.chat.on('focus', () => hideTaskbarOver(prevForeground));   // 마우스로 입력창을 눌렀을 때도
  wins.chat.on('blur', restoreTaskbarsLater);

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
    popupsForDiscord(front);
  }, 400, (addr) => lastPicked.some((w) => String(addr) === String(w.id).split(':')[1]));   // 방송 팝업을 누른 건 디스코드 본창이 아님

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

  setInterval(() => syncMirror(), 3000);
  // 팝업을 누르면 팝업이 맨 위로 올라와서 닫기 버튼을 덮음 → 1초마다 버튼 창을 다시 위로
  setInterval(() => {
    keepClipped();
    const m = wins.mirror;
    if (!closers.length || popupsDown || !m || m.isDestroyed() || !m.isVisible()) return;
    if (foregroundIsFullscreen(ownHandles())) return;
    m.moveTop();
    chatOnTop();
  }, 1000);

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
  // 방송 팝업 닫기 버튼
  ipcMain.on('close-popup', (_e, id) => {
    const w = lastPicked.find((x) => x.id === id);
    if (!w || !Number.isFinite(hwndOf(w))) return;
    closeWindow(hwndOf(w));
    setTimeout(() => syncMirror().catch(() => {}), 600);
  });
  // 채팅 말풍선 위에 마우스가 있는 동안만 휠을 받음 (포커스는 안 가져감 → 게임·작업 표시줄 그대로)
  ipcMain.on('set-hover', (e, on) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win !== wins.chat || win.isFocused()) return;
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
process.on('exit', () => { try { restoreTaskbars(); } catch {} });   // 숨긴 작업 표시줄은 무슨 일이 있어도 되돌림

app.on('will-quit', () => {
  unstyle();   // 팝업 투명도·잘라낸 위 줄 되돌리기
  restoreTaskbars();
  globalShortcut.unregisterAll();
  feed && feed.stop();
  tunnel && tunnel.stop();
});

// 설정 창을 닫아도 오버레이와 트레이는 계속 실행
app.on('window-all-closed', (e) => e.preventDefault());
