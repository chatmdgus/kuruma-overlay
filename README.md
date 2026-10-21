# kuruma-overlay

디스코드 클라이언트 없이 채팅과 음성 참여자를 화면 오버레이로 보는 Windows 앱.
데이터는 오라클에서 도는 차봇(`kuruma-bot`)의 중계 모듈에서 받아오고, 이 앱에는 봇 토큰이 들어가지 않음.

설계: [docs/DESIGN.md](docs/DESIGN.md)

## 실행

```bash
npm install
npm run mock   # 서버 없이 가짜 데이터로 화면 확인
npm start      # config.json의 serverUrl로 접속 (비어 있으면 mock으로 동작)
```

- 입력 모드: `Ctrl+Shift+D` → 입력 후 Enter 전송, Esc 취소
- 설정 파일: `%APPDATA%/kuruma-overlay/config.json` (모니터, 오버레이 위치, 사라지는 시간)

## 구조

```
src/
  main/
    index.js     창 생성, 모니터 배치, 단축키, 이벤트 라우팅
    overlay.js   투명·항상 위·클릭 통과 창
    config.js    설정 기본값과 저장
    relay.js     중계 서버 WebSocket 클라이언트
    mock.js      개발용 가짜 데이터
  preload.js
  renderer/      chat / media / voice 오버레이 화면
docs/DESIGN.md
```

## 진행 상황

- [x] 채팅 창: 수신 표시, 자동 사라짐, 입력 모드
- [x] 미디어 창: 대기열, 자동 사라짐
- [x] 음성 창: 참여자, 음소거 상태
- [x] 메인·서브 모니터 배치 (설정 파일 기준)
- [ ] 설정 창과 배치 편집기
- [ ] OAuth2 로그인
- [ ] 트레이 아이콘
- [ ] 설치 파일 배포, 자동 업데이트
