const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// 서버 주소 칸을 비워두면 쓰는 공개 중계 주소 (오라클 서버의 Caddy → 127.0.0.1:8790)
const PUBLIC_SERVER = 'wss://193-123-163-59.sslip.io';

// 위치(rect)는 모니터 기준 비율(0~1)로 저장해서 해상도가 바뀌어도 유지됨
const DEFAULTS = {
  serverUrl: '',
  sessionToken: '',          // 임시 방식(OVERLAY_TOKENS) 토큰. 디스코드 로그인을 쓰면 비워둠
  auth: { session: '', user: null },   // 디스코드 로그인으로 받은 세션 키 (Windows 암호화로 저장)
  subscribe: { guildId: '', channelIds: [], voiceChannelIds: [] },
  // 앱이 SSH 터널을 직접 열 때 (Cloudflare Tunnel 붙이기 전, 서버 주인용)
  ssh: { enabled: false, host: '', user: 'ubuntu', keyPath: '', localPort: 8790, remotePort: 8790 },
  launch: { atLogin: false },
  monitors: { main: null, sub: null },
  appearance: { bgOpacity: 0.45, hideOnDiscord: true },   // hideOnDiscord: 디스코드 창이 맨 앞이면 숨김
  overlays: {
    chat: { enabled: true, monitor: 'sub', rect: { x: 0.74, y: 0.34, w: 0.245, h: 0.62 }, fadeSec: 10, maxLines: 8, fontSize: 15 },
    media: { enabled: true, monitor: 'sub', rect: { x: 0.505, y: 0.34, w: 0.225, h: 0.62 }, fadeSec: 8, maxItems: 3 },
    // 음성은 디스코드 기본 오버레이와 같이 쓰는 걸 기본으로 해서 꺼둠 (설정에서 켤 수 있음)
    voice: { enabled: false, monitor: 'main', rect: { x: 0.008, y: 0.015, w: 0.15, h: 0.42 }, scale: 1.25, gap: 6, showControls: true },
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
