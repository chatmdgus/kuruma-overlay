// 중계 서버(차봇 overlay 모듈)와의 WebSocket 연결. 프로토콜은 docs/DESIGN.md 참고
function startRelay({ serverUrl, sessionToken, subscribe }, emit) {
  let ws = null;
  let retry = 0;
  let stopped = false;
  let nonce = 0;
  let pingTimer = null;

  const send = (obj) => ws && ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(obj));

  const connect = () => {
    emit('connection', { state: 'connecting' });
    try {
      ws = new WebSocket(serverUrl);
    } catch {
      emit('connection', { state: 'error', reason: 'bad_url' });
      return;
    }
    ws.onopen = () => {
      retry = 0;
      send({ type: 'auth', token: sessionToken });
      pingTimer = setInterval(() => send({ type: 'ping' }), 30000);
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'ready') {
        emit('connection', { state: 'online', user: msg.user });
        send({ type: 'subscribe', ...subscribe });
      }
      emit(msg.type, msg);
    };
    ws.onclose = (ev) => {
      clearInterval(pingTimer);
      if (stopped) return;
      if (ev.code === 4001) {   // 토큰이 틀리면 재시도해도 소용없음
        emit('connection', { state: 'error', reason: 'auth_failed' });
        return;
      }
      emit('connection', { state: 'offline' });
      setTimeout(() => { if (!stopped) connect(); }, Math.min(30000, 1000 * 2 ** retry++));
    };
    ws.onerror = () => {};
  };

  connect();

  return {
    send(content, channelId = subscribe.channelIds[0]) {
      send({ type: 'send', channelId, content, nonce: String(++nonce) });
    },
    stop() { stopped = true; clearInterval(pingTimer); ws && ws.close(); },
  };
}

module.exports = { startRelay };
