// 중계 서버(차봇 overlay 모듈)와의 WebSocket 연결. 프로토콜은 docs/DESIGN.md 참고
function startRelay({ serverUrl, sessionToken, subscribe }, emit) {
  let ws = null;
  let retry = 0;
  let stopped = false;
  let nonce = 0;
  let pingTimer = null;

  const send = (obj) => ws && ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(obj));

  const connect = () => {
    ws = new WebSocket(serverUrl);
    ws.onopen = () => {
      retry = 0;
      emit('connection', { online: true });
      send({ type: 'auth', token: sessionToken });
      pingTimer = setInterval(() => send({ type: 'ping' }), 30000);
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'ready') send({ type: 'subscribe', ...subscribe });
      emit(msg.type, msg);
    };
    ws.onclose = () => {
      clearInterval(pingTimer);
      emit('connection', { online: false });
      if (!stopped) setTimeout(connect, Math.min(30000, 1000 * 2 ** retry++));
    };
    ws.onerror = () => {};
  };

  connect();

  return {
    send(content, channelId = subscribe.channelIds[0]) {
      send({ type: 'send', channelId, content, nonce: String(++nonce) });
    },
    stop() { stopped = true; ws && ws.close(); },
  };
}

module.exports = { startRelay };
