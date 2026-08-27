# daintyz-skin-inbox Worker

스킨 빌더의 로그인과 `_inbox` 자동 업로드를 담당하는 Cloudflare Worker입니다.
계정과 로그인 세션은 기존 `daintyz-timerwidget` D1에 저장하며, GitHub 토큰과 평문 비밀번호는 브라우저나 저장소에 저장하지 않습니다.
기존 앱 데이터와 충돌하지 않도록 스킨 빌더 인증 테이블에는 `auth_` 접두사를 사용합니다.

## 인증 구조

- 아이디: 영문·숫자·점·밑줄·하이픈 3~64자
- 비밀번호: PBKDF2-SHA-256 100,000회 해시로 저장(Cloudflare Workers 지원 상한)
- 세션: 무작위 토큰을 발급하고 D1에는 SHA-256 해시만 저장
- 세션 유효시간: 기본 8시간, 최대 24시간
- 로그인 제한: 같은 아이디/IP 조합에서 15분 내 5회 실패하면 15분 차단
- 브라우저 저장: 현재 탭의 `sessionStorage`에 세션 토큰만 저장

## 1. Cloudflare 로그인

```powershell
cd worker
npx wrangler login
```

별도 DB는 만들지 않습니다. `wrangler.toml`은 timerWidget API Worker가 사용하는 기존 `daintyz-timerwidget` DB에 연결되어 있습니다.

## 2. 테이블 생성

```powershell
npx wrangler d1 migrations apply daintyz-timerwidget --remote
```

로컬 개발 DB에는 `--remote`를 빼고 실행합니다.

## 3. 최초 계정 생성 또는 비밀번호 변경

```powershell
node scripts/create-user.mjs admin
```

비밀번호를 두 번 입력하면 평문 비밀번호가 없는 SQL이 출력됩니다. 출력된 SQL을 Cloudflare D1 콘솔에서 실행하거나 다음 명령의 `<출력된 SQL>` 자리에 넣어 실행합니다.

```powershell
npx wrangler d1 execute daintyz-timerwidget --remote --command "<출력된 SQL>"
```

같은 아이디로 다시 실행하면 비밀번호가 변경되고 기존 로그인 세션은 모두 종료됩니다.

## 4. GitHub 토큰 및 Worker 배포

저장소 Contents 읽기·쓰기 권한이 있는 fine-grained PAT를 등록합니다.

```powershell
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
```

빌더 주소가 기본값 `https://shenika27.github.io`와 다르면 `wrangler.toml`의 `ALLOW_ORIGIN`도 실제 origin에 맞춥니다.

## API

- `POST /auth/login`: 아이디·비밀번호 확인 및 세션 발급
- `GET /auth/session`: Bearer 세션 확인
- `POST /auth/logout`: 현재 세션 삭제
- `POST /inbox`: 인증된 사용자의 `_inbox` 파일 커밋

`/inbox` 요청에는 `Authorization: Bearer <token>` 헤더가 필요합니다.

## 로컬 검증

```powershell
npm test
```
