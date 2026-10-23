const $ = (id) => document.getElementById(id);
// 음성은 디스코드 기본 오버레이를 쓰기로 해서 설정에서 뺌 (코드는 남겨둠)
const NAMES = { chat: '채팅', media: '사진·영상', gif: '내 GIF' };
const SNAP = 0.015;
const MIN = 0.04;

let state = null;      // 편집 중인 설정 전체
let defaults = null;
let displays = [];
let resolved = {};
let view = null;       // 무대 좌표 변환 정보
let lastConn = null;
let lastTunnel = null;

const clone = (o) => JSON.parse(JSON.stringify(o));
const roleId = (role) => state.monitors[role] ?? resolved[role];
const displayById = (id) => displays.find((d) => d.id === String(id)) || displays[0];
// 세로 모니터에 놓인 오버레이는 rectTall에 따로 저장
const rectKey = (o) => { const b = displayById(roleId(o.monitor)).bounds; return b.height > b.width ? 'rectTall' : 'rect'; };
const rectOf = (name) => { const o = state.overlays[name]; return o[rectKey(o)] || defaults.overlays[name][rectKey(o)]; };

// ---------- 버튼 묶음 (슬라이더·드롭다운 대신) ----------
// options: [{ label, value }]. 숫자 값은 저장된 값과 가장 가까운 버튼을 켬
function bindSeg(id, options, get, set, { live = true } = {}) {
  const box = $(id);
  box.setAttribute('role', 'radiogroup');
  const pick = () => {
    const cur = get();
    if (typeof cur === 'number') {
      return options.reduce((best, o, i) => (Math.abs(o.value - cur) < Math.abs(options[best].value - cur) ? i : best), 0);
    }
    return Math.max(0, options.findIndex((o) => o.value === cur));
  };
  const buttons = options.map((o) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.textContent = o.label;
    b.onclick = () => { set(o.value); paint(); if (live) preview(); };
    return b;
  });
  const paint = () => { const i = pick(); buttons.forEach((b, j) => b.setAttribute('aria-checked', String(i === j))); };
  box.replaceChildren(...buttons);
  paint();
  return paint;
}

const SIZE3 = (vals) => [{ label: '작게', value: vals[0] }, { label: '보통', value: vals[1] }, { label: '크게', value: vals[2] }];
const ONOFF = [{ label: '켜기', value: true }, { label: '끄기', value: false }];

// ---------- 연결 상태 표시 ----------
const CONN_TEXT = { setup: '연결 안 됨', connecting: '연결하는 중', online: '연결됨', offline: '연결 끊김', error: '토큰이 맞지 않음' };
const TUNNEL_TEXT = { off: '꺼짐', starting: '여는 중', open: '열림', failed: '실패', stopped: '꺼짐' };

function paintPill(el, state, text) {
  el.dataset.state = state;
  el.lastChild.textContent = text;
}

function showConnection(c) {
  lastConn = c;
  const text = c?.mock ? '가짜 데이터 모드' : (c?.reason === 'bad_url' ? '서버 주소가 올바르지 않음' : CONN_TEXT[c?.state] || '');
  for (const id of ['conn', 'conn2']) paintPill($(id), c?.state || 'setup', text);
}

function showTunnel(t) {
  lastTunnel = t;
  const map = { open: 'online', starting: 'connecting', failed: 'error' };
  const text = `SSH ${TUNNEL_TEXT[t?.state] || ''}${t?.detail ? ` · ${t.detail}` : ''}`;
  for (const id of ['tunnel', 'tunnel2']) paintPill($(id), map[t?.state] || 'setup', text);
  $('tunnel2').hidden = !t || t.state === 'off';
}

// ---------- 처음 설정 ----------
const splitIds = (v) => v.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

