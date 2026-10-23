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
    const gdi32 = koffi.load('gdi32.dll');
    const dwmapi = koffi.load('dwmapi.dll');
    koffi.struct('DWM_THUMBNAIL_PROPERTIES', { dwFlags: 'uint32_t', rcDestination: RECT, rcSource: RECT, opacity: 'uint8_t', fVisible: 'int', fSourceClientAreaOnly: 'int' });
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
      // 창 번호(숫자)로 부르는 버전: desktopCapturer 의 "window:<번호>:0" 용
      PidOfN: user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hWnd, _Out_ uint32_t *lpdwProcessId)'),
      RectOfN: user32.func('bool __stdcall GetWindowRect(intptr_t hWnd, _Out_ RECT *lpRect)'),
      SetWindowPosN: user32.func('bool __stdcall SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int X, int Y, int cx, int cy, uint32_t uFlags)'),
      IsIconicN: user32.func('bool __stdcall IsIconic(intptr_t hWnd)'),
      ShowWindowN: user32.func('bool __stdcall ShowWindow(intptr_t hWnd, int nCmdShow)'),
      GetWindowLongPtrN: user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hWnd, int nIndex)'),
      SetWindowLongPtrN: user32.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t hWnd, int nIndex, intptr_t dwNewLong)'),
      SetLayeredWindowAttributesN: user32.func('bool __stdcall SetLayeredWindowAttributes(intptr_t hwnd, uint32_t crKey, uint8_t bAlpha, uint32_t dwFlags)'),
      SetWindowRgnN: user32.func('int __stdcall SetWindowRgn(intptr_t hWnd, void *hRgn, bool bRedraw)'),
      GetWindowRgnN: user32.func('int __stdcall GetWindowRgn(intptr_t hWnd, void *hRgn)'),
      GetRgnBox: gdi32.func('int __stdcall GetRgnBox(void *hrgn, _Out_ RECT *lprc)'),
      CreateRectRgn: gdi32.func('void * __stdcall CreateRectRgn(int x1, int y1, int x2, int y2)'),
      DeleteObject: gdi32.func('bool __stdcall DeleteObject(void *ho)'),
      DwmRegisterThumbnail: dwmapi.func('long __stdcall DwmRegisterThumbnail(intptr_t hwndDestination, intptr_t hwndSource, _Out_ void **phThumbnailId)'),
      DwmUpdateThumbnailProperties: dwmapi.func('long __stdcall DwmUpdateThumbnailProperties(void *hThumbnailId, const DWM_THUMBNAIL_PROPERTIES *ptnProperties)'),
      DwmUnregisterThumbnail: dwmapi.func('long __stdcall DwmUnregisterThumbnail(void *hThumbnailId)'),
      IsWindowN: user32.func('bool __stdcall IsWindow(intptr_t hWnd)'),
      PostMessageN: user32.func('bool __stdcall PostMessageW(intptr_t hWnd, uint32_t Msg, uintptr_t wParam, intptr_t lParam)'),
      ShowWindow: user32.func('bool __stdcall ShowWindow(void *hWnd, int nCmdShow)'),
      IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(void *hWnd)'),
      FindWindowExW: user32.func('void * __stdcall FindWindowExW(void *hWndParent, void *hWndChildAfter, str16 lpszClass, str16 lpszWindow)'),
    };
  } catch (e) {
    console.error('[foreground] 사용할 수 없음:', e.message);
  }
  return api;
}

