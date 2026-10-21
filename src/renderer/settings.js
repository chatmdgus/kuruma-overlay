const $ = (id) => document.getElementById(id);
const NAMES = { chat: '채팅', media: '미디어', voice: '음성' };
const SNAP = 0.015;
const MIN = 0.04;

let state = null;      // 편집 중인 설정 (monitors, overlays, appearance, hotkeys, 연결)
let defaults = null;
let displays = [];
let resolved = {};
let view = null;       // 무대 좌표 변환 정보

const clone = (o) => JSON.parse(JSON.stringify(o));
const roleId = (role) => state.monitors[role] ?? resolved[role];
const displayById = (id) => displays.find((d) => d.id === String(id)) || displays[0];

// ---------- 모니터 선택 ----------
function fillSelects() {
  for (const role of ['main', 'sub']) {
    const sel = $(`mon-${role}`);
    sel.replaceChildren(...displays.map((d) => {
      const o = document.createElement('option');
      o.value = d.id;
      o.textContent = d.label;
      return o;
    }));
    sel.value = String(roleId(role));
    sel.onchange = () => { state.monitors[role] = sel.value; render(); preview(); };
  }
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

// 화면 좌표(px) ↔ 무대 좌표
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
  return { left: m.left + o.rect.x * m.width, top: m.top + o.rect.y * m.height, width: o.rect.w * m.width, height: o.rect.h * m.height };
}

function render() {
  computeView();
  const stage = $('stage');
  const nodes = [];

  for (const d of displays) {
    const r = monitorBox(d);
    const el = document.createElement('div');
    const roles = rolesOf(d);
    el.className = 'mon' + (roles.length ? ' used' : '');
    Object.assign(el.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const tag = document.createElement('div');
    tag.className = 'tag';
    const b = document.createElement('b');
    b.textContent = roles.length ? roles.join('·') : '사용 안 함';
    tag.append(b, document.createTextNode(`  ${d.label}`));
    el.append(tag);
    nodes.push(el);
  }

  for (const name of Object.keys(NAMES)) {
    const r = overlayStageRect(name);
    const el = document.createElement('div');
    el.className = `box ${name}` + (state.overlays[name].enabled ? '' : ' off');
    el.dataset.name = name;
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
  o.rect = { x: round(x), y: round(y), w: round(w), h: round(h) };
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

// ---------- 표시 옵션 ----------
// 슬라이더: 값이 바뀌면 state에 넣고 바로 미리보기
function bindRange(id, get, set, fmt) {
  const el = $(id);
  const out = $(`${id}-out`);
  el.value = get();
  out.textContent = fmt(Number(el.value));
  el.oninput = () => { set(Number(el.value)); out.textContent = fmt(Number(el.value)); preview(); };
}

function fillOptions() {
  const o = state.overlays;
  for (const name of Object.keys(NAMES)) {
    const cb = $(`en-${name}`);
    cb.checked = o[name].enabled;
    cb.onchange = () => { o[name].enabled = cb.checked; render(); preview(); };
  }

  $('chat-fade').value = String(o.chat.fadeSec);
  $('chat-fade').onchange = (e) => { o.chat.fadeSec = Number(e.target.value); preview(); };
  bindRange('chat-lines', () => o.chat.maxLines, (v) => { o.chat.maxLines = v; }, (v) => `${v}줄`);
  bindRange('chat-font', () => o.chat.fontSize, (v) => { o.chat.fontSize = v; }, (v) => `${v}px`);
  $('hotkey').value = state.hotkeys.input.replace('CommandOrControl', 'Ctrl');

  bindRange('media-max', () => o.media.maxItems, (v) => { o.media.maxItems = v; }, (v) => `${v}장`);
  bindRange('media-fade', () => o.media.fadeSec, (v) => { o.media.fadeSec = v; }, (v) => `${v}초`);

  bindRange('voice-scale', () => o.voice.scale, (v) => { o.voice.scale = v; }, (v) => `${Math.round(v * 100)}%`);
  bindRange('voice-gap', () => o.voice.gap, (v) => { o.voice.gap = v; }, (v) => `${v}px`);
  $('voice-controls').checked = o.voice.showControls !== false;
  $('voice-controls').onchange = (e) => { o.voice.showControls = e.target.checked; preview(); };

  bindRange('bg-opacity', () => state.appearance.bgOpacity, (v) => { state.appearance.bgOpacity = v; }, (v) => `${Math.round(v * 100)}%`);
}

// ---------- 연결 ----------
const CONN_TEXT = { setup: '연결 안 됨', connecting: '연결하는 중', online: '연결됨', offline: '연결 끊김', error: '토큰이 맞지 않음' };

function showConnection(c) {
  const el = $('conn');
  el.dataset.state = c?.state || 'setup';
  el.lastChild.textContent = c?.mock ? '가짜 데이터 모드' : (c?.reason === 'bad_url' ? '주소가 올바르지 않음' : (CONN_TEXT[c?.state] || ''));
}

const splitIds = (v) => v.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

function fillConnection(cfg) {
  $('server-url').value = cfg.serverUrl || '';
  $('token').value = cfg.sessionToken || '';
  $('guild-id').value = cfg.subscribe?.guildId || '';
  $('channel-ids').value = (cfg.subscribe?.channelIds || []).join(', ');
  $('token-show').onclick = () => {
    const t = $('token');
    t.type = t.type === 'password' ? 'text' : 'password';
    $('token-show').textContent = t.type === 'password' ? '보기' : '숨기기';
  };
}

function readConnection() {
  return {
    serverUrl: $('server-url').value.trim(),
    sessionToken: $('token').value.trim(),
    subscribe: { guildId: $('guild-id').value.trim(), channelIds: splitIds($('channel-ids').value), voiceChannelIds: [] },
  };
}

// ---------- 미리보기와 저장 ----------
let previewTimer = null;
function preview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    window.settingsApi.preview({ monitors: state.monitors, overlays: state.overlays, appearance: state.appearance });
  }, 40);
}

$('reset').onclick = () => {
  for (const name of Object.keys(NAMES)) {
    state.overlays[name].monitor = defaults.overlays[name].monitor;
    state.overlays[name].rect = clone(defaults.overlays[name].rect);
  }
  render();
  preview();
};

$('save').onclick = async () => {
  await window.settingsApi.save({ monitors: state.monitors, overlays: state.overlays, appearance: state.appearance, ...readConnection() });
  $('status').textContent = '저장함';
  setTimeout(() => { $('status').textContent = ''; }, 2000);
};

$('cancel').onclick = () => window.settingsApi.close();

window.addEventListener('resize', () => state && render());

(async () => {
  const res = await window.settingsApi.get();
  state = clone({ monitors: res.config.monitors, overlays: res.config.overlays, appearance: res.config.appearance, hotkeys: res.config.hotkeys });
  defaults = res.defaults;
  displays = res.displays;
  resolved = res.resolved;
  // 처음엔 실제로 쓰이는 모니터를 명시해 둠
  state.monitors.main = state.monitors.main ?? resolved.main;
  state.monitors.sub = state.monitors.sub ?? resolved.sub;
  fillConnection(res.config);
  showConnection(res.mock ? { state: 'online', mock: true } : res.connection);
  window.settingsApi.onConnection(showConnection);
  fillSelects();
  fillOptions();
  render();
})();