function fillSetup() {
  $('server-url').value = state.serverUrl || '';
  $('token').value = state.sessionToken || '';
  $('channel-ids').value = (state.subscribe?.channelIds || []).join(', ');
  $('token-show').onclick = () => {
    const t = $('token');
    t.type = t.type === 'password' ? 'text' : 'password';
    $('token-show').textContent = t.type === 'password' ? '보기' : '숨기기';
  };
  // 예전 방식(토큰·채널)을 쓰고 있으면 고급 칸을 펼쳐 둠
  $('adv').open = !!(state.sessionToken || state.subscribe?.channelIds?.length);

  const s = state.ssh;
  $('ssh-host').value = s.host || '';
  $('ssh-user').value = s.user || 'ubuntu';
  $('ssh-key').value = s.keyPath || '';
  $('ssh-port').value = s.remotePort || 8790;
  $('ssh-pick').onclick = async () => { const p = await window.settingsApi.pickKey(); if (p) $('ssh-key').value = p; };
  const toggleFields = () => { $('ssh-fields').hidden = !state.ssh.enabled; };
  bindSeg('ssh-on', [{ label: '사용', value: true }, { label: '사용 안 함', value: false }], () => state.ssh.enabled, (v) => { state.ssh.enabled = v; toggleFields(); }, { live: false });
  toggleFields();

  for (const role of ['main', 'sub']) {
    bindSeg(`mon-${role}`, displays.map((d, i) => ({ label: `${i + 1}번 ${d.bounds.width}×${d.bounds.height}${d.primary ? ' (주)' : ''}`, value: d.id })),
      () => String(roleId(role)), (v) => { state.monitors[role] = v; render(); }, { live: true });
  }

  $('login').onclick = doLogin;
  $('logout').onclick = async () => {
    await window.settingsApi.logout();
    state.auth = { session: '', user: null };
    paintAccount();
  };
  paintAccount();
}

// 디스코드 계정 칸: 로그인 상태 표시
function paintAccount(msg, bad) {
  const user = state.auth?.user;
  $('who').hidden = !user;
  $('logout').hidden = !user;
  $('login').hidden = !!user;
  if (user) {
    $('who-name').textContent = user.name;
    $('who-av').textContent = (user.name || '?').slice(0, 1);
  }
  $('login-msg').textContent = msg || (user ? '다른 계정으로 바꾸려면 로그아웃하고 다시 로그인하세요.' : '브라우저에서 디스코드 승인 화면이 열려요. 승인하면 자동으로 연결돼요.');
  $('login-msg').classList.toggle('bad', !!bad);
}

function serverProblem() {
  if (state.ssh.enabled) {
    if (!state.ssh.host) return 'SSH 서버 IP를 입력하세요';
    if (!state.ssh.keyPath) return 'SSH 키 파일을 지정하세요';
  } else if (state.serverUrl && !/^wss?:\/\//.test(state.serverUrl)) {
    return '서버 주소는 ws:// 또는 wss:// 로 시작해야 해요';
  }
  return '';
}

async function doLogin() {
  readSetup();
  const problem = serverProblem();
  if (problem) { paintAccount(problem, true); return; }
  const btn = $('login');
  btn.disabled = true;
  btn.classList.add('busy');
  paintAccount('브라우저에서 디스코드 승인을 눌러 주세요…');
  const res = await window.settingsApi.login({ serverUrl: state.serverUrl, ssh: state.ssh });
  btn.disabled = false;
  btn.classList.remove('busy');
  if (res.ok) {
    state.auth = { session: 'saved', user: { id: res.user.id, name: res.user.name } };
    $('setup-msg').textContent = '';
    paintAccount();
    $('who').classList.remove('pop'); void $('who').offsetWidth; $('who').classList.add('pop');
  } else {
    paintAccount(res.error, true);
  }
}

function readSetup() {
  const port = Math.round(Number($('ssh-port').value)) || 8790;
  state.serverUrl = $('server-url').value.trim();
  state.sessionToken = $('token').value.trim();
  state.subscribe = { guildId: '', channelIds: splitIds($('channel-ids').value), voiceChannelIds: [] };
  state.ssh = { ...state.ssh, host: $('ssh-host').value.trim(), user: $('ssh-user').value.trim() || 'ubuntu', keyPath: $('ssh-key').value.trim(), localPort: port, remotePort: port };
}

function setupProblem() {
  const server = serverProblem();
  if (server) return server;
  if (!state.auth?.user && !state.sessionToken) return '디스코드로 로그인해 주세요';
  if (state.subscribe.channelIds.some((id) => !/^\d{5,25}$/.test(id))) return '채팅 채널 ID는 숫자여야 해요';
  return '';
}

