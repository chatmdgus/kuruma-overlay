// 맨 앞 창이 디스코드인지 확인 (Windows 전용). user32/kernel32를 koffi로 직접 부름
// 실패하면 아무것도 안 하고 넘어감 (오버레이는 평소처럼 보임)
const DISCORD = /^discord(ptb|canary|development)?\.exe$/i;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

let api = null;
function load() {
  if (api !== null) return api;
  api = false;
  if (process.platform !== 'win32') return api;
  try {
    const koffi = require('koffi');
    const RECT = koffi.struct('RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
    koffi.struct('MONITORINFO', { cbSize: 'uint32_t', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32_t' });
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    api = {
      GetForegroundWindow: user32.func('void * __stdcall GetForegroundWindow()'),
      GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(void *hWnd, _Out_ uint32_t *lpdwProcessId)'),
      OpenProcess: kernel32.func('void * __stdcall OpenProcess(uint32_t dwDesiredAccess, bool bInheritHandle, uint32_t dwProcessId)'),
      QueryFullProcessImageNameW: kernel32.func('bool __stdcall QueryFullProcessImageNameW(void *hProcess, uint32_t dwFlags, void *lpExeName, _Inout_ uint32_t *lpdwSize)'),
      CloseHandle: kernel32.func('bool __stdcall CloseHandle(void *hObject)'),
      SetForegroundWindow: user32.func('bool __stdcall SetForegroundWindow(void *hWnd)'),
      IsWindow: user32.func('bool __stdcall IsWindow(void *hWnd)'),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(void *hWnd, _Out_ RECT *lpRect)'),
      MonitorFromWindow: user32.func('void * __stdcall MonitorFromWindow(void *hWnd, uint32_t dwFlags)'),
      GetMonitorInfoW: user32.func('bool __stdcall GetMonitorInfoW(void *hMonitor, _Inout_ MONITORINFO *lpmi)'),
    };
  } catch (e) {
    console.error('[foreground] 사용할 수 없음:', e.message);
  }
  return api;
}

// 맨 앞 창의 실행 파일 이름 (예: Discord.exe). 모르면 null
function foregroundExe() {
  const a = load();
  if (!a) return null;
  const hwnd = a.GetForegroundWindow();
  if (!hwnd) return null;
  const pid = [0];
  a.GetWindowThreadProcessId(hwnd, pid);
  if (!pid[0]) return null;
  const h = a.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid[0]);
  if (!h) return null;
  try {
    const buf = Buffer.alloc(1040);
    const size = [520];
    if (!a.QueryFullProcessImageNameW(h, 0, buf, size)) return null;
    return buf.toString('utf16le', 0, size[0] * 2).split('\\').pop();
  } finally {
    a.CloseHandle(h);
  }
}

// 디스코드가 맨 앞에 오거나 벗어날 때만 onChange(true/false)
function watchForeground(onChange, intervalMs = 400) {
  if (!load()) return () => {};
  let last = false;
  const timer = setInterval(() => {
    let now = false;
    try { now = DISCORD.test(foregroundExe() || ''); } catch { now = false; }
    if (now !== last) { last = now; onChange(now); }
  }, intervalMs);
  return () => clearInterval(timer);
}

// 지금 맨 앞 창 (입력을 끝낼 때 이 창으로 포커스를 돌려줌)
function foregroundWindow() {
  const a = load();
  if (!a) return null;
  try { return a.GetForegroundWindow() || null; } catch { return null; }
}

function restoreForeground(hwnd) {
  const a = load();
  if (!a || !hwnd) return false;
  try { return a.IsWindow(hwnd) && a.SetForegroundWindow(hwnd); } catch { return false; }
}

// 맨 앞 창이 모니터 전체를 덮는지 (유튜브 전체화면, 전체화면 게임 등)
function foregroundIsFullscreen(ownHandles = []) {
  const a = load();
  if (!a) return false;
  try {
    const hwnd = a.GetForegroundWindow();
    if (!hwnd) return false;
    if (ownHandles.includes(koffiAddress(hwnd))) return false;   // 우리 창이면 전체화면 아님
    const r = {};
    if (!a.GetWindowRect(hwnd, r)) return false;
    const mon = a.MonitorFromWindow(hwnd, 2);   // MONITOR_DEFAULTTONEAREST
    const mi = { cbSize: 40, rcMonitor: {}, rcWork: {}, dwFlags: 0 };
    if (!mon || !a.GetMonitorInfoW(mon, mi)) return false;
    const m = mi.rcMonitor;
    return r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom;
  } catch { return false; }
}

function koffiAddress(h) {
  try { return require('koffi').address(h); } catch { return h; }
}

module.exports = { watchForeground, foregroundExe, foregroundWindow, restoreForeground, foregroundIsFullscreen, available: () => !!load() };
