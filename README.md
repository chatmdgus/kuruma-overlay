# kuruma-overlay

디스코드 채팅과 사진을 서브 모니터에 투명한 오버레이로 띄우는 Windows 앱. 음성은 디스코드 기본 오버레이와 같이 쓰는 걸 전제로 함.
데이터는 오라클에서 도는 차봇(`kuruma-bot`)의 중계 모듈에서 받아오고, 이 앱에는 봇 토큰이 들어가지 않음.

설계: [docs/DESIGN.md](docs/DESIGN.md)

## 실행

```powershell
npm.cmd install
npm.cmd run mock   # 서버 없이 가짜 데이터로 화면 확인
npm.cmd start      # 실제 서버에 접속. 서버 주소·토큰·채널은 설정 창에서 입력
```

PowerShell 실행 정책 때문에 `npm` 대신 `npm.cmd`를 씀.

### 설치 파일로 쓰기

```powershell
npm.cmd run dist
```

`dist\Kuruma Overlay Setup <버전>.exe`를 실행하면 설치되고 바탕화면·시작 메뉴에 아이콘이 생김. 설정은 개발 실행과 같은 폴더를 써서 그대로 이어짐.
코드 서명이 없어서 처음 실행할 때 SmartScreen 경고가 뜨면 추가 정보 → 실행.

### 배포

`v`로 시작하는 태그(예: `v0.2.0`)를 올리면 GitHub Actions가 설치 파일을 빌드해서 공개 저장소 `kuruma-downloads`의 `overlay-latest` 릴리스에 올림. 다운로드 사이트는 그 파일을 가리킴.
필요한 것: 이 저장소 Secrets에 `DOWNLOADS_TOKEN` (kuruma-downloads에 Contents 읽기·쓰기 권한이 있는 토큰).

### 처음 설정

- 서버 주소, **디스코드로 로그인**, 메인·서브 모니터만 처음 한 번 입력
- 로그인: 브라우저에서 디스코드 승인 → `127.0.0.1:53134/callback` → 중계 서버가 확인하고 세션 키 발급 (Windows 계정으로 암호화해서 저장, 90일)
- 채널은 지정하지 않으면 볼 수 있는 오버레이 채널 전부. 토큰·채널 직접 지정은 처음 설정의 고급 칸
- 서버 주인은 SSH 터널을 켜면 앱이 켜질 때 터널을 같이 엶 (키 파일 지정)
- 평소 설정은 트레이 아이콘

- 채팅 입력창: 기본으로 켜져 있음. 입력창을 눌러서 치고 Enter 전송, Esc로 게임으로 돌아감. `Ctrl+Shift+Enter`로 입력창 켜기/끄기(켤 때 바로 입력 가능). 단축키·입력창 켜기/끄기는 설정 → 채팅에서도 바꿈
- 설정: 트레이 아이콘 → 연결, 모니터, 배치, 글자 크기, 배경 진하기 등
- 설정 파일: `%APPDATA%/kuruma-overlay/config.json`

## 구조

```
src/
  main/
    index.js     창 생성, 모니터 배치, 단축키, 이벤트 라우팅
    overlay.js   투명·항상 위·클릭 통과 창
    config.js    설정 기본값과 저장
    relay.js     중계 서버 WebSocket 클라이언트
    mock.js      개발용 가짜 데이터 (--mock 일 때만)
    settings.js  설정 창, 배치 미리보기
    tray.js      트레이 메뉴
    tunnel.js    SSH 터널 (서버 주인용)
    login.js     디스코드 로그인
  preload.js
  settings-preload.js
  renderer/      chat / media / voice 오버레이, settings 설정 창, common.js 공용(아바타·아이콘·연결 상태)
docs/DESIGN.md
```

## 진행 상황

- [x] 채팅 창: 수신 표시, 자동 사라짐, 입력 모드
- [x] 미디어 창: 대기열, 자동 사라짐
- [x] 채팅 기록: 평소엔 최근 줄만 잠깐, 입력 중엔 휠로 지난 기록(300줄)·최신으로 버튼, 링크 클릭, @멘션 자동완성
- [x] 방송 화면: 디스코드 방송 팝업(또는 고른 창)을 비춰서 최대 4개까지 칸을 나눠 보여줌
- [x] 내 GIF: 고른 이미지를 화면에 계속 띄움 (배치 화면에서 위치·크기, 투명도)
- [x] 음성 창: 참여자, 음소거 상태 → 디스코드 기본 오버레이를 쓰기로 해서 숨김 (코드는 남겨둠)
- [x] 메인·서브 모니터 배치 (설정 파일 기준)
- [x] 설정 창과 배치 편집기 (트레이 아이콘 → 설정, 첫 실행 때 자동으로 열림)
- [x] 트레이 아이콘: 오버레이 숨기기·설정·종료
- [x] 디스코드 로그인 (OAuth2 → 세션 키)
- [x] 설치 파일 (npm.cmd run dist), Windows 시작 시 자동 실행, 앱에서 SSH 터널
- [ ] 자동 업데이트, Cloudflare Tunnel로 친구들 접속
