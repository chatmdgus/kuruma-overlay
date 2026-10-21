const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

// tray.png(16px)과 tray@2x.png(32px)를 화면 배율에 맞게 골라 씀
const iconPath = path.join(__dirname, '..', 'assets', 'tray.png');

function createTray({ onToggle, onSettings, onQuit }) {
  const tray = new Tray(nativeImage.createFromPath(iconPath));
  let visible = true;
  const build = () => Menu.buildFromTemplate([
    { label: visible ? '오버레이 숨기기' : '오버레이 표시', click: () => { visible = !visible; onToggle(visible); tray.setContextMenu(build()); } },
    { label: '설정', click: onSettings },
    { type: 'separator' },
    { label: '종료', click: onQuit },
  ]);
  tray.setToolTip('Kuruma Overlay');
  tray.setContextMenu(build());
  tray.on('double-click', onSettings);
  return tray;
}

module.exports = { createTray };
