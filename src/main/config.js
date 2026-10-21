const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// 위치(rect)는 모니터 기준 비율(0~1)로 저장해서 해상도가 바뀌어도 유지됨
const DEFAULTS = {
  serverUrl: '',
  sessionToken: '',
  subscribe: { guildId: '', channelIds: [], voiceChannelIds: [] },
  monitors: { main: null, sub: null },
  overlays: {
    chat: { enabled: true, monitor: 'sub', rect: { x: 0.78, y: 0.6, w: 0.2, h: 0.36 }, fadeSec: 10, maxLines: 5 },
    media: { enabled: true, monitor: 'sub', rect: { x: 0.56, y: 0.6, w: 0.2, h: 0.36 }, fadeSec: 8 },
    voice: { enabled: true, monitor: 'main', rect: { x: 0.01, y: 0.02, w: 0.13, h: 0.3 } },
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
  try { saved = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { /* 첫 실행 */ }
  cache = merge(DEFAULTS, saved);
  return cache;
}

function save(next) {
  cache = merge(get(), next);
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  return cache;
}

module.exports = { get, save, merge, DEFAULTS };
