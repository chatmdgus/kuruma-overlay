const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// 서버 주소 칸을 비워두면 쓰는 공개 중계 주소 (오라클 서버의 Caddy → 127.0.0.1:8790)
const PUBLIC_SERVER = 'wss://193-123-163-59.sslip.io';

// 위치(rect)는 모니터 기준 비율(0~1)로 저장해서 해상도가 바뀌어도 유지됨
// 세로 모니터(높이 > 너비)에 놓일 때는 rectTall을 따로 씀 (가로용 비율을 그대로 쓰면 가늘고 길어짐)
const DEFAULTS = {
  serverUrl: '',
  sessionToken: '',          // 임시 방식(OVERLAY_TOKENS) 토큰. 디스코드 로그인을 쓰면 비워둠
  auth: { session: '', user: null },   // 디스코드 로그인으로 받은 세션 키 (Windows 암호화로 저장)
  subscribe: { guildId: '', channelIds: [], voiceChannelIds: [] },
  // 앱이 SSH 터널을 직접 열 때 (Cloudflare Tunnel 붙이기 전, 서버 주인용)
  ssh: { enabled: false, host: '', user: 'ubuntu', keyPath: '', localPort: 8790, remotePort: 8790 },
  launch: { atLogin: false },
  monitors: { main: null, sub: null },
  appearance: { bgOpacity: 0.45, hideOnDiscord: true, theme: 'dark' },   // hideOnDiscord: 디스코드 창이 맨 앞이면 숨김
  overlays: {
    chat: { enabled: true, monitor: 'sub', inputOn: true, rect: { x: 0.74, y: 0.34, w: 0.245, h: 0.62 }, rectTall: { x: 0.53, y: 0.52, w: 0.45, h: 0.45 }, fadeSec: 10, maxLines: 8, fontSize: 15 },
    media: { enabled: true, monitor: 'sub', rect: { x: 0.505, y: 0.34, w: 0.225, h: 0.62 }, rectTall: { x: 0.08, y: 0.52, w: 0.43, h: 0.45 }, fadeSec: 8, maxItems: 3 },
    // 음성은 디스코드 기본 오버레이와 같이 쓰는 걸 기본으로 해서 꺼둠 (설정에서 켤 수 있음)
    // 내 GIF: 고른 이미지를 화면에 계속 띄움 (파일은 설정 폴더 gif/ 에 복사해 둠)
    gif: { enabled: false, monitor: 'main', rect: { x: 0.84, y: 0.66, w: 0.14, h: 0.3 }, rectTall: { x: 0.6, y: 0.05, w: 0.36, h: 0.18 }, file: '', name: '', opacity: 1 },
    voice: { enabled: false, monitor: 'main', rect: { x: 0.008, y: 0.015, w: 0.15, h: 0.42 }, rectTall: { x: 0.01, y: 0.01, w: 0.27, h: 0.24 }, scale: 1.25, gap: 6, showControls: true },
  },
  hotkeys: { input: 'CommandOrControl+Shift+D' },
};

let cache = null;
const file = () => path.join(app.getPath('userData'), 'config.json');

function merge(base, extra) {
  if (extra === null) return null;   // null로 저장하면 값을 지움 (로그아웃 등)
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return extra ?? base;
  const out = { ...base };
  for (const k of Object.keys(extra || {})) out[k] = merge(base[k], extra[k]);
  return out;
}

function get() {
  if (cache) return cache;
  let saved = {};
  try {
    // 메모장으로 저장하면 BOM이 붙을 수 있어서 제거
    saved = JSON.parse(fs.readFileSync(file(), 'utf8').replace(/^﻿/, ''));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[config] config.json 읽기 실패, 기본값 사용:', e.message);
  }
  cache = merge(DEFAULTS, saved);
  return cache;
}

function save(next) {
  cache = merge(get(), next);
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  return cache;
}

module.exports = { get, save, merge, DEFAULTS, PUBLIC_SERVER, file };
