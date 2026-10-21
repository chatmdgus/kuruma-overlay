const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// 위치(rect)는 모니터 기준 비율(0~1)로 저장해서 해상도가 바뀌어도 유지됨
const DEFAULTS = {
  serverUrl: '',
  sessionToken: '',
  subscribe: { guildId: '', channelIds: [], voiceChannelIds: [] },
  // 앱이 SSH 터널을 직접 열 때 (Cloudflare Tunnel 붙이기 전, 서버 주인용)
  ssh: { enabled: false, host: '', user: 'ubuntu', keyPath: '', localPort: 8790, remotePort: 8790 },
  launch: { atLogin: false },
  monitors: { main: null, sub: null },
  appearance: { bgOpacity: 0.45 },
  overlays: {
    chat: { enabled: true, monitor: 'sub', rect: { x: 0.74, y: 0.34, w: 0.245, h: 0.62 }, fadeSec: 10, maxLines: 8, fontSize: 15 },
    media: { enabled: true, monitor: 'sub', rect: { x: 0.505, y: 0.34, w: 0.225, h: 0.62 }, fadeSec: 8, maxItems: 3 },
    voice: { enabled: true, monitor: 'main', rect: { x: 0.008, y: 0.015, w: 0.15, h: 0.42 }, scale: 1.25, gap: 6, showControls: true },
  },
  hotkeys: { input: 'CommandOrControl+Shift+D' },
};

let cache = null;
const file = () => path.join(app.getPath('userData'), 'config.json');

function merge(base, extra) {
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

module.exports = { get, save, merge, DEFAULTS, file };
