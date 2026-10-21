const { Tray, Menu, nativeImage } = require('electron');

// 아이콘 파일 없이 16x16 원 아이콘을 직접 그림 (BGRA)
function makeIcon() {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const i = (y * size + x) * 4;
      if (d <= 7) {
        buf[i] = 0xf2; buf[i + 1] = 0x65; buf[i + 2] = 0x58; buf[i + 3] = 0xff; // #5865F2
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function createTray({ onToggle, onSettings, onQuit }) {
  const tray = new Tray(makeIcon());
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
