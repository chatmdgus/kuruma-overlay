// 최대 maxItems장을 동시에 쌓아서 보여주고, 각각 fadeSec 뒤 사라짐. 넘치면 대기열
const stage = document.getElementById('stage');
const queue = [];
let settings = { fadeSec: 8, maxItems: 3 };

function applySettings() {
  stage.style.setProperty('--n', settings.maxItems);
  pump();
}

function show(item) {
  const el = document.createElement(item.kind === 'video' ? 'video' : 'img');
  el.className = 'item fade';
  el.src = item.url;
  if (item.kind === 'video') {
    el.muted = true;
    el.autoplay = true;
    el.loop = true;
    el.playsInline = true;
  }
  const done = () => { el.remove(); pump(); };
  el.onerror = done;
  stage.appendChild(el);
  setTimeout(() => {
    el.classList.add('gone');
    setTimeout(done, 500);
  }, settings.fadeSec * 1000);
}

function pump() {
  while (queue.length && stage.children.length < settings.maxItems) show(queue.shift());
}

window.overlay.on('settings', (s) => { settings = { ...settings, ...s }; applySettings(); });
window.overlay.on('media', (item) => {
  if (queue.length >= 12) queue.shift();
  queue.push(item);
  pump();
});
window.overlay.on('reset', () => { queue.length = 0; stage.replaceChildren(); });

applySettings();
