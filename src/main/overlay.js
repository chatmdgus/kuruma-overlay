const { BrowserWindow } = require('electron');
const path = require('path');

function makeOverlay(htmlFile) {
  const win = new BrowserWindow({
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    focusable: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(htmlFile);
  return win;
}

// rect = { x, y, w, h } 모니터 기준 비율
function placeOverlay(win, display, rect) {
  const b = display.bounds;
  win.setBounds({
    x: Math.round(b.x + rect.x * b.width),
    y: Math.round(b.y + rect.y * b.height),
    width: Math.max(80, Math.round(rect.w * b.width)),
    height: Math.max(60, Math.round(rect.h * b.height)),
  });
}

module.exports = { makeOverlay, placeOverlay };
