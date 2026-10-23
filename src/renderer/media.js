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

// 위아래로 쌓기 / 옆으로 나란히 중에서 사진이 실제로 더 크게 보이는 쪽을 고름
// (세로 사진 여러 장은 옆으로, 가로 사진 여러 장은 위아래로)
function fitSizes(dims, W, H, vertical) {
  const n = dims.length;
  const sizes = dims.map((d) => {
    if (!d) return null;
    const [nw, nh] = d;
    const s0 = Math.min(W / nw, H / nh, MAX_UPSCALE);
    return [nw * s0, nh * s0];
  });
  const room = (vertical ? H : W) - GAP * (n - 1);
  const used = sizes.reduce((t, sz) => t + (sz ? sz[vertical ? 1 : 0] : 0), 0);
  const k = used > room ? room / used : 1;
  const out = sizes.map((sz) => (sz ? [sz[0] * k, sz[1] * k] : null));
  return { sizes: out, area: out.reduce((t, sz) => t + (sz ? sz[0] * sz[1] : 0), 0) };
}

function layout() {
  const items = [...stage.children].filter((el) => !el.classList.contains('leaving'));
  if (!items.length) return;
  const W = stage.clientWidth - 16;
  const H = stage.clientHeight - 16;
  const dims = items.map((el) => {
    const [nw, nh] = natural(el);
    return nw && nh ? [nw, nh] : null;
  });
  const col = fitSizes(dims, W, H, true);
  const row = fitSizes(dims, W, H, false);
  // 비슷하면 칸 모양을 따름 (세로로 긴 칸이면 위아래)
  const preferCol = W < H * 0.9;
  const vertical = items.length === 1 || (preferCol ? col.area >= row.area * 0.95 : col.area > row.area * 1.05);
  stage.classList.toggle('row', !vertical);
  const { sizes } = vertical ? col : row;
  items.forEach((el, i) => {
    if (!sizes[i]) return;
    el.style.width = `${Math.round(sizes[i][0])}px`;
    el.style.height = `${Math.round(sizes[i][1])}px`;
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
