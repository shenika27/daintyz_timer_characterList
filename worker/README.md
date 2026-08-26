# daintyz-skin-inbox — _inbox 커밋 프록시 Worker

빌더(`docs/index.html`)의 **업로드·삭제 원클릭**을 위한 Cloudflare Worker.
빌더가 만든 파일을 이 Worker로 보내면, 서버에 보관된 GitHub 토큰으로 레포
`_inbox/`에 커밋한다 → 기존 `skin-deploy.yml` 워크플로우가 자동 처리.

## 준비물 (사장님이 넣을 값 2개)

1. **GITHUB_TOKEN** — 이 레포 `Contents: Read and write` 권한이 있는 fine-grained PAT
2. **ACCESS_KEY** — 디자이너가 빌더에 1회 입력할 접근 비번(아무 문자열)

## 배포 (wrangler / 이 PC에 Cloudflare 로그인 되어 있을 때)

```bash
cd worker
npx wrangler login          # 최초 1회(브라우저로 Cloudflare 로그인)
npx wrangler secret put GITHUB_TOKEN   # 프롬프트에 토큰 붙여넣기
npx wrangler secret put ACCESS_KEY     # 프롬프트에 정한 비번 입력
npx wrangler deploy
```

배포가 끝나면 마지막 줄에 주소가 출력된다:
`https://daintyz-skin-inbox.<계정서브도메인>.workers.dev`
→ 이 주소를 빌더의 `INBOX_API_URL` 에 넣으면 원클릭 완성.

## 배포 (Cloudflare 대시보드로 붙여넣기 — wrangler 없이)

1. Cloudflare 대시보드 → Workers & Pages → Create → Worker
2. 이름 `daintyz-skin-inbox` → Deploy
3. Edit code → `src/index.js` 내용을 통째로 붙여넣기 → Deploy
4. Settings → Variables:
   - Secrets(암호화): `GITHUB_TOKEN`, `ACCESS_KEY` 추가
   - Variables(평문): `OWNER`, `REPO`, `BRANCH`, `ALLOW_ORIGIN` — 필요 시(기본값은 코드에 내장)
5. 상단에 표시되는 `*.workers.dev` 주소를 빌더 `INBOX_API_URL` 에 반영

## API

`POST /` (JSON)

```json
{
  "key": "<ACCESS_KEY>",
  "path": "_inbox/<파일명>",
  "contentBase64": "<파일 내용 base64>",
  "message": "커밋 메시지(선택)"
}
```

- `path` 는 `_inbox/` 하위 파일 하나만 허용(경로 탈출 차단).
- 응답: `{ ok: true, commit, htmlUrl }` 또는 `{ ok: false, error }`.

## 참고 / 한계

- GitHub Contents API는 base64로 파일을 통째로 보낸다. 스킨 번들(스프라이트+미리보기)은
  보통 수 MB라 문제없지만, 아주 큰 파일(수십 MB)은 실패할 수 있다.
- `ALLOW_ORIGIN` 이 빌더 오리진과 다르면 브라우저가 CORS로 막는다.
