// 채팅 오버레이
// - 평소: 최근 maxLines 줄만 잠깐 보였다가 사라짐 (기록은 남겨 둠)
// - 입력 중: 지난 기록 전체를 휠로 스크롤해서 봄, "최신으로" 버튼, 링크 클릭, @멘션
const chat = document.getElementById('chat');
const list = document.getElementById('list');
const inputBox = document.getElementById('input');
const text = document.getElementById('text');
const latestBtn = document.getElementById('latest');

const HISTORY_MAX = 300;   // 남겨 둘 기록 줄 수
let settings = { fadeSec: 10, maxLines: 8, fontSize: 15, bgOpacity: 0.45 };
let typing = false;
let me = null;             // 내 디스코드 이름 (멘션 강조용)

function applySettings() {
  chat.style.setProperty('--fs', `${settings.fontSize}px`);
  document.documentElement.style.setProperty('--bg', settings.bgOpacity);
  glance();
}

// ---------- 평소 보기 / 기록 보기 ----------
const fresh = (row) => !settings.fadeSec || Date.now() - row._born < settings.fadeSec * 1000;

// 평소: 사라지지 않은 최근 maxLines 줄만 보임
function glance() {
  if (typing) return;
  const rows = [...list.children];
  rows.forEach((row, i) => {
    const show = i >= rows.length - settings.maxLines && fresh(row);
    row.classList.toggle('old', !show);
    row.classList.remove('gone');
    if (show) scheduleFade(row);
  });
  toBottom();
}

function scheduleFade(row) {
  clearTimeout(row._timer);
  if (!settings.fadeSec || typing) return;
  const left = settings.fadeSec * 1000 - (Date.now() - row._born);
  row._timer = setTimeout(() => {
    if (typing) return;
    row.classList.add('gone');
    row._timer = setTimeout(() => { if (!typing) row.classList.add('old'); }, 500);
  }, Math.max(0, left));
}

const nearBottom = () => list.scrollHeight - list.scrollTop - list.clientHeight < 40;
function toBottom(smooth) {
  list.scrollTo({ top: list.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  latestBtn.classList.remove('on', 'new');
}
list.addEventListener('scroll', () => { if (nearBottom()) latestBtn.classList.remove('on', 'new'); else if (typing) latestBtn.classList.add('on'); });
latestBtn.addEventListener('mousedown', (e) => e.preventDefault());
latestBtn.addEventListener('click', () => { toBottom(true); text.focus(); });

// ---------- 메시지 ----------
// 스티커: 말풍선 안에 그림으로. 디스코드 기본 스티커(Lottie)는 애니메이션으로 그림
function stickerBox(stickers) {
  const box = document.createElement('span');
  box.className = 'stickers';
  for (const st of stickers) {
    if (st.kind === 'lottie') {
      const el = document.createElement('span');
      el.className = 'sticker lottie';
      el.title = st.name || '';
      box.append(el);
      if (window.lottie) {
        window.overlay.fetchLottie(st.url).then((data) => {
          if (data) window.lottie.loadAnimation({ container: el, renderer: 'svg', loop: true, autoplay: true, animationData: data });
          else el.textContent = st.name || '스티커';
        });
      } else el.textContent = st.name || '스티커';
    } else {
      const img = document.createElement('img');
      img.className = 'sticker';
      img.src = st.url;
      img.alt = st.name || '';
      img.title = st.name || '';
      img.onerror = () => img.replaceWith(Object.assign(document.createElement('span'), { className: 'note', textContent: st.name || '스티커' }));
      box.append(img);
    }
  }
  return box;
}

// 글 안의 링크는 눌러서 브라우저로 열고, @내이름 은 강조
const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}])/g;
function richText(body) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of body.matchAll(URL_RE)) {
    frag.append(mentions(body.slice(last, m.index)));
    const a = document.createElement('a');
    a.className = 'link';
    a.textContent = m[0].length > 60 ? m[0].slice(0, 57) + '…' : m[0];
    a.title = m[0];
    a.addEventListener('click', (e) => { e.preventDefault(); window.overlay.openLink(m[0]); if (!typing) window.overlay.endInput(); });
    ui.clickable(a);
    frag.append(a);
    last = m.index + m[0].length;
  }
  frag.append(mentions(body.slice(last)));
  return frag;
}
function mentions(str) {
  const frag = document.createDocumentFragment();
  str.split(/(@[^\s@]+)/).forEach((part) => {
    if (!part) return;
    if (part.startsWith('@') && part.length > 1) {
      const s = document.createElement('span');
      s.className = 'mention' + (me && part.slice(1) === me ? ' me' : '');
      s.textContent = part;
      frag.append(s);
    } else frag.append(part);
  });
  return frag;
}

