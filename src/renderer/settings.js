const $ = (id) => document.getElementById(id);
// 음성은 디스코드 기본 오버레이를 쓰기로 해서 설정에서 뺌 (코드는 남겨둠)
const NAMES = { chat: '채팅', media: '사진·영상' };
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
    b.onclick = () => { o[name].enabled = !o[name].enabled; paint(); render(); preview(); };
    paint();
    return b;
  });
  $('enabled').replaceChildren(...chips);

  bindSeg('chat-size', SIZE3([13, 15, 18]), () => o.chat.fontSize, (v) => { o.chat.fontSize = v; });
  bindSeg('chat-fade', [5, 10, 15, 30].map((v) => ({ label: `${v}초`, value: v })).concat({ label: '안 사라짐', value: 0 }), () => o.chat.fadeSec, (v) => { o.chat.fadeSec = v; });
  bindSeg('chat-lines', [5, 8, 12].map((v) => ({ label: `${v}줄`, value: v })), () => o.chat.maxLines, (v) => { o.chat.maxLines = v; });

  bindSeg('media-max', [1, 2, 3].map((v) => ({ label: `${v}장`, value: v })), () => o.media.maxItems, (v) => { o.media.maxItems = v; });
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

  for (const name of Object.keys(NAMES)) {
    const r = overlayStageRect(name);
    const el = document.createElement('div');
    el.className = `box ${name}` + (state.overlays[name].enabled ? '' : ' off');
    Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    el.textContent = NAMES[name];
    const handle = document.createElement('div');
    handle.className = 'handle';
    el.append(handle);
    el.addEventListener('pointerdown', (e) => startDrag(e, name, e.target === handle ? 'resize' : 'move'));
    nodes.push(el);
  }

  stage.replaceChildren(...nodes);
}

// 무대 좌표의 상자를 해당 모니터 기준 비율로 되돌림
function commitRect(name, box, mode) {
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
    w = Math.max(MIN, Math.min(w, 1 - x));
    h = Math.max(MIN, Math.min(h, 1 - y));
  }
  x = Math.min(Math.max(0, x), 1 - w);
  y = Math.min(Math.max(0, y), 1 - h);
  if (x < SNAP) x = 0;
  if (y < SNAP) y = 0;
  if (1 - (x + w) < SNAP) { if (mode === 'move') x = 1 - w; else w = 1 - x; }
  if (1 - (y + h) < SNAP) { if (mode === 'move') y = 1 - h; else h = 1 - y; }

  o.monitor = role;
  o[rectKey(o)] = { x: round(x), y: round(y), w: round(w), h: round(h) };
}

const round = (v) => Math.round(v * 1000) / 1000;

function startDrag(e, name, mode) {
  e.preventDefault();
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  el.classList.add('dragging');
  const start = { x: e.clientX, y: e.clientY, ...overlayStageRect(name) };

  const onMove = (ev) => {
    const dx = ev.clientX - start.x;
    const dy = ev.clientY - start.y;
    const box = mode === 'move'
      ? { left: start.left + dx, top: start.top + dy, width: start.width, height: start.height }
      : { left: start.left, top: start.top, width: start.width + dx, height: start.height + dy };
    commitRect(name, box, mode);
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

$('reset').onclick = () => {
  for (const name of Object.keys(NAMES)) {
    state.overlays[name].monitor = defaults.overlays[name].monitor;
    state.overlays[name].rect = clone(defaults.overlays[name].rect);
    state.overlays[name].rectTall = clone(defaults.overlays[name].rectTall);
  }
  render();
  preview();
};

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

  fillSetup();
  fillMain();
  showView(res.mock || isConfigured(res.config) ? 'main' : 'setup');
})();
