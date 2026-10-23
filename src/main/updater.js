// 자동 업데이트: kuruma-downloads 릴리스 overlay-latest 의 latest.yml 을 보고 새 버전을 백그라운드로 받아둠
// 받은 뒤 "업데이트" 누르면 바로 설치하고 다시 켜짐 (종료할 때도 자동 설치)
const { app } = require('electron');

const CHECK_EVERY = 3 * 60 * 60e3;

function setupUpdater(onState) {
  let state = { state: app.isPackaged ? 'idle' : 'dev', current: app.getVersion() };
  const set = (patch) => { state = { ...state, ...patch }; onState(state); };
  const api = { get: () => state, check: () => {}, install: () => {} };
  if (!app.isPackaged) return api;   // 개발 실행(npm start)에서는 끔

  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    console.error('[update] electron-updater 없음:', e.message);
    return api;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => { if (state.state !== 'ready') set({ state: 'checking' }); });
  autoUpdater.on('update-not-available', () => set({ state: 'latest' }));
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => set({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (e) => { if (state.state !== 'ready') set({ state: 'error', detail: String(e?.message || e).split('\n')[0] }); });

  api.check = () => {
    if (state.state === 'downloading' || state.state === 'ready') return;
    autoUpdater.checkForUpdates().catch(() => {});
  };
  // 조용히 설치하고 끝나면 다시 실행
  api.install = () => { if (state.state === 'ready') autoUpdater.quitAndInstall(true, true); };

  setTimeout(api.check, 8000);
  setInterval(api.check, CHECK_EVERY).unref?.();
  return api;
}

module.exports = { setupUpdater };