const isConfigured = (cfg) => !!((cfg.auth?.session || cfg.sessionToken) && (!cfg.ssh?.enabled || (cfg.ssh.host && cfg.ssh.keyPath)) && cfg.monitors?.main);

// ---------- 평소 설정 ----------
function fillMain() {
  const o = state.overlays;

  const chips = Object.keys(NAMES).map((name) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip ${name}`;
    b.textContent = NAMES[name];
    const paint = () => b.setAttribute('aria-pressed', String(o[name].enabled));
    b.onclick = async () => {
      if (name === 'gif' && !o.gif.enabled && !o.gif.file && !(await pickGif())) return;   // 처음 켤 때 GIF부터 고르기
      o[name].enabled = !o[name].enabled; paint(); render(); preview();
    };
    paint();
    return b;
  });
  $('enabled').replaceChildren(...chips);

  bindSeg('chat-size', SIZE3([13, 15, 18]), () => o.chat.fontSize, (v) => { o.chat.fontSize = v; });
  bindSeg('chat-fade', [5, 10, 15, 30].map((v) => ({ label: `${v}초`, value: v })).concat({ label: '안 사라짐', value: 0 }), () => o.chat.fadeSec, (v) => { o.chat.fadeSec = v; });
  bindSeg('chat-lines', [5, 8, 12].map((v) => ({ label: `${v}줄`, value: v })), () => o.chat.maxLines, (v) => { o.chat.maxLines = v; });

  bindSeg('media-max', [1, 2, 3].map((v) => ({ label: `${v}장`, value: v })), () => o.media.maxItems, (v) => { o.media.maxItems = v; });
  // 내 GIF
  const paintGif = () => { $('gif-name').textContent = o.gif.file ? o.gif.name || 'GIF' : '아직 안 골랐음'; $('gif-clear').hidden = !o.gif.file; };
  paintGif();
  $('gif-pick').onclick = async () => { if (await pickGif()) { paintGif(); fillChipsGif(); } };
  $('gif-clear').onclick = () => { o.gif.file = ''; o.gif.name = ''; o.gif.enabled = false; paintGif(); fillChipsGif(); render(); preview(); };
  bindSeg('gif-opacity', [1, 0.8, 0.6, 0.4].map((v) => ({ label: `${Math.round(v * 100)}%`, value: v })), () => o.gif.opacity ?? 1, (v) => { o.gif.opacity = v; });
  bindSeg('media-fade', [5, 8, 10].map((v) => ({ label: `${v}초`, value: v })), () => o.media.fadeSec, (v) => { o.media.fadeSec = v; });


  bindSeg('bg-opacity', [{ label: '없음', value: 0 }, { label: '연하게', value: 0.3 }, { label: '보통', value: 0.5 }, { label: '진하게', value: 0.72 }],
    () => state.appearance.bgOpacity, (v) => { state.appearance.bgOpacity = v; });
  bindSeg('hide-discord', ONOFF, () => state.appearance.hideOnDiscord !== false, (v) => { state.appearance.hideOnDiscord = v; }, { live: false });
  bindSeg('at-login', ONOFF, () => !!state.launch.atLogin, (v) => { state.launch.atLogin = v; }, { live: false });
}

// ---------- 배치 무대 ----------
function computeView() {
  const stage = $('stage');
  const pad = 16;
  const minX = Math.min(...displays.map((d) => d.bounds.x));
  const minY = Math.min(...displays.map((d) => d.bounds.y));
  const maxX = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width));
  const maxY = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height));
  const w = stage.clientWidth - pad * 2;
  const h = stage.clientHeight - pad * 2;
  const scale = Math.min(w / (maxX - minX), h / (maxY - minY));
  const ox = pad + (w - (maxX - minX) * scale) / 2;
  const oy = pad + (h - (maxY - minY) * scale) / 2;
  view = { scale, minX, minY, ox, oy };
}

const toStage = (b) => ({
  left: view.ox + (b.x - view.minX) * view.scale,
  top: view.oy + (b.y - view.minY) * view.scale,
  width: b.width * view.scale,
  height: b.height * view.scale,
});

function monitorBox(d) { return toStage(d.bounds); }

function rolesOf(d) {
  const r = [];
  if (String(roleId('main')) === d.id) r.push('메인');
  if (String(roleId('sub')) === d.id) r.push('서브');
  return r;
}

function overlayStageRect(name) {
  const o = state.overlays[name];
  const m = monitorBox(displayById(roleId(o.monitor)));
  const r = rectOf(name);
  return { left: m.left + r.x * m.width, top: m.top + r.y * m.height, width: r.w * m.width, height: r.h * m.height };
}

function render() {
  const stage = $('stage');
  if (!stage.clientWidth) return;   // 처음 설정 화면이 떠 있을 때
  computeView();
  const nodes = [];

  for (const d of displays) {
    const r = monitorBox(d);
    const el = document.createElement('div');
    const roles = rolesOf(d);
    el.className = 'mon' + (roles.length ? ' used' : '');
    Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = roles.length ? roles.join('·') : '사용 안 함';
    el.append(tag);
    nodes.push(el);
  }

  // 채팅이 항상 위에 오게 사진·영상을 먼저 그림
  for (const name of ['gif', 'media', 'chat']) {
    const r = overlayStageRect(name);
    const el = document.createElement('div');
    el.className = `box ${name}` + (state.overlays[name].enabled ? '' : ' off');
    Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    el.textContent = NAMES[name];
    // 테두리 근처면 그 방향으로 크기 조절, 안쪽이면 이동
    el.addEventListener('pointermove', (e) => { if (!el.classList.contains('dragging')) el.style.cursor = CURSOR[edgesAt(el, e)] || ''; });
    el.addEventListener('pointerdown', (e) => { const edges = edgesAt(el, e); startDrag(e, name, edges ? 'resize' : 'move', edges); });
    nodes.push(el);
  }

  stage.replaceChildren(...nodes);
}

// 무대 좌표의 상자를 해당 모니터 기준 비율로 되돌림
function commitRect(name, box, mode, edges = '') {
  const o = state.overlays[name];
  let role = o.monitor;

  if (mode === 'move') {
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const hit = displays.find((d) => {
      const m = monitorBox(d);
      return cx >= m.left && cx <= m.left + m.width && cy >= m.top && cy <= m.top + m.height;
    });
    if (hit) {
      if (String(roleId('main')) === hit.id && String(roleId(o.monitor)) !== hit.id) role = 'main';
      else if (String(roleId('sub')) === hit.id && String(roleId(o.monitor)) !== hit.id) role = 'sub';
    }
  }

  const m = monitorBox(displayById(roleId(role)));
  let w = Math.min(1, Math.max(MIN, box.width / m.width));
  let h = Math.min(1, Math.max(MIN, box.height / m.height));
  let x = (box.left - m.left) / m.width;
  let y = (box.top - m.top) / m.height;

  if (mode === 'resize') {
    // 변 단위로 계산: 움직인 변만 0~1 안으로 자르고 붙임, 반대쪽 변은 그대로
    let x1 = (box.left - m.left) / m.width, y1 = (box.top - m.top) / m.height;
    let x2 = x1 + box.width / m.width, y2 = y1 + box.height / m.height;
    const snap = (v) => (v < SNAP ? 0 : v > 1 - SNAP ? 1 : v);
    if (edges.includes('w')) x1 = Math.min(snap(Math.max(0, x1)), x2 - MIN);
    if (edges.includes('e')) x2 = Math.max(snap(Math.min(1, x2)), x1 + MIN);
    if (edges.includes('n')) y1 = Math.min(snap(Math.max(0, y1)), y2 - MIN);
    if (edges.includes('s')) y2 = Math.max(snap(Math.min(1, y2)), y1 + MIN);
    o.monitor = role;
    o[rectKey(o)] = { x: round(x1), y: round(y1), w: round(x2 - x1), h: round(y2 - y1) };
    return;
  }
  x = Math.min(Math.max(0, x), 1 - w);
  y = Math.min(Math.max(0, y), 1 - h);
  if (x < SNAP) x = 0;
  if (y < SNAP) y = 0;
  if (1 - (x + w) < SNAP) x = 1 - w;
  if (1 - (y + h) < SNAP) y = 1 - h;

  o.monitor = role;
  o[rectKey(o)] = { x: round(x), y: round(y), w: round(w), h: round(h) };
}

const round = (v) => Math.round(v * 1000) / 1000;

const EDGE = 8;   // 테두리에서 이 픽셀 안쪽까지 크기 조절
const CURSOR = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
function edgesAt(el, e) {
  const r = el.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const edge = Math.min(EDGE, r.width / 4, r.height / 4);
  return (y < edge ? 'n' : y > r.height - edge ? 's' : '') + (x < edge ? 'w' : x > r.width - edge ? 'e' : '');
}

function startDrag(e, name, mode, edges = '') {
  e.preventDefault();
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  el.classList.add('dragging');
  const start = { x: e.clientX, y: e.clientY, ...overlayStageRect(name) };

  const onMove = (ev) => {
    const dx = ev.clientX - start.x;
    const dy = ev.clientY - start.y;
    let box;
    if (mode === 'move') box = { left: start.left + dx, top: start.top + dy, width: start.width, height: start.height };
    else {
      let l = start.left, t = start.top, r = start.left + start.width, b = start.top + start.height;
      if (edges.includes('w')) l += dx;
      if (edges.includes('e')) r += dx;
      if (edges.includes('n')) t += dy;
      if (edges.includes('s')) b += dy;
      box = { left: l, top: t, width: r - l, height: b - t };
    }
    commitRect(name, box, mode, edges);
    const r = overlayStageRect(name);
    Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    preview();
  };
  const onUp = () => {
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    render();
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
}

// ---------- 화면 전환, 미리보기, 저장 ----------
function showView(name) {
  $('setup').hidden = name !== 'setup';
  $('main').hidden = name !== 'main';
  if (name === 'main') requestAnimationFrame(render);
}

let previewTimer = null;
function preview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    window.settingsApi.preview({ monitors: state.monitors, overlays: state.overlays, appearance: state.appearance });
  }, 40);
}

const savable = () => ({
  serverUrl: state.serverUrl,
  sessionToken: state.sessionToken,
  subscribe: state.subscribe,
  ssh: state.ssh,
  launch: state.launch,
  monitors: state.monitors,
  overlays: state.overlays,
  appearance: state.appearance,
});

function flash(id, text) {
  $(id).textContent = text;
  clearTimeout(flash[id]);
  flash[id] = setTimeout(() => { $(id).textContent = id === 'main-msg' ? '채팅 입력은 Ctrl+Shift+D' : ''; }, 2500);
}

$('setup-done').onclick = async () => {
  readSetup();
  const problem = setupProblem();
  if (problem) { $('setup-msg').textContent = problem; $('setup-msg').className = 'msg bad'; return; }
  state.monitors.main = state.monitors.main ?? resolved.main;
  state.monitors.sub = state.monitors.sub ?? resolved.sub;
  await window.settingsApi.save(savable());
  $('setup-msg').textContent = '';
  showView('main');
  flash('main-msg', '저장함');
};
$('setup-back').onclick = () => showView('main');
$('open-setup').onclick = () => { $('setup-back').hidden = false; showView('setup'); };

// ---------- 업데이트 ----------
// 새 버전은 백그라운드로 받아두고, 다 받으면 "업데이트" 버튼이 켜짐 → 누르면 바로 설치 후 다시 켜짐
function showUpdate(u) {
  const b = $('update');
  if (!u || u.state === 'dev') { b.hidden = true; return; }
  b.hidden = false;
  b.disabled = u.state === 'downloading' || u.state === 'checking';
  b.className = u.state === 'ready' ? 'primary' : 'ghost';
  b.textContent = u.state === 'ready' ? `업데이트 (v${u.version})`
    : u.state === 'downloading' ? `새 버전 받는 중 ${u.percent || 0}%`
    : u.state === 'checking' ? '확인 중…'
    : u.state === 'latest' ? `최신 v${u.current}`
    : u.state === 'error' ? '업데이트 확인 실패 · 다시'
    : '업데이트 확인';
  b.onclick = () => window.settingsApi.update(u.state === 'ready' ? 'install' : 'check');
}

// ---------- 배치 프리셋 ----------
// 모니터를 세로·일반(16:9 근처)·와이드(21:9 이상)로 나누고, 크기는 화면 픽셀(배율 적용된 값) 기준으로 잡아서
// 작은 모니터에선 비율이 커지고 큰 모니터에선 작아짐 (인치·해상도 차이를 같이 반영)
const monitorKind = (b) => (b.height > b.width ? 'tall' : b.width / b.height >= 2 ? 'wide' : 'normal');
const PRESETS = [
  { id: 'side', label: '오른쪽 세로줄' },
  { id: 'bottom', label: '아래쪽' },
  { id: 'compact', label: '작게' },
];
function presetRects(id, b) {
  const W = b.width, H = b.height, m = 16, gap = 12;
  const kind = monitorKind(b);
  const px = (v, max) => Math.min(v, max);
  let chat, media;
  if (id === 'side') {
    if (kind === 'tall') {
      const half = (W - m * 2 - gap) / 2, h = H * 0.45;
      media = { x: m, y: H - m - h, w: half, h };
      chat = { x: m + half + gap, y: H - m - h, w: half, h };
    } else {
      const cw = px(460, W * 0.3), mw = px(430, W * 0.28), top = H * 0.34;
      chat = { x: W - m - cw, y: top, w: cw, h: H - top - m };
      media = { x: chat.x - gap - mw, y: top, w: mw, h: H - top - m };
    }
  } else if (id === 'bottom') {
    if (kind === 'tall') {
      media = { x: m, y: m, w: W - m * 2, h: H * 0.32 };
      chat = { x: m, y: H * 0.58, w: W - m * 2, h: H * 0.42 - m };
    } else {
      const h = px(380, H * 0.4), cw = px(kind === 'wide' ? 720 : 620, W * 0.42), mw = px(520, W * 0.3);
      chat = { x: m, y: H - m - h, w: cw, h };
      media = { x: W - m - mw, y: H - m - h, w: mw, h };
    }
  } else {
    const cw = px(380, W * (kind === 'tall' ? 0.6 : 0.28)), ch = px(440, H * 0.42), mh = px(300, H * 0.3);
    chat = { x: W - m - cw, y: m, w: cw, h: ch };
    media = { x: W - m - cw, y: m + ch + gap, w: cw, h: mh };
  }
  const ratio = (r) => ({ x: round(r.x / W), y: round(r.y / H), w: round(r.w / W), h: round(r.h / H) });
  return { chat: ratio(chat), media: ratio(media) };
}
// GIF 고르기 → 설정 폴더에 복사된 경로를 받아서 켬
async function pickGif() {
  const r = await window.settingsApi.pickGif();
  if (!r) return false;
  Object.assign(state.overlays.gif, { file: r.file, name: r.name, enabled: true });
  render();
  preview();
  return true;
}
function fillChipsGif() {
  const chip = document.querySelector('.chip.gif');
  if (chip) chip.setAttribute('aria-pressed', String(state.overlays.gif.enabled));
}

function applyPreset(id) {
  const d = displayById(roleId('sub'));
  const rects = presetRects(id, d.bounds);
  for (const name of Object.keys(rects)) {   // 프리셋은 채팅·사진만 (GIF는 그대로)
    const o = state.overlays[name];
    o.monitor = 'sub';
    o[rectKey(o)] = rects[name];
  }
  render();
  preview();
}
$('presets').replaceChildren(...PRESETS.map((p) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ghost sm';
  b.textContent = p.label;
  b.onclick = () => applyPreset(p.id);
  return b;
}));

$('save').onclick = async () => {
  await window.settingsApi.save(savable());
  flash('main-msg', '저장함');
};

$('cancel').onclick = () => window.settingsApi.close();

window.addEventListener('resize', () => state && render());

(async () => {
  const res = await window.settingsApi.get();
  state = clone(res.config);
  defaults = res.defaults;
  displays = res.displays;
  resolved = res.resolved;

  showConnection(res.mock ? { state: 'online', mock: true } : res.connection);
  showTunnel(res.tunnel);
  window.settingsApi.onConnection(showConnection);
  window.settingsApi.onTunnel(showTunnel);
  showUpdate(res.update);
  window.settingsApi.onUpdate(showUpdate);

  fillSetup();
  fillMain();
  showView(res.mock || isConfigured(res.config) ? 'main' : 'setup');
})();
