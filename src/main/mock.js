// 서버 없이 화면을 확인하기 위한 가짜 데이터 (npm run mock)
const people = [
  { id: '1', name: '유키', color: '#3498db' },
  { id: '2', name: '민준', color: null },
  { id: '3', name: 'ハル', color: '#e67e22' },
  { id: '4', name: '소라', color: '#9b59b6' },
];
const lines = ['보스 2페이즈 들어감', '오늘 몇 시에 모임?', 'ちょっと休憩するね', 'ㅋㅋㅋ 방금 뭐임', '了解！', '나 곧 들어감'];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function fakeImage(label, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="50%" font-size="36" text-anchor="middle" fill="#fff" font-family="sans-serif">${label}</text></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

function startMock(emit) {
  let n = 0;
  const msgTimer = setInterval(() => {
    const author = pick(people);
    const withImage = Math.random() < 0.2;
    emit('message', {
      id: String(++n),
      channelId: 'mock',
      author,
      content: withImage && Math.random() < 0.5 ? '' : pick(lines),
      media: withImage ? [{ kind: 'image', url: fakeImage(`스크린샷 #${n}`, author.color), width: 480, height: 300 }] : [],
      ts: Date.now(),
    });
  }, 2800);

  const voiceTimer = setInterval(() => {
    emit('voice', {
      channelId: 'mock-voice',
      members: [{ id: '0', name: 'チャ', selfMute: false, selfDeaf: false }, ...people].map((p) => ({
        id: p.id, name: p.name, avatar: null, color: p.color || null,
        selfMute: Math.random() < 0.2, selfDeaf: Math.random() < 0.1, serverMute: false, streaming: false,
      })),
    });
  }, 6000);

  emit('connection', { state: 'online', mock: true, user: { id: '0', name: 'チャ' } });

  return {
    send(content) {
      emit('message', { id: String(++n), channelId: 'mock', author: { id: '0', name: 'チャ', color: '#EF9F27' }, content, media: [], ts: Date.now() });
    },
    stop() { clearInterval(msgTimer); clearInterval(voiceTimer); },
  };
}

module.exports = { startMock };
