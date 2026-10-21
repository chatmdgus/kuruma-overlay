const box = document.getElementById('voice');
const list = document.getElementById('list');
const bar = document.getElementById('bar');
const meMic = document.getElementById('me-mic');
const meDeaf = document.getElementById('me-deaf');
const gear = document.getElementById('gear');

let settings = { scale: 1.2, gap: 6, bgOpacity: 0.45, showControls: true };
let me = null;          // 내 디스코드 ID
let members = [];

function applySettings() {
  box.style.setProperty('--vs', settings.scale);
  box.style.setProperty('--vgap', `${settings.gap}px`);
  document.documentElement.style.setProperty('--bg', settings.bgOpacity);
  bar.hidden = !settings.showControls;
}

// 위쪽 막대: 내 마이크·스피커 상태(보기만) + 설정 버튼
function renderBar() {
  const mine = members.find((m) => m.id === me);
  const muted = !!(mine && (mine.selfMute || mine.serverMute));
  const deaf = !!(mine && (mine.selfDeaf || mine.serverDeaf));
  meMic.replaceChildren(ui.icon('mic', { slash: muted || deaf, label: muted ? '마이크 꺼짐' : '마이크 켜짐' }));
  meDeaf.replaceChildren(ui.icon('headphones', { slash: deaf, label: deaf ? '스피커 꺼짐' : '스피커 켜짐' }));
  // 음성 채널에 없으면 상태 아이콘은 숨기고 설정 버튼만
  meMic.hidden = meDeaf.hidden = !mine;
}

function render(next) {
  members = next;
  list.replaceChildren(...members.map((m) => {
    const row = document.createElement('div');
    const deaf = m.selfDeaf || m.serverDeaf;
    const mute = m.selfMute || m.serverMute;
    row.className = 'vrow plate' + (deaf || mute ? ' muted' : '');

    const name = document.createElement('span');
    name.className = 'nm';
    name.textContent = m.name;

    row.append(ui.avatar(m), name);
    if (deaf) row.append(ui.icon('headphones', { slash: true, label: '스피커 꺼짐' }));
    else if (mute) row.append(ui.icon('mic', { slash: true, label: '마이크 꺼짐' }));
    return row;
  }));
  renderBar();
}

gear.append(ui.icon('gear', { label: '설정' }));
gear.addEventListener('click', () => window.overlay.openSettings());
ui.clickable(gear);

window.overlay.on('settings', (s) => { settings = { ...settings, ...s }; applySettings(); });
window.overlay.on('voice', render);
window.overlay.on('reset', () => render([]));

ui.bindStatus(document.getElementById('status'), (c) => {
  if (c?.user?.id) { me = c.user.id; renderBar(); }
});
applySettings();
render([]);
