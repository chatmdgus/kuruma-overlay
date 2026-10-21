const list = document.getElementById('list');
const inputBox = document.getElementById('input');
const text = document.getElementById('text');

let settings = { fadeSec: 10, maxLines: 5 };
let inputMode = false;

function scheduleFade(row) {
  clearTimeout(row._timer);
  if (!settings.fadeSec || inputMode) return;
  row._timer = setTimeout(() => {
    row.classList.add('gone');
    setTimeout(() => row.remove(), 500);
  }, settings.fadeSec * 1000);
}

function addMessage({ id, author, text: body }) {
  const row = document.createElement('div');
  row.className = 'msg fade';
  row.dataset.id = id;
  const name = document.createElement('b');
  name.textContent = author?.name ?? '?';
  if (author?.color) name.style.color = author.color;
  const span = document.createElement('span');
  span.textContent = body;
  row.append(name, span);
  list.appendChild(row);
  while (list.children.length > settings.maxLines) list.firstChild.remove();
  scheduleFade(row);
}

window.overlay.on('settings', (s) => { settings = { ...settings, ...s }; });
window.overlay.on('message', addMessage);
window.overlay.on('message-delete', (id) => list.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove());

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
