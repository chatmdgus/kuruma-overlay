// 디스코드 로그인: 브라우저에서 승인 → 127.0.0.1:53134/callback 으로 code 받기 → 중계 서버가 확인하고 세션 키 발급
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');

const LOGIN_TIMEOUT = 3 * 60e3;

// 짧게 접속해서 한 번 묻고 끊기
function ask(serverUrl, request, isAnswer, timeoutMs = 15e3) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket(serverUrl); } catch { reject(new Error('bad_url')); return; }
    const timer = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, timeoutMs);
    const extra = [];
    ws.onopen = () => ws.send(JSON.stringify(request));
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'error') { clearTimeout(timer); ws.close(); reject(new Error(msg.code || 'error')); return; }
      extra.push(msg);
      const done = isAnswer(msg, extra);
      if (done) { clearTimeout(timer); ws.close(); resolve(done); }
    };
    // Node 내장 WebSocket은 접속 자체가 실패하면 onclose 없이 onerror만 오므로 둘 다 처리
    ws.onerror = () => { clearTimeout(timer); reject(new Error('closed')); };
    ws.onclose = (ev) => { clearTimeout(timer); reject(new Error(ev.code === 4003 ? 'not_member' : 'closed')); };
  });
}

function page(title, body, ok) {
  const color = ok ? '#a7b4ff' : '#ff7a7a';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${title}</title>
<style>html,body{margin:0;height:100%;background:#0d0f1e;color:#eef0fa;font-family:'Segoe UI','Malgun Gothic',sans-serif}
body{display:grid;place-items:center}div{text-align:center;animation:in .5s cubic-bezier(.2,1.3,.4,1) both}
i{display:block;width:56px;height:56px;margin:0 auto 18px;border-radius:50%;box-shadow:0 0 0 3px ${color},0 0 30px ${color}}
h1{font-size:22px;margin:0 0 6px}p{color:#9aa0bf;margin:0}@keyframes in{from{opacity:0;transform:translateY(10px) scale(.96)}}</style>
</head><body><div><i></i><h1>${title}</h1><p>${body}</p></div></body></html>`;
}

// 반환: { token, user } — 실패하면 Error(code)
async function login(serverUrl) {
  const info = await ask(serverUrl, { type: 'oauth_info' }, (m) => (m.type === 'oauth_info' ? m : null), 10e3);
  if (!info.enabled) throw new Error('oauth_disabled');
  const redirect = new URL(info.redirectUri);
  const state = crypto.randomBytes(16).toString('hex');

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, info.redirectUri);
      if (url.pathname !== redirect.pathname) { res.writeHead(404).end(); return; }
      const finish = (status, title, body, err, value) => {
        // 브라우저가 연결을 재사용하면 다음 로그인 때 이 서버로 가버리므로 연결을 바로 끊음
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' }).end(page(title, body, !err));
        clearTimeout(timer);
        server.close();
        server.closeAllConnections?.();
        if (err) reject(new Error(err)); else resolve(value);
      };
      if (url.searchParams.get('state') !== state) return finish(400, '로그인 실패', '요청이 올바르지 않아요. 앱에서 다시 시도해 주세요.', 'bad_state');
      if (url.searchParams.get('error')) return finish(200, '로그인 취소됨', '앱에서 다시 시도할 수 있어요.', 'cancelled');
      const c = url.searchParams.get('code');
      if (!c) return finish(400, '로그인 실패', '앱에서 다시 시도해 주세요.', 'no_code');
      return finish(200, '로그인 완료', '이 창은 닫아도 돼요. Kuruma Overlay로 돌아가세요.', null, c);
    });
    const timer = setTimeout(() => { server.close(); server.closeAllConnections?.(); reject(new Error('timeout')); }, LOGIN_TIMEOUT);
    server.on('error', (e) => { clearTimeout(timer); reject(new Error(e.code === 'EADDRINUSE' ? 'port_busy' : 'server')); });
    server.listen(Number(redirect.port), redirect.hostname, () => {
      const auth = new URL('https://discord.com/oauth2/authorize');
      auth.search = new URLSearchParams({ client_id: info.clientId, response_type: 'code', redirect_uri: info.redirectUri, scope: info.scope || 'identify', state, prompt: 'none' }).toString();
      shell.openExternal(auth.toString());
    });
  });

  let token = null;
  const ready = await ask(serverUrl, { type: 'oauth', code, redirectUri: info.redirectUri }, (m) => {
    if (m.type === 'session') token = m.token;
    return m.type === 'ready' && token ? m : null;
  }, 20e3);
  return { token, user: ready.user };
}

const LOGIN_ERRORS = {
  oauth_disabled: '서버에 디스코드 로그인이 아직 설정되지 않았어요',
  not_member: '이 디스코드 서버의 멤버가 아니에요',
  oauth_failed: '디스코드 로그인 확인에 실패했어요',
  cancelled: '로그인을 취소했어요',
  timeout: '시간이 초과됐어요. 다시 시도해 주세요',
  port_busy: '로그인용 포트(53134)를 다른 프로그램이 쓰고 있어요',
  bad_url: '서버 주소가 올바르지 않아요',
  closed: '서버에 연결할 수 없어요',
};
const describeLoginError = (e) => LOGIN_ERRORS[e.message] || `로그인 실패 (${e.message})`;

module.exports = { login, describeLoginError };
