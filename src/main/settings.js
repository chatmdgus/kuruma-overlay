const { BrowserWindow, ipcMain, screen, dialog } = require('electron');
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

function notifySettings(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

// deps: { config, resolveDisplay, getConnection, isMock, applyConfig(cfg), previewConfig(cfg), setEditMode(on) }
function setupSettings(deps) {
  ipcMain.handle('settings:get', () => {
    const cfg = deps.config.get();
    return {
      config: cfg,
      defaults: deps.config.DEFAULTS,
      displays: displaysInfo(),
      resolved: { main: String(deps.resolveDisplay('main').id), sub: String(deps.resolveDisplay('sub').id) },
      connection: deps.getConnection(),
      tunnel: deps.getTunnel(),
      mock: deps.isMock(),
      update: deps.getUpdate(),
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
  ipcMain.handle('settings:login', (_e, partial) => deps.login(partial));
  ipcMain.handle('settings:logout', () => deps.logout());
  ipcMain.handle('settings:update', (_e, action) => deps.update(action));

  ipcMain.handle('settings:pick-key', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'SSH 키 파일 선택',
      defaultPath: require('path').join(require('os').homedir(), '.ssh'),
      properties: ['openFile', 'showHiddenFiles'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
}

function openSettings(deps) {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); return win; }
  win = new BrowserWindow({
    width: 880,
    height: 820,
    minWidth: 680,
    minHeight: 600,
    title: 'Kuruma Overlay 설정',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#161114',
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
    if (deps.isQuitting()) return;   // 앱 종료 중이면 오버레이 창이 이미 없음
    deps.setEditMode(false);
    deps.applyConfig(deps.config.get()); // 저장 안 한 미리보기는 되돌림
  });
  return win;
}

module.exports = { setupSettings, openSettings, notifySettings };