function addMessage({ id, author = {}, text: body, mediaOnly, channel, stickers = [] }) {
  const stick = typing && nearBottom();
  const row = document.createElement('div');
  row.className = 'msg plate fade';
  row.dataset.id = id;
  row._born = Date.now();

  const line = document.createElement('span');
  line.className = 'line';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = author.name ?? '?';
  if (author.color) name.style.color = author.color;   // 역할 색 (없으면 기본 흰색)
  const span = document.createElement('span');
  if (mediaOnly) { span.className = 'note'; span.textContent = body; } else span.append(richText(body || ''));
  if (channel) {
    const tag = document.createElement('span');
    tag.className = 'ch';
    tag.textContent = `#${channel}`;
    line.append(tag);
  }
  line.append(name, span);
  if (stickers.length) line.append(stickerBox(stickers));
  if (me && (body || '').includes(`@${me}`)) row.classList.add('ping');

  row.append(ui.avatar(author), line);
  list.appendChild(row);
  while (list.children.length > HISTORY_MAX) list.firstChild.remove();

  if (typing) {
    if (stick) toBottom(true);
    else latestBtn.classList.add('on', 'new');
  } else glance();
}

window.overlay.on('settings', (s) => { settings = { ...settings, ...s }; applySettings(); });
window.overlay.on('message', addMessage);
window.overlay.on('message-delete', (id) => list.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove());
window.overlay.on('reset', () => list.replaceChildren());
window.overlay.on('connection', (c) => { if (c?.user?.name) me = c.user.name; });

// ---------- 보낼 채널 ----------
// 입력창 왼쪽 버튼으로 고름. "자동"이면 마지막으로 글이 올라온 채널
const targetBtn = document.getElementById('target');
const pick = document.getElementById('pick');
let channels = [];
let target = { id: null, name: null, auto: true };

