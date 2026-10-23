// 테마 (Ecliptica Overlay 테마를 참고). 오버레이 창과 설정 창이 같이 씀
// accent: 강조색, ink: 글자, soft: 흐린 글자, plate: 말풍선 바탕(RGB), light: 밝은 테마
const THEMES = {
  dark:    { label: '다크',   accent: '#E6E8EE', accentInk: '#15171C', plate: '14, 15, 19',   ink: '#F4F5F8', soft: '#B9BDC8' },
  kuruma:  { label: '쿠루마', accent: '#FF6B7A', accentInk: '#2A0A10', plate: '18, 11, 14',   ink: '#F6EEF0', soft: '#D2B8BE' },
  eclipse: { label: '일식',   accent: '#F4C45A', accentInk: '#1A1530', plate: '23, 19, 46',   ink: '#ECE8FF', soft: '#CFC8F5' },
  neon:    { label: '네온',   accent: '#3DF5FF', accentInk: '#0B0620', plate: '11, 6, 32',    ink: '#F2FBFF', soft: '#A9EEFF' },
  sakura:  { label: '사쿠라', accent: '#FF8FB8', accentInk: '#3A0E24', plate: '42, 19, 32',   ink: '#FFF5FA', soft: '#FFC9DD' },
  ocean:   { label: '오션',   accent: '#5EE6C8', accentInk: '#062026', plate: '11, 31, 42',   ink: '#EAFBFF', soft: '#B0E6F2' },
  poison:  { label: '포이즌', accent: '#7CFF4F', accentInk: '#0C1A08', plate: '10, 22, 10',   ink: '#EFFFE8', soft: '#B8E6A8' },
  autumn:  { label: '오텀',   accent: '#FF9A3C', accentInk: '#2A1404', plate: '34, 20, 10',   ink: '#FFF3E6', soft: '#F2C9A0' },
  mono:    { label: '모노',   accent: '#FFFFFF', accentInk: '#111111', plate: '0, 0, 0',      ink: '#FFFFFF', soft: '#D0D0D0' },
  snow:    { label: '스노우', accent: '#1E8FE0', accentInk: '#FFFFFF', plate: '245, 248, 252', ink: '#1B2A3A', soft: '#5C7690', light: true },
};
const THEME_ORDER = Object.keys(THEMES);

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(', ');

function applyTheme(key, root = document.documentElement) {
  const t = THEMES[key] || THEMES.dark;
  const set = (k, v) => root.style.setProperty(k, v);
  set('--accent', t.accent);
  set('--accent-rgb', hexRgb(t.accent));
  set('--accent-ink', t.accentInk);
  set('--plate', t.plate);
  set('--ink', t.ink);
  set('--ink-soft', t.soft);
  // 말풍선 테두리를 강조색으로 살짝 물들여서 테마 느낌이 나게 (다크·모노는 무채색 그대로)
  const neutral = key === 'dark' || key === 'mono' || !THEMES[key];
  set('--edge', neutral ? (t.light ? 'rgba(0, 0, 0, 0.1)' : 'rgba(255, 255, 255, 0.09)') : `rgba(${hexRgb(t.accent)}, ${t.light ? 0.35 : 0.3})`);
  set('--chip-bg', t.light ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.1)');
  set('--shadow', t.light ? 'none' : '0 1px 2px rgba(0, 0, 0, 0.85), 0 0 1px rgba(0, 0, 0, 0.9)');
  document.body?.classList.toggle('light', !!t.light);
}
