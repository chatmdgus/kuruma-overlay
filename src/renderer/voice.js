const box = document.getElementById('voice');
const list = document.getElementById('list');
const bar = document.getElementById('bar');
const chan = document.getElementById('chan');
const meMic = document.getElementById('me-mic');
const meDeaf = document.getElementById('me-deaf');
const gear = document.getElementById('gear');

let settings = { scale: 1.25, gap: 6, bgOpacity: 0.45, showControls: true };
let me = null;          // 내 디스코드 ID
let members = [];
const rows = new Map(); // id → 줄 요소 (들어오고 나갈 때 효과를 주려고 계속 재사용)
let lastMine = '';

function applySettings() {
  box.style.setProperty('--vs', settings.scale);
  box.style.setProperty('--vgap', `${settings.gap}px`);
  document.documentElement.style.setProperty('--bg', settings.bgOpacity);
  bar.hidden = !settings.showControls;
}

// 요소에 한 번 재생되는 효과 클래스 붙이기
function play(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;   // 같은 효과를 다시 재생하려면 한 번 그려야 함
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

const stateKey = (m) => [m.selfMute || m.serverMute, m.selfDeaf || m.serverDeaf, m.streaming, m.video].map(Number).join('');

// 위쪽 막대: 내 마이크·스피커 상태(보기만) + 설정 버튼
function renderBar() {
  const mine = members.find((m) => m.id === me);
  const muted = !!(mine && (mine.selfMute || mine.serverMute));
  const deaf = !!(mine && (mine.selfDeaf || mine.serverDeaf));
  const key = mine ? `${muted}${deaf}` : '';
  if (key === lastMine) return;
  lastMine = key;
  meMic.replaceChildren(ui.icon('mic', { slash: muted || deaf, label: muted ? '마이크 꺼짐' : '마이크 켜짐' }));
  meDeaf.replaceChildren(ui.icon('headphones', { slash: deaf, label: deaf ? '스피커 꺼짐' : '스피커 켜짐' }));
  meMic.hidden = meDeaf.hidden = !mine;
  if (mine) { play(meMic, 'pop'); play(meDeaf, 'pop'); }
}

// 이름 옆 표시(LIVE, 카메라, 음소거) 다시 그리기
function fillBadges(row, m) {
  const deaf = m.selfDeaf || m.serverDeaf;
  const mute = m.selfMute || m.serverMute;
  row.classList.toggle('muted', !!(deaf || mute));
  const badges = row.querySelector('.badges');
  const items = [];
  if (m.streaming) {
    const live = document.createElement('span');
    live.className = 'live';
    live.textContent = 'LIVE';
    live.title = '화면 공유 중';
    items.push(live);
  }
  if (m.video) items.push(ui.icon('camera', { label: '카메라 켜짐' }));
  if (deaf) items.push(ui.icon('headphones', { slash: true, label: '스피커 꺼짐' }));
  else if (mute) items.push(ui.icon('mic', { slash: true, label: '마이크 꺼짐' }));
  badges.replaceChildren(...items);
}

function makeRow(m) {
  const row = document.createElement('div');
  row.className = 'vrow plate';
  row.dataset.id = m.id;
  const name = document.createElement('span');
  name.className = 'nm';
  const badges = document.createElement('span');
  badges.className = 'badges';
  row.append(ui.avatar(m), name, badges);
  return row;
}

function updateRow(row, m, fresh) {
  const name = row.querySelector('.nm');
  name.textContent = m.name;
  name.style.color = m.color || '';   // 역할 색
  const key = stateKey(m);
  if (fresh || row.dataset.state !== key) {
    fillBadges(row, m);
    if (!fresh) play(row.querySelector('.badges'), 'pop');
    row.dataset.state = key;
  }
}

function showChannel(name) {
  const text = chan.querySelector('span');
  if (!name) { chan.classList.add('gone'); return; }
  if (text.textContent !== name) {
    text.textContent = name;
    play(chan, 'swap');
  }
  chan.classList.remove('gone');
}

function render(next) {
  const data = Array.isArray(next) ? { members: next } : (next || {});
  members = data.members || [];
  showChannel(members.length ? data.channelName : null);

  const ids = new Set(members.map((m) => m.id));
  // 나간 사람: 살짝 커졌다가 줄어들며 사라진 뒤 제거
  for (const [id, row] of rows) {
    if (ids.has(id) || row.classList.contains('leaving')) continue;
    row.classList.add('leaving');
    row.addEventListener('animationend', () => { row.remove(); if (rows.get(id) === row) rows.delete(id); }, { once: true });
  }
  // 들어온 사람은 통통 튀며 등장, 있던 사람은 그대로 두고 상태만 바꿈
  let prev = null;
  for (const m of members) {
    let row = rows.get(m.id);
    const fresh = !row || row.classList.contains('leaving');
    if (fresh) {
      if (row) row.remove();
      row = makeRow(m);
      rows.set(m.id, row);
      play(row, 'enter');
    }
    updateRow(row, m, fresh);
    const want = prev ? prev.nextSibling : list.firstChild;
    if (want !== row) list.insertBefore(row, want);
    prev = row;
  }
  renderBar();
}

chan.prepend(ui.icon('speaker', { label: '음성 채널' }));
gear.append(ui.icon('gear', { label: '설정' }));
gear.addEventListener('click', () => window.overlay.openSettings());
ui.clickable(gear);

window.overlay.on('settings', (s) => { settings = { ...settings, ...s }; applySettings(); });
window.overlay.on('voice', render);
window.overlay.on('reset', () => render({ members: [] }));

ui.bindStatus(document.getElementById('status'), (c) => {
  if (c?.user?.id && c.user.id !== me) { me = c.user.id; lastMine = null; renderBar(); }
});
applySettings();
render({ members: [] });
