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
window.overlay.on('target', (ch) => {
  text.placeholder = ch ? `#${ch}에 메시지 보내기` : '메시지 보내기';
});

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
text.addEventListener('blur', () => { setTyping(false); window.overlay.endInput(); });

text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    if (text.value.trim()) window.overlay.send(text.value);
    text.value = '';
  } else if (e.key === 'Escape') {
    text.blur();
  }
});
// 클릭 통과 창이라 입력창 위에 마우스가 있을 때만 클릭을 받음
ui.clickable(inputBox);

ui.bindStatus(document.getElementById('status'));
applySettings();
