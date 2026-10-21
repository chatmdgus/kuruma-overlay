const stage = document.getElementById('stage');
const queue = [];
let showing = false;
let settings = { fadeSec: 8 };

function next() {
  const item = queue.shift();
  if (!item) { showing = false; return; }
  showing = true;

  const el = document.createElement(item.kind === 'video' ? 'video' : 'img');
  el.className = 'fade';
  el.src = item.url;
  if (item.kind === 'video') {
    el.muted = true;
    el.autoplay = true;
    el.loop = true;
    el.playsInline = true;
  }
  el.onerror = () => { el.remove(); next(); };
  stage.replaceChildren(el);

  setTimeout(() => {
    el.classList.add('gone');
    setTimeout(() => { el.remove(); next(); }, 500);
  }, settings.fadeSec * 1000);
}

window.overlay.on('settings', (s) => { settings = { ...settings, ...s }; });
window.overlay.on('media', (item) => {
  if (queue.length >= 10) queue.shift();
  queue.push(item);
  if (!showing) next();
});
