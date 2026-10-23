const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

// tray.png(16px)과 tray@2x.png(32px)를 화면 배율에 맞게 골라 씀
const iconPath = path.join(__dirname, '..', 'assets', 'tray.png');

function updateItem(u, onUpdate) {
  if (!u || u.state === 'dev') return null;
  if (u.state === 'ready') return { label: `업데이트 설치 (v${u.version})`, click: () => onUpdate('install') };
  if (u.state === 'downloading') return { label: `업데이트 받는 중… ${u.percent || 0}%`, enabled: false };
  if (u.state === 'checking') return { label: '업데이트 확인 중…', enabled: false };
  return { label: u.state === 'latest' ? `최신 버전 (v${u.current})` : '업데이트 확인', click: () => onUpdate('check') };
}

function createTray({ onToggle, onSettings, onQuit, onUpdate, getUpdate }) {
  const tray = new Tray(nativeImage.createFromPath(iconPath));
  let visible = true;
  const build = () => {
    const up = updateItem(getUpdate?.(), onUpdate);
    return Menu.buildFromTemplate([
      ...(up ? [up, { type: 'separator' }] : []),
      { label: visible ? '오버레이 숨기기' : '오버레이 표시', click: () => { visible = !visible; onToggle(visible); tray.setContextMenu(build()); } },
      { label: '설정', click: onSettings },
      { type: 'separator' },
      { label: '종료', click: onQuit },
    ]);
  };
  tray.setToolTip('Kuruma Overlay');
  tray.setContextMenu(build());
  tray.on('double-click', onSettings);
  return {
    tray,
    refresh() {
      tray.setContextMenu(build());
      const u = getUpdate?.();
      tray.setToolTip(u?.state === 'ready' ? `Kuruma Overlay · 새 버전 v${u.version} 준비됨` : 'Kuruma Overlay');
    },
  };
}

module.exports = { createTray };
