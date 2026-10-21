const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

let win = null;

function displaysInfo() {
  const primary = screen.getPrimaryDisplay();
  return screen.getAllDisplays().map((d, i) => ({
    id: String(d.id),
    label: `모니터 ${i + 1} · ${d.size.width}×${d.size.height}${d.id === primary.id ? ' (주 모니터)' : ''}`,
    bounds: d.bounds,
    primary: d.id === primary.id,
  }));
}

// deps: { config, resolveDisplay, applyConfig(cfg), previewConfig(cfg), setEditMode(on) }
function setupSettings(deps) {
  ipcMain.handle('settings:get', () => {
    const cfg = deps.config.get();
    return {
      config: cfg,
      defaults: deps.config.DEFAULTS,
      displays: displaysInfo(),
      resolved: { main: String(deps.resolveDisplay('main').id), sub: String(deps.resolveDisplay('sub').id) },
    };
  });

  ipcMain.handle('settings:preview', (_e, partial) => {
    deps.previewConfig(partial);
    return true;
  });

  ipcMain.handle('settings:save', (_e, partial) => {
    const cfg = deps.config.save(partial);
    deps.applyConfig(cfg);
    return cfg;
  });

  ipcMain.handle('settings:close', () => { win && win.close(); });
}

function openSettings(deps) {
  if (win) { win.show(); win.focus(); return win; }
  win = new BrowserWindow({
    width: 820,
    height: 760,
    minWidth: 640,
    minHeight: 560,
    title: 'Kuruma Overlay 설정',
    autoHideMenuBar: true,
    backgroundColor: '#1e1f22',
    webPreferences: {
      preload: path.join(__dirname, '..', 'settings-preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'));
  deps.setEditMode(true);
  win.on('closed', () => {
    win = null;
    deps.setEditMode(false);
    deps.applyConfig(deps.config.get()); // 저장 안 한 미리보기는 되돌림
  });
  return win;
}

module.exports = { setupSettings, openSettings };
