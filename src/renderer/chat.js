const chat = document.getElementById('chat');
const list = document.getElementById('list');
const inputBox = document.getElementById('input');
const text = document.getElementById('text');

let settings = { fadeSec: 10, maxLines: 8, fontSize: 15, bgOpacity: 0.45 };
let typing = false;   // 입력창에 커서가 있는 동안은 메시지가 안 사라짐

function applySettings() {
  chat.style.setProperty('--fs', `${settings.fontSize}px`);
  document.documentElement.style.setProperty('--bg', settings.bgOpacity);
  while (list.children.length > settings.maxLines) list.firstChild.remove();
}

function scheduleFade(row) {
  clearTimeout(row._timer);
  if (!settings.fadeSec || typing) return;
  row._timer = setTimeout(() => {
    row.classList.add('gone');
    setTimeout(() => row.remove(), 500);
  }, settings.fadeSec * 1000);
}

function addMessage({ id, author = {}, text: body, mediaOnly, channel }) {
  const row = document.createElement('div');
  row.className = 'msg plate fade';
  row.dataset.id = id;

  const line = document.createElement('span');
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = author.name ?? '?';
  if (author.color) name.style.color = author.color;   // 역할 색 (없으면 기본 흰색)
  const span = document.createElement('span');
  span.textContent = body;
  if (mediaOnly) span.className = 'note';
  if (channel) {
    const tag = document.createElement('span');
    tag.className = 'ch';
    tag.textContent = `#${channel}`;
    line.append(tag);
  }
  line.append(name, span);

  row.append(ui.avatar(author), line);
  list.appendChild(row);
  while (list.children.length > settings.maxLines) list.firstChild.remove();
  scheduleFade(row);
}

window.overlay.on('settings', (s) => { settings = { ...settings, ...s }; applySettings(); });
window.overlay.on('message', addMessage);
window.overlay.on('message-delete', (id) => list.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove());
window.overlay.on('reset', () => list.replaceChildren());
// 입력창: 어느 채널로 보내는지
// 보낼 채널: 입력창 왼쪽 버튼으로 고름. "자동"이면 마지막으로 글이 올라온 채널
const targetBtn = document.getElementById('target');
const pick = document.getElementById('pick');
let channels = [];
let target = { id: null, name: null, auto: true };

function paintTarget() {
  targetBtn.textContent = target.name ? `#${target.name}` : '#…';
  targetBtn.classList.toggle('auto', target.auto);
  text.placeholder = '메시지 보내기';
}
function openPick(on) {
  pick.hidden = !on;
  if (!on) return;
  const item = (label, id, active, note) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'item' + (active ? ' on' : '');
    b.textContent = label;
    if (note) { const s = document.createElement('small'); s.textContent = note; b.append(s); }
    b.onclick = () => { window.overlay.setTarget(id); openPick(false); text.focus(); };
    return b;
  };
  pick.replaceChildren(
    item('자동', null, target.auto, '마지막 글이 올라온 채널'),
    ...channels.map((c) => item(`#${c.name}`, c.id, !target.auto && c.id === target.id)),
  );
  pick.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}
targetBtn.addEventListener('mousedown', (e) => e.preventDefault());   // 입력창 커서 유지
pick.addEventListener('mousedown', (e) => e.preventDefault());
targetBtn.addEventListener('click', () => { text.focus(); openPick(pick.hidden); });

window.overlay.on('channels', (list) => { channels = list || []; if (!pick.hidden) openPick(true); });
window.overlay.on('target', (t) => { target = t || target; paintTarget(); });

// 입력창 켜기/끄기 (단축키). 켤 때는 바로 칠 수 있게 커서를 넣음
window.overlay.on('input-mode', ({ on, focus }) => {
  inputBox.classList.toggle('on', on);
  if (!on) text.blur();
  else if (focus) text.focus();
});

// 커서가 들어오면 지난 메시지를 다시 보여주고, 나가면 다시 사라지게
function setTyping(on) {
  typing = on;
  inputBox.classList.toggle('typing', on);
  for (const row of list.children) {
    row.classList.remove('gone');
    if (on) clearTimeout(row._timer); else scheduleFade(row);
  }
}
text.addEventListener('focus', () => setTyping(true));
text.addEventListener('blur', () => {
  // 채널 목록을 누르는 중이면 입력을 끝내지 않음
  setTimeout(() => { if (document.activeElement !== text) { setTyping(false); openPick(false); window.overlay.endInput(); } }, 120);
});

text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    if (text.value.trim()) window.overlay.send(text.value);
    text.value = '';
  } else if (e.key === 'Escape') {
    if (!pick.hidden) openPick(false); else text.blur();
  } else if (e.key === 'Tab' && channels.length) {   // Tab / Shift+Tab: 다음·이전 채널
    e.preventDefault();
    const i = channels.findIndex((c) => c.id === target.id);
    const next = channels[(i + (e.shiftKey ? -1 : 1) + channels.length) % channels.length];
    window.overlay.setTarget(next.id);
  }
});
// 클릭 통과 창이라 입력창 위에 마우스가 있을 때만 클릭을 받음
ui.clickable(inputBox);

ui.bindStatus(document.getElementById('status'));
applySettings();
