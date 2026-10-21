const chat = document.getElementById('chat');
const list = document.getElementById('list');
const inputBox = document.getElementById('input');
const text = document.getElementById('text');

let settings = { fadeSec: 10, maxLines: 8, fontSize: 15, bgOpacity: 0.45 };
let inputMode = false;

function applySettings() {
  chat.style.setProperty('--fs', `${settings.fontSize}px`);
  document.documentElement.style.setProperty('--bg', settings.bgOpacity);
  while (list.children.length > settings.maxLines) list.firstChild.remove();
}

function scheduleFade(row) {
  clearTimeout(row._timer);
  if (!settings.fadeSec || inputMode) return;
  row._timer = setTimeout(() => {
    row.classList.add('gone');
    setTimeout(() => row.remove(), 500);
  }, settings.fadeSec * 1000);
}

function addMessage({ id, author = {}, text: body, mediaOnly }) {
  const row = document.createElement('div');
  row.className = 'msg plate fade';
  row.dataset.id = id;

  const line = document.createElement('span');
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = author.name ?? '?';
  name.style.color = ui.colorFor(author.id, author.color);
  const span = document.createElement('span');
  span.textContent = body;
  if (mediaOnly) span.className = 'note';
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

window.overlay.on('input-mode', (on) => {
  inputMode = on;
  inputBox.classList.toggle('on', on);
  for (const row of list.children) {
    row.classList.remove('gone');
    if (on) clearTimeout(row._timer); else scheduleFade(row);
  }
  if (on) { text.value = ''; text.focus(); }
});

text.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    window.overlay.send(text.value);
  } else if (e.key === 'Escape') {
    window.overlay.endInput();
  }
});

ui.bindStatus(document.getElementById('status'));
applySettings();
