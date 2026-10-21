// 앱이 직접 SSH 포트 포워딩을 열어 둠 (ssh -N -L local:127.0.0.1:remote user@host)
// Windows 10 이상에 기본으로 들어 있는 OpenSSH(ssh.exe)를 사용
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

function expandPath(p) {
  if (!p) return '';
  return path.normalize(String(p)
    .replace(/^~(?=$|[\\/])/, os.homedir())
    .replace(/%USERPROFILE%/gi, os.homedir())
    .replace(/\$env:USERPROFILE/gi, os.homedir()));
}

// onState({ state: 'starting' | 'open' | 'failed' | 'stopped', detail })
function startTunnel(opts, onState) {
  const { host, user, keyPath, localPort, remotePort } = opts;
  let child = null;
  let stopped = false;
  let retry = 0;
  let timer = null;
  let lastErr = '';

  const run = () => {
    lastErr = '';
    onState({ state: 'starting' });
    const args = [
      '-N',
      '-i', expandPath(keyPath),
      '-L', `${localPort}:127.0.0.1:${remotePort}`,
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=3',
      '-o', 'BatchMode=yes',                    // 비밀번호를 묻지 않음 (키 파일만)
      '-o', 'StrictHostKeyChecking=accept-new',
      `${user}@${host}`,
    ];
    try {
      child = spawn('ssh', args, { windowsHide: true });
    } catch (e) {
      onState({ state: 'failed', detail: `ssh를 실행할 수 없음: ${e.message}` });
      return;
    }
    // 포워딩이 실패하면 ssh가 바로 종료되므로, 몇 초 버티면 열린 것으로 봄
    const openTimer = setTimeout(() => { if (child && child.exitCode === null) { retry = 0; onState({ state: 'open' }); } }, 3000);
    child.stderr.on('data', (d) => { lastErr = (lastErr + String(d)).slice(-2000); });
    child.on('error', (e) => { lastErr = e.code === 'ENOENT' ? 'ssh 프로그램이 없음 (Windows OpenSSH 클라이언트 필요)' : e.message; });
    child.on('exit', () => {
      clearTimeout(openTimer);
      child = null;
      if (stopped) { onState({ state: 'stopped' }); return; }
      onState({ state: 'failed', detail: describe(lastErr) });
      timer = setTimeout(run, Math.min(60000, 2000 * 2 ** retry++));
    });
  };

  run();

  return {
    stop() {
      stopped = true;
      clearTimeout(timer);
      if (child) child.kill();
    },
  };
}

function describe(err) {
  err = String(err || '').trim();
  if (!err) return '연결이 끊김';
  if (/Permission denied/i.test(err)) return '키 파일이 맞지 않음';
  if (/No such file|not accessible|Identity file/i.test(err)) return '키 파일을 찾을 수 없음';
  if (/Address already in use|cannot listen|forwarding failed/i.test(err)) return '포트가 이미 사용 중 (다른 SSH 터널 창을 닫아야 함)';
  if (/timed out|Could not resolve|Connection refused|Network is unreachable/i.test(err)) return '서버에 접속할 수 없음';
  return err.split(/\r?\n/).filter(Boolean).pop();
}

module.exports = { startTunnel, expandPath };
