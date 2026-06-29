# _inbox — 스킨 업로드함

스킨빌더로 만든 **번들 zip(`{skinId}.zip`)을 이 폴더에 올리기만** 하면 됩니다.
나머지(압축 풀기 · `character/zip/`·`character/preview/` 배치 · `catalog.json` 갱신)는 GitHub Action이 자동으로 처리하고, 올린 zip은 처리 후 자동으로 사라집니다.

## 올리는 방법 (소스트리/git 몰라도 됨)

1. 스킨빌더에서 **`⬇ 번들 zip 만들기`** 로 `{skinId}.zip` 다운로드
2. 이 레포 GitHub 페이지 → **`_inbox` 폴더** 진입
3. 우측 상단 **`Add file ▸ Upload files`** 클릭
4. 받은 zip을 끌어다 놓고 → 아래 **`Commit changes`** 클릭
5. 끝. 1~2분 뒤 `Actions` 탭에서 ✅ 뜨면 상점에 반영됨

> ⚠ zip은 반드시 **스킨빌더가 만든 번들**이어야 합니다(안에 `character/zip/`·`character/preview/`·`catalog_entry.json` 포함).
> 캐릭터 zip만 단독으로 올리면 처리되지 않습니다.

## 삭제 업로드

스킨빌더 우측 `출시된 스킨` 목록에서 삭제 버튼을 누르면 `{skinId}.delete.json` 파일이 만들어집니다. 이 파일을 `_inbox`에 업로드하고 Commit 하면 GitHub Action이 자동으로 다음 정리를 수행합니다.

- `catalog.json`에서 해당 테마 항목 제거
- `character/zip/{skinId}.zip` 및 `character/preview/{skinId}/` 제거
- 유료 테마이면 R2의 비공개 zip 삭제 예약
- 유료 테마이면 Play Console 인앱상품 SKU를 삭제 대신 `inactive`로 비활성화

삭제 마커에 `productId`가 포함되어 있으면 catalog 항목이 이미 사라진 상태에서도 해당 SKU를 비활성화 대상으로 사용합니다.