function exeOfPid(a, pid) {
  if (!pid) return null;
  const h = a.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
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

// 창 번호로 실행 파일 이름과 크기 (방송 팝업 찾기용)
function windowInfo(hwndNumber) {
  const a = load();
  if (!a) return null;
  try {
    const pid = [0];
    a.PidOfN(hwndNumber, pid);
    const r = {};
    a.RectOfN(hwndNumber, r);
    return { exe: exeOfPid(a, pid[0]), width: (r.right || 0) - (r.left || 0), height: (r.bottom || 0) - (r.top || 0) };
  } catch { return null; }
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
// ignore(창 주소): 이 창이 맨 앞이면 상태를 안 바꿈 (방송 팝업을 눌렀을 때 등)
function watchForeground(onChange, intervalMs = 400, ignore = () => false) {
  const a = load();
  if (!a) return () => {};
  let last = false;
  const timer = setInterval(() => {
    let now = false;
    try {
      const h = a.GetForegroundWindow();
      if (h && ignore(koffiAddress(h))) return;
      now = DISCORD.test(foregroundExe() || '');
    } catch { now = false; }
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

// 이 창이 모니터 전체를 덮는지 (유튜브 전체화면, 전체화면 게임 등)
function isFullscreen(a, hwnd) {
  const r = {};
  if (!a.GetWindowRect(hwnd, r)) return false;
  const mon = a.MonitorFromWindow(hwnd, 2);   // MONITOR_DEFAULTTONEAREST
  const mi = { cbSize: 40, rcMonitor: {}, rcWork: {}, dwFlags: 0 };
  if (!mon || !a.GetMonitorInfoW(mon, mi)) return false;
  const m = mi.rcMonitor;
  return r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom;
}

// 맨 앞 창이 전체화면인지 (우리 창은 빼고)
function foregroundIsFullscreen(ownHandles = []) {
  const a = load();
  if (!a) return false;
  try {
    const hwnd = a.GetForegroundWindow();
    if (!hwnd) return false;
    if (ownHandles.includes(koffiAddress(hwnd))) return false;   // 우리 창이면 전체화면 아님
    return isFullscreen(a, hwnd);
  } catch { return false; }
}

// 전체화면(유튜브 등) 위에서 채팅을 칠 때: 포커스가 넘어오면 윈도우가 그 모니터의 작업 표시줄을 띄움
// → 입력하는 동안만 그 모니터의 작업 표시줄을 숨기고, 입력이 끝나면 되돌림
let hiddenBars = [];
function hideTaskbarOver(hwnd) {
  const a = load();
  if (!a || !hwnd || hiddenBars.length) return false;
  try {
    if (!a.IsWindow(hwnd) || !isFullscreen(a, hwnd)) return false;
    const mon = koffiAddress(a.MonitorFromWindow(hwnd, 2));
    for (const cls of ['Shell_TrayWnd', 'Shell_SecondaryTrayWnd']) {
      let h = null;
      for (let i = 0; i < 8; i++) {
        h = a.FindWindowExW(null, h, cls, null);
        if (!h) break;
        if (koffiAddress(a.MonitorFromWindow(h, 2)) === mon && a.IsWindowVisible(h)) {
          a.ShowWindow(h, 0);   // SW_HIDE
          hiddenBars.push(h);
        }
      }
    }
    return hiddenBars.length > 0;
  } catch { return false; }
}

function restoreTaskbars() {
  const a = load();
  const bars = hiddenBars;
  hiddenBars = [];
  if (!a) return;
  for (const h of bars) { try { if (a.IsWindow(h)) a.ShowWindow(h, 8); } catch {} }   // SW_SHOWNA
}

function koffiAddress(h) {
  try { return require('koffi').address(h); } catch { return h; }
}

// 다른 프로그램 창을 옮기고 크기 바꾸기 (화면 픽셀 기준). topmost 면 항상 위로
function placeWindow(hwndNumber, { x, y, width, height }, topmost = true) {
  const a = load();
  if (!a) return false;
  try {
    if (a.IsIconicN(hwndNumber)) a.ShowWindowN(hwndNumber, 4);   // 최소화돼 있으면 포커스 안 뺏고 되돌림 (SW_SHOWNOACTIVATE)
    const SWP_NOACTIVATE = 0x0010, SWP_SHOWWINDOW = 0x0040, SWP_NOOWNERZORDER = 0x0200;
    return a.SetWindowPosN(hwndNumber, topmost ? -1 : -2, Math.round(x), Math.round(y), Math.round(width), Math.round(height),
      SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOOWNERZORDER);
  } catch { return false; }
}

// 다른 프로그램 창 투명도 (1 = 원래대로). 우리가 투명하게 만든 창만 되돌림
const layered = new Set();
function setOpacity(hwndNumber, alpha) {
  const a = load();
  if (!a) return false;
  try {
    const GWL_EXSTYLE = -20, WS_EX_LAYERED = 0x80000;
    const ex = Number(a.GetWindowLongPtrN(hwndNumber, GWL_EXSTYLE));
    if (alpha >= 0.999) {
      if (layered.has(hwndNumber)) { a.SetWindowLongPtrN(hwndNumber, GWL_EXSTYLE, ex & ~WS_EX_LAYERED); layered.delete(hwndNumber); }
      return true;
    }
    if (!(ex & WS_EX_LAYERED)) { a.SetWindowLongPtrN(hwndNumber, GWL_EXSTYLE, ex | WS_EX_LAYERED); layered.add(hwndNumber); }
    return a.SetLayeredWindowAttributesN(hwndNumber, 0, Math.round(Math.max(0, alpha) * 255), 2);   // LWA_ALPHA
  } catch { return false; }
}

// 다른 프로그램 창의 위쪽 top 픽셀을 잘라서 안 보이게 (0 = 원래대로)
function clipTop(hwndNumber, top) {
  const a = load();
  if (!a) return false;
  try {
    if (!top) return a.SetWindowRgnN(hwndNumber, null, true) !== 0;
    const r = {};
    if (!a.RectOfN(hwndNumber, r)) return false;
    const rgn = a.CreateRectRgn(0, top, r.right - r.left, r.bottom - r.top);
    if (!rgn) return false;
    if (!a.SetWindowRgnN(hwndNumber, rgn, true)) { a.DeleteObject(rgn); return false; }   // 성공하면 창이 영역을 가져감
    return true;
  } catch { return false; }
}

// 창 위쪽이 지금 top 픽셀만큼 잘려 있는지 (디스코드가 창 크기를 다시 잡을 때 잘라낸 영역을 지워버림)
function clippedTop(hwndNumber) {
  const a = load();
  if (!a) return -1;
  let rgn = null;
  try {
    rgn = a.CreateRectRgn(0, 0, 0, 0);
    if (!rgn || !a.GetWindowRgnN(hwndNumber, rgn)) return 0;   // ERROR = 영역 없음
    const r = {};
    a.GetRgnBox(rgn, r);
    return r.top || 0;
  } catch { return -1; } finally { if (rgn) try { a.DeleteObject(rgn); } catch {} }
}

// DWM 썸네일: 다른 창의 일부(src)를 우리 창(dest)의 한 자리(dst)에 실시간으로 그려 줌 (윈도우 미리보기와 같은 방식)
// 디스코드처럼 GPU로 그리는 창은 바깥에서 잘라낼 수 없어서 이걸로 위 버튼 줄만 빼고 보여줌
function thumbOpen(destHwnd, srcHwnd) {
  const a = load();
  if (!a) return null;
  try {
    const out = [null];
    return a.DwmRegisterThumbnail(destHwnd, srcHwnd, out) === 0 ? out[0] : null;
  } catch { return null; }
}
function thumbSet(h, dst, src, opacity) {
  const a = load();
  if (!a || !h) return false;
  try {
    return a.DwmUpdateThumbnailProperties(h, {
      dwFlags: 0x1 | 0x2 | 0x4 | 0x8 | 0x10,   // 대상·원본 영역, 투명도, 보이기, 창 전체 기준
      rcDestination: dst, rcSource: src,
      opacity: Math.round(Math.max(0, Math.min(1, opacity)) * 255), fVisible: 1, fSourceClientAreaOnly: 0,
    }) === 0;
  } catch { return false; }
}
function thumbClose(h) {
  const a = load();
  if (!a || !h) return;
  try { a.DwmUnregisterThumbnail(h); } catch {}
}
const windowAlive = (hwndNumber) => { const a = load(); try { return !!a && a.IsWindowN(hwndNumber); } catch { return false; } };

// 창 위치 (화면 픽셀)
function windowRect(hwnd) {
  const a = load();
  if (!a || !hwnd) return null;
  try { const r = {}; return a.GetWindowRect(hwnd, r) ? { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top } : null; } catch { return null; }
}

// 이 창(포인터)이 전체화면인지
function windowIsFullscreen(hwnd) {
  const a = load();
  if (!a || !hwnd) return false;
  try { return a.IsWindow(hwnd) && isFullscreen(a, hwnd); } catch { return false; }
}

// 다른 프로그램 창을 포커스 안 뺏고 최소화
function minimizeWindow(hwndNumber) {
  const a = load();
  if (!a) return false;
  try { return a.IsIconicN(hwndNumber) ? false : a.ShowWindowN(hwndNumber, 7); } catch { return false; }   // SW_SHOWMINNOACTIVE
}

// 다른 프로그램 창 닫기 (X 버튼 누른 것과 같음)
function closeWindow(hwndNumber) {
  const a = load();
  if (!a) return false;
  try { return a.PostMessageN(hwndNumber, 0x0010, 0, 0); } catch { return false; }   // WM_CLOSE
}

module.exports = { windowRect, thumbOpen, thumbSet, thumbClose, windowAlive, windowIsFullscreen, clippedTop, setOpacity, clipTop, minimizeWindow, closeWindow, hideTaskbarOver, restoreTaskbars, placeWindow, watchForeground, foregroundExe, windowInfo, foregroundWindow, restoreForeground, foregroundIsFullscreen, available: () => !!load() };
