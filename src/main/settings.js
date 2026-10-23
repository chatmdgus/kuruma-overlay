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
      channels: deps.getChannels(),
      hotkey: deps.getHotkey(),
    };
  });

  ipcMain.handle('settings:preview', (_e, partial) => {
    deps.previewConfig(partial);
    return true;
  });

  ipcMain.handle('settings:save', (_e, partial) => {
    const cfg = deps.config.save(partial);
    deps.applyConfig(cfg);
    cleanGifs(cfg.overlays.gif?.file);
    return cfg;
  });

  ipcMain.handle('settings:close', () => { win && win.close(); });
  ipcMain.handle('settings:login', (_e, partial) => deps.login(partial));
  ipcMain.handle('settings:logout', () => deps.logout());
  ipcMain.handle('settings:update', (_e, action) => deps.update(action));
  ipcMain.handle('settings:test-hotkey', (_e, accel) => deps.testHotkey(String(accel || '')));

  // 내 GIF 고르기: 원본을 옮기거나 지워도 계속 보이게 설정 폴더에 복사해 둠
  ipcMain.handle('settings:pick-gif', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '화면에 띄울 GIF 고르기',
      filters: [{ name: '이미지', extensions: ['gif', 'png', 'webp', 'apng', 'jpg', 'jpeg'] }],
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const fs = require('fs');
    const { app } = require('electron');
    const src = r.filePaths[0];
    const dir = path.join(app.getPath('userData'), 'gif');
    fs.mkdirSync(dir, { recursive: true });
    const name = path.basename(src);
    const dst = path.join(dir, `${Date.now()}${path.extname(src).toLowerCase()}`);
    fs.copyFileSync(src, dst);
    return { file: dst, name };
  });

  ipcMain.handle('settings:pick-key', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'SSH 키 파일 선택',
      defaultPath: require('path').join(require('os').homedir(), '.ssh'),
      properties: ['openFile', 'showHiddenFiles'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
}

// 저장된 GIF 하나만 남기고 예전에 골랐던 파일은 지움
function cleanGifs(keep) {
  const fs = require('fs');
  const { app } = require('electron');
  const dir = path.join(app.getPath('userData'), 'gif');
  try {
    for (const f of fs.readdirSync(dir)) if (path.join(dir, f) !== keep) fs.unlinkSync(path.join(dir, f));
  } catch {}
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
    backgroundColor: '#15171c',
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
