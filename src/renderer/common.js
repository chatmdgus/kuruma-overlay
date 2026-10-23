// 오버레이 화면 공용 도우미
window.ui = (() => {
  const PALETTE = ['#ff8a96', '#7be0a8', '#ffb86b', '#ff8fb1', '#8fd8ff', '#d4a6ff', '#f5e17a'];
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function colorFor(id, given) {
    if (given) return given;
    let h = 0;
    for (const ch of String(id || '?')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  function avatar(person) {
    const el = document.createElement('span');
    el.className = 'av';
    el.style.background = colorFor(person.id, person.color);
    const initial = () => { el.textContent = (person.name || '?').slice(0, 1); };
    if (person.avatar) {
      const img = document.createElement('img');
      img.src = person.avatar;
      img.alt = '';
      img.onerror = () => { img.remove(); initial(); };
      el.append(img);
    } else {
      initial();
    }
    return el;
  }

  // ── 아이콘 (24×24, 직접 그린 도형) ──
  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }

  function gearPath() {
    const teeth = 8, ro = 10.2, ri = 7.6, cx = 12, cy = 12;
    const pts = [];
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      const w = Math.PI / teeth;
      for (const [ang, r] of [[a - w * 0.55, ri], [a - w * 0.32, ro], [a + w * 0.32, ro], [a + w * 0.55, ri]]) {
        pts.push(`${(cx + r * Math.cos(ang)).toFixed(2)} ${(cy + r * Math.sin(ang)).toFixed(2)}`);
      }
    }
    // 바깥 톱니 + 가운데 구멍 (evenodd)
    return `M${pts.join('L')}Z M15 12a3 3 0 1 0-6 0a3 3 0 1 0 6 0Z`;
  }

  const SHAPES = {
    mic: (g) => {
      g.append(svgEl('rect', { x: 8.5, y: 2.5, width: 7, height: 12, rx: 3.5, fill: 'currentColor' }));
      g.append(svgEl('path', { d: 'M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' }));
    },
    headphones: (g) => {
      g.append(svgEl('path', { d: 'M4 15v-3a8 8 0 0 1 16 0v3', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.2, 'stroke-linecap': 'round' }));
      g.append(svgEl('rect', { x: 2.5, y: 13, width: 5, height: 8, rx: 2, fill: 'currentColor' }));
      g.append(svgEl('rect', { x: 16.5, y: 13, width: 5, height: 8, rx: 2, fill: 'currentColor' }));
    },
    speaker: (g) => {
      g.append(svgEl('path', { d: 'M3 9.5h3.5L11 5.5v13l-4.5-4H3z', fill: 'currentColor' }));
      g.append(svgEl('path', { d: 'M14.5 9a4 4 0 0 1 0 6M17 6.5a7.5 7.5 0 0 1 0 11', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' }));
    },
    camera: (g) => {
      g.append(svgEl('rect', { x: 2.5, y: 6, width: 13, height: 12, rx: 2.5, fill: 'currentColor' }));
      g.append(svgEl('path', { d: 'M16.5 10.2l5-3v9.6l-5-3z', fill: 'currentColor' }));
    },
    gear: (g) => {
      g.append(svgEl('path', { d: gearPath(), fill: 'currentColor', 'fill-rule': 'evenodd' }));
    },
  };

  // slash: 빨간 사선. 아이콘과 겹치는 부분은 바탕색 테두리로 끊어서 또렷하게
  function icon(name, { slash = false, label = '' } = {}) {
    const svg = svgEl('svg', { viewBox: '0 0 24 24', class: `ic ic-${name}${slash ? ' slashed' : ''}`, role: 'img', 'aria-label': label });
    const g = svgEl('g', {});
    SHAPES[name](g);
    svg.append(g);
    if (slash) {
      svg.append(svgEl('path', { d: 'M3.5 3.5l17 17', stroke: 'rgba(12,14,20,0.95)', 'stroke-width': 5, 'stroke-linecap': 'round' }));
      svg.append(svgEl('path', { d: 'M3.5 3.5l17 17', stroke: 'var(--danger)', 'stroke-width': 2.2, 'stroke-linecap': 'round' }));
    }
    return svg;
  }

  const STATUS_TEXT = {
    setup: '설정에서 서버를 연결하세요',
    connecting: '서버에 연결하는 중',
    offline: '연결이 끊김. 다시 연결하는 중',
    error: '토큰이 맞지 않음. 설정에서 확인하세요',
    expired: '로그인이 만료됨. 설정에서 다시 로그인하세요',
  };

  function bindStatus(el, onChange) {
    window.overlay.on('connection', (c) => {
      const state = c?.state || 'setup';
      el.dataset.state = state;
      el.classList.toggle('on', state !== 'online');
      el.lastChild.textContent = c?.reason === 'bad_url' ? '서버 주소가 올바르지 않음' : c?.reason === 'expired' ? STATUS_TEXT.expired : (STATUS_TEXT[state] || '');
      onChange && onChange(c);
    });
  }

  // 클릭 통과 창에서 특정 요소만 누를 수 있게: 마우스가 올라가 있는 동안만 클릭 받기
  function clickable(el) {
    el.addEventListener('mouseenter', () => window.overlay.setClickable(true));
    el.addEventListener('mouseleave', () => window.overlay.setClickable(false));
  }

  window.overlay.on('edit-mode', (on) => document.body.classList.toggle('editing', on));
  window.overlay.on('settings', (s) => { if (s && s.theme && typeof applyTheme === 'function') applyTheme(s.theme); });

  return { colorFor, avatar, icon, bindStatus, clickable };
})();
