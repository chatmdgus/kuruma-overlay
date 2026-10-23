// 사진·영상: 최대 maxItems장을 쌓아서 보여주고, 각각 fadeSec 뒤 사라짐. 넘치면 대기열
// 크기는 지금 떠 있는 장수로 칸을 나눠서 비율 그대로 최대한 크게 (작은 이미지도 3배까지 키움)
const stage = document.getElementById('stage');
const queue = [];
let settings = { fadeSec: 8, maxItems: 3 };
const GAP = 8;
const MAX_UPSCALE = 3;

function applySettings() {
  pump();
  layout();
}

const natural = (el) => (el.tagName === 'VIDEO' ? [el.videoWidth, el.videoHeight] : [el.naturalWidth, el.naturalHeight]);

function layout() {
  const items = [...stage.children].filter((el) => !el.classList.contains('leaving'));
  if (!items.length) return;
  const W = stage.clientWidth - 16;
  const H = stage.clientHeight - 16;
  const portraitBox = W < H * 0.9;
  // 세로가 긴 창이면 위아래로, 넓은 창이면 옆으로 나란히
  const vertical = portraitBox || items.length === 1;
  const n = items.length;
  stage.classList.toggle('row', !vertical);
  // 각 장을 칸 하나를 다 쓰는 크기로 잡은 뒤, 합이 넘치면 같은 비율로 줄임 → 세로 사진은 세로로 길게 쓸 수 있음
  const sizes = items.map((el) => {
    const [nw, nh] = natural(el);
    if (!nw || !nh) return null;
    const s0 = Math.min(vertical ? W / nw : H / nh, vertical ? H / nh : W / nw, MAX_UPSCALE);
    return [nw * s0, nh * s0];
  });
  const room = (vertical ? H : W) - GAP * (n - 1);
  const used = sizes.reduce((t, sz) => t + (sz ? sz[vertical ? 1 : 0] : 0), 0);
  const k = used > room ? room / used : 1;
  items.forEach((el, i) => {
    if (!sizes[i]) return;
    el.style.width = `${Math.round(sizes[i][0] * k)}px`;
    el.style.height = `${Math.round(sizes[i][1] * k)}px`;
  });
}

function show(item) {
  const el = document.createElement(item.kind === 'video' ? 'video' : 'img');
  el.className = 'item fade';
  if (item.kind === 'video') {
    el.muted = true;
    el.autoplay = true;
    el.loop = true;
    el.playsInline = true;
    el.onloadedmetadata = layout;
  } else {
    el.onload = layout;
  }
  // 크기를 알기 전에는 서버가 알려준 크기로 자리 잡기
  if (item.width && item.height) { el.style.aspectRatio = `${item.width} / ${item.height}`; }
  el.src = item.url;
  const done = () => { el.remove(); pump(); layout(); };
  el.onerror = done;
  stage.appendChild(el);
  layout();
  setTimeout(() => {
    el.classList.add('gone', 'leaving');
    setTimeout(done, 500);
  }, settings.fadeSec * 1000);
}

function pump() {
  const live = () => [...stage.children].filter((el) => !el.classList.contains('leaving')).length;
  while (queue.length && live() < settings.maxItems) show(queue.shift());
}

window.overlay.on('settings', (s) => { settings = { ...settings, ...s }; applySettings(); });
window.overlay.on('media', (item) => {
  if (queue.length >= 12) queue.shift();
  queue.push(item);
  pump();
});
window.overlay.on('reset', () => { queue.length = 0; stage.replaceChildren(); });
window.addEventListener('resize', layout);

applySettings();