function paintTarget() {
  targetBtn.textContent = target.name ? `#${target.name}` : '#…';
  targetBtn.classList.toggle('auto', target.auto);
}
function openPick(on) {
  closeMention();
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

window.overlay.on('channels', (l) => { channels = l || []; if (!pick.hidden) openPick(true); });
window.overlay.on('target', (t) => { target = t || target; paintTarget(); });

// ---------- @멘션 ----------
// @ 뒤에 글자를 치면 서버 멤버를 찾아서 고름 → 보낼 때 진짜 멘션(<@ID>)으로 바꿈
const mentionBox = document.getElementById('mention');
const picked = new Map();   // "@표시이름" → 유저 ID
let mention = null;         // { start, query, list, index }
let mentionTimer = null;

function mentionQuery() {
  const pos = text.selectionStart;
  const m = /(^|\s)@([^\s@]{0,32})$/.exec(text.value.slice(0, pos));
  return m ? { start: pos - m[2].length - 1, query: m[2] } : null;
}
function closeMention() { mention = null; mentionBox.hidden = true; }
function paintMention() {
  if (!mention || !mention.list.length) { mentionBox.hidden = true; return; }
  mentionBox.hidden = false;
  mentionBox.replaceChildren(...mention.list.map((u, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'item' + (i === mention.index ? ' on' : '');
    b.append(ui.avatar(u), Object.assign(document.createElement('span'), { textContent: u.name }));
    b.onclick = () => insertMention(u);
    return b;
  }));
}
function insertMention(u) {
  const q = mentionQuery() || mention;
  if (!q) return;
  const tag = `@${u.name}`;
  text.value = text.value.slice(0, q.start) + tag + ' ' + text.value.slice(text.selectionStart);
  const caret = q.start + tag.length + 1;
  text.setSelectionRange(caret, caret);
  picked.set(tag, u.id);
  closeMention();
  text.focus();
}
text.addEventListener('input', () => {
  const q = mentionQuery();
  clearTimeout(mentionTimer);
  if (!q) { closeMention(); return; }
  mentionTimer = setTimeout(async () => {
    const found = await window.overlay.searchMembers(q.query);
    const now = mentionQuery();
    if (!now || now.query !== q.query) return;
    pick.hidden = true;   // 채널 목록은 닫고 멘션 목록만
    mention = { ...q, list: found || [], index: 0 };
    paintMention();
  }, 120);
});
mentionBox.addEventListener('mousedown', (e) => e.preventDefault());

// 보낼 때 고른 멘션만 <@ID> 로 (직접 친 @글자는 그대로)
function withMentions(value) {
  let out = value;
  for (const [tag, id] of picked) if (out.includes(tag)) out = out.split(tag).join(`<@${id}>`);
  return out;
}

// ---------- 입력 ----------
// 입력창 켜기/끄기 (단축키). focus 면 바로 칠 수 있게 커서를 넣음
window.overlay.on('input-mode', ({ on, focus }) => {
  inputBox.classList.toggle('on', on);
  if (!on) text.blur();
  else if (focus) text.focus();
});

// 커서가 들어오면 지난 기록을 전부 펼쳐서 스크롤 가능, 나가면 평소 보기로
function setTyping(on) {
  if (typing === on) return;
  typing = on;
  inputBox.classList.toggle('typing', on);
  chat.classList.toggle('typing', on);
  if (on) {
    for (const row of list.children) { clearTimeout(row._timer); row.classList.remove('gone', 'old'); }
    toBottom();
  } else {
    latestBtn.classList.remove('on', 'new');
    glance();
  }
}
text.addEventListener('focus', () => setTyping(true));
text.addEventListener('blur', () => {
  // 채널 목록·멘션 목록을 누르는 중이면 입력을 끝내지 않음
  setTimeout(() => {
    if (document.activeElement === text) return;
    setTyping(false);
    openPick(false);
    closeMention();
    window.overlay.endInput();
  }, 120);
});

text.addEventListener('keydown', (e) => {
  if (mention && !mentionBox.hidden) {   // 멘션 목록이 열려 있으면 위·아래로 고르고 Enter/Tab 으로 넣기
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      mention.index = (mention.index + (e.key === 'ArrowDown' ? 1 : -1) + mention.list.length) % mention.list.length;
      paintMention();
      return;
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !e.isComposing) { e.preventDefault(); insertMention(mention.list[mention.index]); return; }
    if (e.key === 'Escape') { e.preventDefault(); closeMention(); return; }
  }
  if (e.key === 'Enter' && !e.isComposing) {
    // 보내고 나면 게임으로 돌아감 (다시 치려면 입력창 클릭이나 단축키)
    e.preventDefault();
    if (text.value.trim()) window.overlay.send(withMentions(text.value));
    text.value = '';
    picked.clear();
    text.blur();
  } else if (e.key === 'Escape') {
    if (!pick.hidden) openPick(false); else text.blur();
  } else if (e.key === 'Tab' && !e.shiftKey && channels.length) {   // Tab: 다음 채널 (Shift+Tab 은 다른 프로그램용으로 남겨 둠)
    e.preventDefault();
    const i = channels.findIndex((c) => c.id === target.id);
    window.overlay.setTarget(channels[(i + 1) % channels.length].id);
  } else if (e.key === 'PageUp' || e.key === 'PageDown') {
    e.preventDefault();
    list.scrollBy({ top: (e.key === 'PageUp' ? -1 : 1) * list.clientHeight * 0.8, behavior: 'smooth' });
  }
});

// 클릭 통과 창이라 입력창 위에 마우스가 있을 때만 클릭을 받음 (입력 중에는 창 전체)
ui.clickable(inputBox);

ui.bindStatus(document.getElementById('status'));
applySettings();
