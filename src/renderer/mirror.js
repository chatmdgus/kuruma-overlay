// 방송 화면: 메인 프로세스가 골라 준 창(디스코드 방송 팝업 등)을 비춰서 개수에 맞게 칸을 나눔
// 1개 → 꽉 차게, 2개 → 칸 모양에 맞춰 위아래·좌우, 3~4개 → 2×2 (16:9 기준으로 가장 크게 보이는 배치)
const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const tiles = new Map();   // source id → { el, video, stream }
let fps = 30;

async function open(src) {
  const el = document.createElement('div');
  el.className = 'tile pop';
  const video = document.createElement('video');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.addEventListener('loadedmetadata', () => fitAll());
  video.addEventListener('resize', () => fitAll());   // 팝업 창 크기를 바꾸면 비율도 따라감
  const label = document.createElement('span');
  label.className = 'tile-name';
  label.textContent = src.name || '';
  el.append(video, label);
  grid.append(el);
  const t = { el, video, stream: null };
  tiles.set(src.id, t);
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: src.id, maxFrameRate: fps } },
    });
    if (!tiles.has(src.id)) { stream.getTracks().forEach((tr) => tr.stop()); return; }
    t.stream = stream;
    video.srcObject = stream;
    // 창이 닫히면 영상도 끝남 → 칸 지우기 (다음 목록 때 다시 생기면 새로 연결)
    stream.getVideoTracks()[0]?.addEventListener('ended', () => close(src.id));
  } catch (e) {
    console.error('[mirror] 연결 실패', src.name, e.message);
    close(src.id);
  }
  layout();
}

function close(id) {
  const t = tiles.get(id);
  if (!t) return;
  tiles.delete(id);
  t.stream?.getTracks().forEach((tr) => tr.stop());
  t.el.remove();
  layout();
}

function layout() {
  const n = tiles.size;
  empty.hidden = n > 0;
  if (!n) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  // 칸 수(cols)를 바꿔 보며 16:9 화면이 가장 크게 들어가는 배치를 고름
  let best = { cols: 1, area: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = W / cols;
    const ch = H / rows;
    const w = Math.min(cw, ch * 16 / 9);
    const area = w * (w * 9 / 16);
    // 넓은 칸이면 비슷할 때 옆으로 나란히, 아니면 위아래
    if (area > best.area * 1.01 || (area > best.area * 0.99 && W > H * 1.5)) best = { cols, area };
  }
  grid.style.gridTemplateColumns = `repeat(${best.cols}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${Math.ceil(n / best.cols)}, 1fr)`;
  requestAnimationFrame(fitAll);
}

// 칸 안에서 영상 비율 그대로 최대한 크게 (빈 여백 없이 테두리가 영상에 딱 맞게)
function fitAll() {
  for (const { el, video } of tiles.values()) {
    const vw = video.videoWidth || 16;
    const vh = video.videoHeight || 9;
    const k = Math.min(el.clientWidth / vw, el.clientHeight / vh);
    video.style.width = `${Math.floor(vw * k)}px`;
    video.style.height = `${Math.floor(vh * k)}px`;
  }
}

window.overlay.on('mirror-sources', (list) => {
  const want = new Map((list || []).map((s) => [s.id, s]));
  for (const id of [...tiles.keys()]) if (!want.has(id)) close(id);
  for (const [id, src] of want) {
    if (tiles.has(id)) tiles.get(id).el.querySelector('.tile-name').textContent = src.name || '';
    else open(src);
  }
  layout();
});
window.overlay.on('settings', (s) => { if (s?.fps) fps = s.fps; });
window.addEventListener('resize', layout);
layout();
