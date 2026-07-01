# daintyz_timer_characterList

> ℹ️ 이 README는 **CDN 배포 레포(daintyz_timer_characterList)** 의 발행 규칙 문서입니다.
> 이 파일이 들어있는 폴더가 앱 **기본 설치 시드**(루트에 평평한 `{skinId}.zip` + 빈 `catalog.json`)라면, 구조가 아래 설명과 다를 수 있습니다 — 아래 구조는 **CDN 레포 기준**입니다.

캐릭터 타이머 위젯 앱의 **스킨 배포 리포지토리**입니다.
앱 업데이트 없이 신규 캐릭터를 추가할 수 있습니다.

> 스킨(테마) 1개 = **캐릭터 + 런닝머신 배경 + 타이머 테마가 묶인 한 세트**
> (예: "감자" → 감자 캐릭터 + 흙밭 배경 / "우주" → 우주인 + 우주 배경)
>
> **구매는 테마(세트) 단위**입니다. 단, 사용자는 앱에서 **캐릭터와 타이머를 따로 골라 섞어 적용**할 수 있습니다.
> (예: 감자 캐릭터 + 우주 타이머). 그래서 테마마다 `character/preview/{id}/` 폴더에 **테마 썸네일 1장(`thumb.png`)·미리보기 N장(`prev01,02,…`)**을 함께 준비합니다.

---

## 리포 구조

```
docs/index.html                 ← 🎨 스킨빌더 (브라우저로 열어 번들 zip 생성)
_inbox/                         ← 빌더 번들 zip 업로드함 (Action이 처리 후 비움)
.github/workflows/skin-deploy.yml ← _inbox 번들 자동 배치 워크플로
scripts/apply-skin-bundle.mjs   ← 번들 풀기 + catalog 병합 스크립트
catalog.json                    ← 앱이 읽는 테마 목록 (+ baseUrl)
character/                      ← 테마 에셋 묶음
  zip/{skinId}.zip              ← 테마 한 세트 (skin.json + 캐릭터·타이머 PNG들)
  preview/{skinId}/thumb.png    ← 테마 썸네일 (상점 목록 + 앱 '타이머' 탭 공용)
  preview/{skinId}/prev01.png   ← 미리보기 1장
  preview/{skinId}/prev02.png … ← 미리보기 추가 (prev01,02,03… 가변 개수)
```

- 테마별 표시 에셋(썸네일·미리보기)은 **`character/preview/{skinId}/` 한 폴더에 모읍니다.** 썸네일 파일명은 `thumb.png` 고정, 미리보기는 `prevNN.png`를 등록한 개수만큼.
- zip 안 파일명/구조는 그대로(루트에 `skin.json` + PNG들). zip을 **`character/zip/` 폴더 아래**에 둡니다.
- 썸네일·미리보기는 **zip 밖 독립 PNG** — 다운로드(구매) 전 상점 목록·상점 미리보기에서 바로 보여줘야 하므로 zip에 넣지 않습니다.

**신규 테마 출시(권장) = 스킨빌더로 번들 zip 만들어 `_inbox/`에 업로드만** 하면 됩니다 — `character/zip/`·`character/preview/` 배치와 `catalog.json` 갱신은 GitHub Action이 자동 처리(아래 **PART 3** 참고). 위 폴더들을 손으로 채우는 수동 방식도 그대로 가능합니다.
반영 후 10~15분이면 jsDelivr CDN을 통해 앱 목록에 나타납니다.

> ⚠️ `catalog.json`은 항상 최신이 필요해 앱이 **raw.githubusercontent**에서 받고, 무거운 에셋(zip/썸네일/미리보기)은
> catalog의 `baseUrl`(jsDelivr CDN)에서 받습니다. jsDelivr는 `@main`을 ~12시간 캐싱하니 급하면 [purge.jsdelivr.net]으로 무효화하세요.

---
---

# 🎨 PART 1. 그림 제작 (디자이너용)

> **이 파트만 보고 PNG를 그리면 됩니다.** JSON(PART 2)은 몰라도 됩니다 —
> 그림을 넘겨주면 개발자가 채웁니다.

## 1. 무엇을 그리나 — 캐릭터의 4가지 상태

타이머 상태에 따라 캐릭터가 바뀝니다. 각 상태는 **여러 장의 PNG가 순서대로 반복 재생**되는 애니메이션입니다.

| 상태 | 캐릭터가 하는 행동 | 프레임 수 | 파일명 |
|---|---|---|---|
| **정지(stop)** | 타이머 멈춤 — 가만히 서 있기 | 보통 1장 | `stop_01.png` |
| **달리기(running)** | 타이머 작동 중 — 런닝머신 위에서 달리기 | 3~6장 | `running_01.png` ~ `running_NN.png` |
| **일시정지(pause)** | 잠깐 멈춤 — 숨 고르기 (선택, 생략 가능) | 1~2장 | `pause_01.png` |
| **완료(complete)** | 시간 끝! — 승리 포즈 | 2~4장 | `complete_01.png` ~ `complete_NN.png` |

- `pause`는 **선택 사항** — 안 그리면 정지(stop) 그림을 대신 씁니다.
- 프레임이 많을수록 애니메이션이 부드럽습니다 (달리기는 4장 권장).
- 💡 **스킨빌더를 쓰면 파일명은 신경 쓸 필요 없습니다** — 상태별로 올린 순서대로 `stop_01`, `running_01`… 로 자동 명명됩니다. 아래 파일명은 수동 작성 시의 규칙입니다.

## 2. 캔버스 규칙 (★ 가장 중요)

### 모든 프레임은 **같은 크기 캔버스**에 그린다
프레임마다 캔버스 크기가 다르면 캐릭터가 커졌다 작아졌다 합니다.

### 배경은 **투명(PNG/RGBA)**
캐릭터+런닝머신만 그리고 나머지는 투명하게. (배경을 불투명하게 채우면 위젯이 어색해집니다.)

### 캐릭터 **발(바닥)을 모든 프레임에서 같은 높이에 맞춘다** (★★★)
캐릭터 영역은 캔버스 전체를 위젯에 맞춰 스케일합니다. 그래서 프레임마다 발 위치가 다르면
캐릭터가 **위아래로 들썩여** 보입니다.

```
✅ 올바름 (발이 항상 바닥선에 정렬)        ❌ 틀림 (프레임마다 발 높이가 다름)
┌──────┐ ┌──────┐ ┌──────┐              ┌──────┐ ┌──────┐ ┌──────┐
│  🏃  │ │  🏃 │ │  🏃 │              │ 🏃   │ │      │ │  🏃  │
│      │ │      │ │      │              │      │ │  🏃  │ │      │
│──발──│ │──발──│ │──발──│               │──발──│ │──발──│  │ 발   │
└──────┘ └──────┘ └──────┘              └──────┘ └──────┘ └──────┘
```

- **정지(stop) 프레임의 발도 달리기 최저점과 같은 바닥선**에 두세요. (안 그러면 정지일 때만 캐릭터가 떠 보임)
- 권장: 그림 바닥을 캔버스 맨 아래에서 4px 이내로 정렬 → "러닝머신 위에 서 있는" 느낌.

### 비율 / 해상도
- 캐릭터 영역은 정사각형에 가깝습니다(위젯 2×2 칸). 세로가 약간 긴 비율도 OK.
- **권장 PNG 크기: 약 300×360px** (정사각~세로가 약간 긴 비율). 모든 프레임 **동일 크기 필수**.
- 작게는 100×130px 정도(저해상)도 동작하지만, 또렷하게 하려면 200~400px를 권장합니다.
  단 과도하게 크면(예: 1000px↑) 위젯 로딩이 무거워지니 400px 안팎을 권장합니다.

## 3. 애니메이션 속도 감각

프레임 1장을 몇 ms(밀리초) 보여줄지로 속도가 정해집니다. (PART 2의 `frameDurationMs`)

| 느낌 | 값 | 체감 |
|---|---|---|
| 빠른 달리기 | 100~150ms | 8~10fps, 빠릿빠릿 |
| **일반 달리기** | **200~250ms** | 4~5fps, 자연스러움 (기본값) |
| 느린 동작 | 400~600ms | 2fps, 천천히 |
| 완료 포즈 | 400~800ms | 느긋하게 반복 |

> 위젯은 1초 단위로 갱신되므로 **100ms 미만은 의미 없습니다.** 200~250ms를 기준으로 잡으세요.

### 예시로 보는 `frameDurationMs`

**예시 1) 4장짜리 일반 달리기** — `250ms × 4장 = 1초`에 한 바퀴
```json
"running": {
  "default": {
    "frames": ["running_01.png", "running_02.png", "running_03.png", "running_04.png"],
    "frameDurationMs": 250
  }
}
```

**예시 2) 6장 왕복 달리기** — 1→4까지 갔다가 3,2로 되돌아와 더 부드럽게
```json
"running": {
  "default": {
    "frames": ["running_01.png", "running_02.png", "running_03.png", "running_04.png", "running_03.png", "running_02.png"],
    "frameDurationMs": 250
  }
}
```

**예시 3) 정지(1장)** — 프레임이 1장이면 값은 무시됨 (아무 값이나 OK)
```json
"stop": { "frames": ["stop_01.png"], "frameDurationMs": 1000 }
```

**예시 4) 완료 포즈** — 느긋하게 반복하려고 `500ms`로 길게
```json
"complete": { "frames": ["complete_01.png", "complete_02.png"], "frameDurationMs": 500 }
```

> **재생 시간 계산:** `frameDurationMs × 프레임 수` = 한 사이클 길이.
> 예) 200ms × 4장 = 0.8초 / 250ms × 6장 = 1.5초. 이 사이클이 계속 반복됩니다.

## 4. 타이머 영역 테마 (테마마다 포함)

캐릭터 아래(또는 위)의 **숫자+버튼 박스**도 테마의 일부입니다. **가로 배치**로 바뀌었습니다:
**왼쪽에 큰 시간(~80%), 오른쪽에 버튼 2개가 위아래로(~20%).**

핵심: **박스 + 구분선을 모두 배경 PNG 한 장(`timer_bg`)에 그려 넣습니다.**
버튼이 항상 2개라 어느 상태에서도 선 위치가 같기 때문에, 예전처럼 선을 따로 그릴 필요가 없어졌습니다.

### 영역 구조 (가로)

```
┌───────────────────────────┬─────┐  ← ① 타이머 배경(timer_bg): 박스 + 선까지 한 장에 그림
│                           │  +  │  ← ② 버튼(위)
│         10:00             ├─────┤  ← 버튼 사이 가로선 (배경에 그림)
│   (숫자 — 색/크기만 지정)  │  −  │  ← ② 버튼(아래)
└───────────────────────────┴─────┘
       ~80% (시간)         ~20% (버튼)
                ↑ 시간↔버튼 세로선 (배경에 그림)
```

### 권장 PNG 크기 (한눈에)

| 요소 | JSON 필드 | 스케일 방식 | 권장 PNG 크기 | 핵심 |
|---|---|---|---|---|
| 타이머 배경 | `background` | `fitXY` (가로·세로 늘어남) | **~440×220px** (가로 약 2:1) | 박스+선 포함, 단순·대칭 |
| 버튼 아이콘 ×5 | `buttons.*` | `fitCenter` | **96×96px 정사각** | 투명, 그림은 캔버스 안쪽 ~70% |
| 숫자 | `font` | 그림 아님 | — | 색/크기/패밀리만 지정 |

> 배경은 `fitXY`로 **늘어나므로 정확한 px보다 비율과 단순함**이 중요합니다(위 값은 또렷함 기준치).
> 더 선명하게 하려면 1.5~2배까지 키워도 됩니다. 버튼만 `fitCenter`라 비율이 유지됩니다.

### ① 타이머 배경 (`background`) — ★ 박스와 선을 모두 여기에

타이머 영역 전체에 깔리는 PNG. **박스 테두리 + 시간↔버튼 세로선 + 버튼 사이 가로선을 모두 이 한 장에 그립니다.**

- **세로선은 가로 폭의 ~80% 지점**(시간 영역과 버튼 영역 경계)에 그립니다.
- **가로선은 오른쪽 버튼 영역의 세로 중앙**(위/아래 버튼을 나누는 선)에 그립니다.
- 폭·높이가 위젯 크기에 따라 **늘어납니다(fitXY)**. 코너 장식·복잡한 무늬는 왜곡되니 **단순·대칭** 구성 권장.
- 왼쪽 시간 영역은 비워 두세요(숫자는 코드가 그 위에 얹습니다). 어두운 배경이면 숫자색을 밝게 지정하도록 개발자에게 전달.

### ② 버튼 아이콘 (5종)

버튼은 배경 위에 얹히는 **5개 심볼**을 각각 PNG로:

| 심볼 | 파일 예 | 언제 보이나 |
|---|---|---|
| 빼기 | `btn_minus.png` | 정지·완료 |
| 더하기 | `btn_plus.png` | 정지·완료 |
| 재생(계속) | `btn_play.png` | 일시정지 |
| 일시정지 | `btn_pause.png` | 진행 중 |
| 정지(초기화) | `btn_stop.png` | 진행·일시정지 |

- **반드시 투명 배경(RGBA).** 배경 위에 겹쳐지므로 불투명하면 박스 디자인을 가립니다.
- 버튼 한 칸은 대략 **정사각형**으로 들어갑니다(안쪽 5dp 여백 후 `fitCenter`).
- **권장 PNG 크기: 96×96px 정사각**(투명). 더 또렷하게 하려면 128×128px까지 OK.
  - 아이콘 그림은 캔버스 **안쪽 ~70%**에 두고 가장자리에 여백을 주세요.
  - 5개 모두 **같은 캔버스 크기**로 맞추면 버튼이 균일하게 보입니다.
- 5개 중 **일부만 그려도 됩니다** — 안 그린 건 내장 기호로 자동 대체.

**상태별 버튼 구성** (오른쪽 컬럼에 항상 2개, 위/아래):

| 상태 | 위 | 아래 | 시간 표시 |
|---|---|---|---|
| 정지 | + | − | 설정시간 |
| 진행 | II (일시정지) | □ (초기화) | 남은시간 |
| 일시정지 | ▶ (계속) | □ (초기화) | 남은시간 |
| 완료 | + | − | `00:00` |

> **시간 영역을 탭하면** 시작/일시정지/재개가 됩니다. 완료 상태는 정지와 화면이 같고(00:00 + `+`/`−`),
> 시간(00:00)을 탭하면 직전 설정 시간으로 돌아갑니다. 별도 "완료" 글자/PNG는 없습니다.

> 어떤 그림을 그릴지는 디자인 자유고, **JSON에 어떤 파일을 연결할지는 개발자가 PART 2를 보고 설정**합니다.
> 디자이너는 PNG와 "이건 배경/이건 재생버튼" 정도만 알려주면 됩니다.

## 5. 썸네일 & 미리보기 (앱 목록·상점용) ★ 테마마다 필수

앱 목록과 상점에 쓸 그림을 **테마 폴더 `character/preview/{skinId}/` 하나에** 모아 넣습니다. 썸네일 1장(고정) + 미리보기 N장. (zip 밖 독립 PNG)

| 파일 | 쓰이는 곳 | 무엇을 담나 | 권장 |
|---|---|---|---|
| `character/preview/{skinId}/thumb.png` | 상점 목록 + 앱 '타이머' 탭 썸네일 | 테마 대표 모습 (캐릭터+타이머 한 컷 권장) | 정사각 |
| `character/preview/{skinId}/prev01.png` | 상점 미리보기(스와이프) 1번째 | 위젯 전체 모습 한 장 | 위젯 비율 |
| `character/preview/{skinId}/prev02.png` | 상점 미리보기(스와이프) 2번째 | 위젯 전체 모습 한 장 | 위젯 비율 |
| `character/preview/{skinId}/prev03.png` … | 상점 미리보기(스와이프) N번째 (선택) | 추가로 보여줄 컷 | 위젯 비율 |

- **썸네일 파일명은 `thumb.png` 고정**, 미리보기는 `prev01.png`부터 **빈 번호 없이 연속**으로(prev01, prev02, prev03 …). 등록한 개수만큼 상점 미리보기 화면이 **가로 스와이프 갤러리**로 보여줍니다(앱이 prev01부터 순서대로 찾다가 없는 번호에서 멈춤).
- 미리보기는 캐릭터+타이머가 합쳐진 **위젯 전체 모습**을 보여주면 좋습니다(사용자가 "이 테마 사면 이렇게 보이는구나"를 보는 화면). 정지/진행중 등 상황별 컷을 원하는 만큼 넣으면 됩니다.
- ℹ️ **prevNN은 "구매 전" 상점 미리보기 전용입니다.** 구매(다운로드) 후 앱의 **적용 미리보기 화면은 앱이 zip 에셋으로 직접 라이브 렌더**하므로(상태 탭으로 정지/진행/일시정지/완료 표시), 적용 미리보기를 위해 상태별 컷을 따로 그릴 필요는 없습니다.
- 앱 '캐릭터' 탭은 zip 안의 로컬 캐릭터 프레임을 직접 쓰므로 별도 원격 썸네일이 필요 없습니다.
- 썸네일/미리보기가 없으면 앱은 기본 플레이스홀더로 대체하지만, **상점 매력도가 크게 떨어지니 테마마다 썸네일 1 + 미리보기 최소 1장 이상 준비**를 권장합니다.

## 6. 파일명 규칙

- 소문자 + 언더스코어 + 2자리 번호: `running_01.png`, `complete_02.png`
- 번호는 재생 순서. 빠지는 번호 없이 `_01`부터 연속으로.
- 타이머 테마 파일은 역할이 드러나게: `timer_bg.png`(배경), `btn_play.png` 등.

## 7. 디자이너 체크리스트

**캐릭터**
- [ ] 모든 프레임 캔버스 크기 동일 (**권장 약 300×360px**)
- [ ] 배경 투명 (RGBA)
- [ ] 모든 프레임 발 높이(바닥선) 일치 — 정지 프레임 포함
- [ ] 4가지 상태 그림 준비 (pause는 선택)

**타이머 테마**
- [ ] 타이머 배경(`timer_bg`): 박스 + 시간↔버튼 세로선(~80% 지점) + 버튼 사이 가로선을 **한 장에** 포함
- [ ] 배경 단순·대칭 (가로·세로로 늘어나도 OK)
- [ ] 버튼 아이콘 5종 투명 배경(RGBA), **96×96px 정사각** 권장 (5개 동일 크기)
- [ ] (테마 폰트 쓰면) `.ttf` 파일 1개 — 개발자가 `font.file`로 연결
- [ ] 어두운 배경이면 숫자 글자색을 밝게 지정하도록 개발자에게 전달

**썸네일 & 미리보기 (`character/preview/{skinId}/` 폴더에 모음)**
- [ ] `character/preview/{skinId}/thumb.png` (테마 썸네일 — 상점/타이머 탭 공용, 파일명 고정)
- [ ] `character/preview/{skinId}/prev01.png` (미리보기 1번째)
- [ ] `character/preview/{skinId}/prev02.png` … (미리보기 추가, 필요한 만큼 prev03, prev04 …)

**공통**
- [ ] 파일명 규칙 준수

---
---

# ⚙️ PART 2. skin.json 작성 (개발/themer용)

> PNG가 준비되면 이 JSON으로 묶어 zip을 만듭니다. 디자이너가 그림만 넘겼다면 이 부분은 개발자가 작성합니다.

## skin.json 예시

```json
{
  "skinId": "newchar",
  "name": "캐릭터 이름",
  "isFree": true,
  "timer": {
    "background": "timer_bg.png",
    "buttonStyle": "skin",
    "buttons": {
      "minus": "btn_minus.png",
      "plus":  "btn_plus.png",
      "play":  "btn_play.png",
      "pause": "btn_pause.png",
      "stop":  "btn_stop.png"
    },
    "font": {
      "file": "font.ttf",
      "color": "#1A1A1A"
    }
  },
  "character": {
    "stop":     { "frames": ["stop_01.png"], "frameDurationMs": 1000 },
    "running":  { "default": { "frames": ["running_01.png", "running_02.png", "running_03.png", "running_04.png", "running_03.png", "running_02.png"], "frameDurationMs": 250 } },
    "pause":    { "frames": ["pause_01.png"], "frameDurationMs": 1000 },
    "complete": { "frames": ["complete_01.png", "complete_02.png"], "frameDurationMs": 500 }
  }
}
```

> `pause` 는 선택 사항입니다 (생략 → `stop` 프레임으로 대체).
> `timer` 도 생략 가능하지만(→ 내장 박스 + 기호 버튼), **출시 테마는 `background`(timer_bg)를 무조건 포함**합니다.
>
> 투명한 **노스킨**으로 만들려면 생략하지 말고 명시하세요:
> `"timer": { "showBox": false, "buttonStyle": "none" }`

> **위 `running` 예시는 왕복형입니다.** 그림은 `running_01`~`running_04` 4장뿐이고,
> `04` 다음 `03`, `02`를 다시 넣어 1→2→3→4→3→2 순으로 매끄럽게 반복시킵니다.
> 끊겨도 괜찮으면 `["running_01", "running_02", "running_03", "running_04"]`처럼 단순하게 써도 됩니다.

## 최상위 필드

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `skinId` | string | ✅ | 스킨 고유 ID. 영소문자+언더스코어 (예: `space_cat`). catalog.json과 일치 |
| `name` | string | ✅ | 앱에 표시될 이름 |
| `isFree` | boolean | ✅ | `true` 무료 / `false` 유료(잠금 표시) |
| `timer` | object | ❌ | 타이머 영역 스킨. 생략 시 기본 스킨(내장 박스/기호 버튼). 출시 테마는 `background` 포함 |
| `character` | object | ✅ | 캐릭터 상태별 프레임 |

## character 블록

| 키 | 필수 | 설명 |
|---|---|---|
| `stop` | ✅ | 정지 상태 프레임셋 |
| `running.default` | ✅ | 달리기 프레임셋 (※ `running` 안에 `default`로 한 단계 감쌈) |
| `pause` | ❌ | 일시정지 프레임셋. 생략 시 `stop`으로 대체 |
| `complete` | ✅ | 완료 프레임셋 |

**프레임셋 공통 필드**

| 필드 | 타입 | 설명 |
|---|---|---|
| `frames` | string[] | PNG 파일명 배열. 순서대로 재생, 끝나면 반복 |
| `frameDurationMs` | number | 프레임 1장 표시 시간(ms). 예: `250` = 초당 4프레임 |

## timer 블록 (선택)

타이머 숫자/버튼 영역의 시각 요소. **블록 자체를 생략하면 기본 스킨**(내장 박스/기호 버튼)이 적용됩니다.
**출시 테마는 `background`(timer_bg)를 무조건 포함**합니다 — 박스·구분선이 이 배경 한 장에 들어갑니다.
투명한 노스킨은 아래처럼 명시합니다 (`showBox:false`, `buttonStyle:"none"`).

> 예전의 구분선 필드(`showDividerH`/`dividerHImage`/`dividerHHeightDp`/`showDividers`/`dividersColor`/
> `dividersImage`/`dividersWidthDp`)는 **모두 폐지**됐습니다. 선은 이제 배경 PNG에 그립니다.
> (기존 skin.json에 남아 있어도 무시되니 그냥 둬도 됩니다.)

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `background` | string | `null` | 타이머 배경 PNG. **박스 + 시간↔버튼 세로선 + 버튼 사이 가로선을 모두 포함.** 지정 시 내장 박스는 끔 |
| `showBox` | boolean | `true` | `background`가 없을 때만 쓰는 내장 박스 폴백. `background`가 있으면 무시 |
| `buttonStyle` | string | `default` | `default`(내장 기호) / `none`(투명) / `skin`(아래 PNG 사용) |
| `buttons` | object | `null` | `buttonStyle:skin`일 때 `minus`/`plus`/`play`/`pause`/`stop` PNG. 누락 심볼은 내장 기호로 대체 |
| `font` | object | `null` | 숫자 글꼴. `file`(커스텀 .ttf, 권장) / `family`(내장명, file 없을 때) / `color` / `sizeSp`. 생략 시 monospace·30sp·`#1A1A1A` |

### 타이머 영역 구조 (참고 — 가로)

```
┌───────────────────────────┬─────┐  ← background(timer_bg): 박스 + 선까지 한 장
│                           │  +  │  ← 위 버튼
│         10:00             ├─────┤  ← 버튼 사이 가로선(배경에 그림)
│      (숫자 = font)        │  −  │  ← 아래 버튼
└───────────────────────────┴─────┘
   ~80% (시간, 탭=시작/정지)  ~20%
              ↑ 시간↔버튼 세로선(배경에 그림)
```

**상태별 버튼** (오른쪽 컬럼에 항상 2개, 위/아래):

| 상태 | 위 | 아래 | 시간 | 시간 탭 |
|---|---|---|---|---|
| 정지 | + | − | 설정시간 | 시작 |
| 진행 | II | □ | 남은시간 | 일시정지 |
| 일시정지 | ▶ | □ | 남은시간 | 재개 |
| 완료 | + | − | `00:00` | 직전 설정시간으로 초기화 |

> 완료 상태는 정지와 화면이 같습니다(00:00 + `+`/`−`). 별도 "완료" 텍스트/PNG 없음.

> 배경의 세로선은 **폭 ~80% 지점**(시간/버튼 경계)에, 가로선은 **버튼 컬럼 세로 중앙**에 그립니다.

### 제약 사항

- **커스텀 글꼴(.ttf) 지원** — `font.file`에 zip 안 `.ttf` 파일명을 적으면 그 폰트로 숫자를 그립니다(테마별 폰트).
  `file`이 없으면 `font.family`(내장 패밀리명: `monospace`/`sans-serif`/`serif`)를 씁니다. `file` 사용 시 `sizeSp`는 영역에 맞춰져 무시.
- 버튼/배경 PNG는 **투명/단순 구성**. 버튼은 배경 위에 겹쳐 그려지므로 불투명하면 디자인을 가림.
- 배경 PNG는 `fitXY`로 늘어남 → 코너 장식보다 **단순·대칭** 구성 권장.

> 위젯은 **2x2** 한 칸이고, 그 안에서 타이머 ~30% / 캐릭터 ~70%로 나뉩니다.
> 더 복잡한 조합이 필요하면 개발자와 상의하세요.

---
---

# 📦 PART 3. 배포 절차

## ⭐ 권장: 스킨빌더 + `_inbox` 자동 배치 (디자이너용)

git/소스트리 몰라도 됩니다. **번들 zip 하나만 GitHub 웹에서 업로드**하면 끝.

1. **스킨빌더**(이 레포 `docs/index.html`)를 브라우저로 열기
2. 캐릭터 상태별 이미지 + 타이머 배경/버튼/폰트 + **썸네일·미리보기** + 기본정보(이름·가격·부제·출시일) 입력
   - 영어 이름/설명(`localized.en`)을 넣으면 앱 언어가 English일 때 해당 문구가 우선 표시됩니다.
   - `상점에 노출 안 함(숨김)`은 catalog에는 남기되 상점 노출만 숨길 때 씁니다.
   - `판매 종료일`은 한정판매 종료 표시와 판매 가능 기간 판정에 씁니다.
3. **`⬇ 번들 zip 만들기`** → `{skinId}.zip` 다운로드
4. 이 레포 GitHub 페이지 → **`_inbox` 폴더** → **`Add file ▸ Upload files`** → zip 끌어다 놓고 **Commit**
5. 1~2분 뒤 `Actions` 탭에 ✅ 뜨면 반영 완료

> 업로드하면 GitHub Action(`.github/workflows/skin-deploy.yml`)이 자동으로:
> 번들을 풀어 `character/zip/{id}.zip`·`character/preview/{id}/` 배치 + `catalog.json`에 항목 upsert(기존이면 version +1)
> + (유료면) zip을 비공개 R2로 업로드 + **Play 인앱상품(SKU) 자동 등록** + 올린 inbox zip 삭제 후 커밋.
> 즉 아래 "수동 절차"를 사람이 안 해도 됩니다. catalog 항목·파일명·폴더 규칙이 빌더에서 자동으로 맞춰집니다.

### 출시된 스킨 수정/삭제

스킨빌더 오른쪽의 **출시된 스킨** 목록은 `catalog.json`과 기존 zip/preview를 불러와 수정용 폼으로 복원합니다.

- 기존 테마를 고른 뒤 수정해서 다시 zip을 만들고 `_inbox`에 올리면 같은 `skinId` 항목이 갱신되고 `version`이 올라갑니다.
- 목록의 삭제 버튼은 `{skinId}.delete.json` 삭제 마커를 만듭니다. 이 파일을 `_inbox`에 올리면
  `character/zip/{skinId}.zip`, `character/preview/{skinId}/`, `catalog.json` 항목이 정리됩니다.
- 삭제 마커에 `productId`가 있으면 catalog 항목이 이미 사라진 상태에서도 해당 Play SKU를 `inactive`로 비활성화할 수 있습니다.

### 유료 스킨 → Play 인앱상품 자동 등록

유료(price>0) 스킨을 올리면 워크플로우가 Play Console에 인앱상품 `skin_{skinid}`를 자동으로 만듭니다
(`scripts/sync-play-products.mjs`, `androidpublisher` API).

- **신규 상품은 `비활성(inactive)`으로 생성**됩니다 — 가격 오타가 곧바로 실판매로 이어지지 않게.
  Play Console에서 상품을 확인하고 **`활성`만 누르면** 판매가 시작됩니다.
- **이미 있는 상품은 기존 상태를 보존**합니다(활성 상품을 비활성으로 되돌리지 않음). 가격·이름만 갱신.
- 빌더에서 스킨을 삭제하면 해당 SKU는 **하드 삭제 대신 비활성화**됩니다(구매 이력 보존).
- 무료 전용 업로드면 이 단계는 통째로 건너뜁니다(토큰 없이도 무료 파이프라인 정상 동작).

**최초 1회 셋업(로그인 필요):**
1. 결제 Worker에 쓰는 그 GCP 서비스계정 JSON을, **이 레포** GitHub → Settings ▸ Secrets and variables ▸ Actions →
   `GOOGLE_SERVICE_ACCOUNT_JSON` 시크릿으로 추가(JSON 전체 붙여넣기).
2. Play Console ▸ 사용자 및 권한 ▸ 그 서비스계정 → **인앱상품 관리(생성·수정) 권한 부여**.
   (구매 검증용 read 권한만 있던 계정이라면 추가가 필요합니다.)
   - 정확한 토글이 불확실하면 일단 올려 보세요. 권한이 부족하면 Actions 로그에 Google이 돌려준
     `403` 메시지가 그대로 찍히고 **catalog 커밋은 차단**되므로(깨진 상태 방지), 그 메시지를 보고 권한을 맞추면 됩니다.

> 패키지명·초기 상태는 워크플로우 env(`ANDROID_PACKAGE_NAME`, `PLAY_PRODUCT_STATUS`)에서 바꿉니다.
> 신규 상품을 처음부터 활성으로 만들고 싶으면 `PLAY_PRODUCT_STATUS: active`로 바꾸세요(권장하지 않음).

### 기프트코드 마커

스킨빌더의 운영 패널에서 해금 코드를 만들면 zip이 아니라 **마커 JSON**을 다운로드합니다.
이 파일도 `_inbox`에 올리고 Commit 하면 Action이 catalog에 병합한 뒤 마커 파일을 지웁니다.

- **평생이용권 코드**: `lifetime-pass-{expiresAt}.lifetime-pass-codes.json`
  - catalog 최상위 `lifetimePassGiftCodes`에 `{hash, expiresAt, maxUses?}` 형태로 병합됩니다.
  - `maxUses`는 생략/0이면 제한 없음, `1`이면 1회 소진 코드입니다. 그 외 값은 무시됩니다.
- **개별 테마 코드**: `{skinId}.skin-gift-codes.json`
  - 해당 테마의 `giftCodeHashes` 배열에 코드 해시를 병합합니다.
  - catalog에 없는 `skinId`면 적용하지 않고 건너뜁니다.

---

## 수동 절차 (빌더 없이 직접 할 때 / 동작 이해용)

### 1. zip으로 묶기 → `character/zip/`에 배치
zip 안은 그대로(루트에 `skin.json` + PNG들), 파일을 `character/zip/{skinId}.zip` 위치에 둡니다.
```
character/zip/newchar.zip
├── skin.json
├── stop_01.png
├── running_01.png ~ running_04.png
├── complete_01.png ~ complete_02.png
├── timer_bg.png                 (타이머 배경 — 박스+선 포함)
├── btn_minus/plus/play/pause/stop.png  (버튼 5종, 투명)
└── font.ttf                  (테마 숫자 폰트, 선택 — font.file로 연결)
```

### 2. 썸네일·미리보기 배치 (PART 1-5 참고)
```
character/preview/newchar/thumb.png    (테마 썸네일, 파일명 고정)
character/preview/newchar/prev01.png   (미리보기 1)
character/preview/newchar/prev02.png   (미리보기 2, 필요시 prev03 …)
```

### 3. catalog.json에 항목 추가
경로는 폴더 규칙대로 **자동 유추**되므로 `skinId`만 맞으면 URL을 일일이 안 적어도 됩니다. `baseUrl`만 jsDelivr로 지정하세요.
```json
{
  "baseUrl": "https://cdn.jsdelivr.net/gh/shenika27/daintyz_timer_characterList@main",
  "lifetimePassGiftCodes": [],
  "skins": [
    {
      "skinId": "newchar",
      "name": "캐릭터 이름",
      "price": 0,
      "prestige": false,
      "description": "한 줄 부제",
      "createdAt": "2026-06-26",
      "version": 1,
      "localized": {
        "en": { "name": "Character name", "description": "Short subtitle" }
      }
    }
  ]
}
```

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `baseUrl` | string | ❌ | 에셋(zip/썸네일/미리보기)을 받을 jsDelivr CDN 루트. 생략 시 catalog.json이 있는 폴더로 폴백 (최상위 1개) |
| `lifetimePassGiftCodes` | array | ❌ | 평생이용권 기프트코드 해시 목록. 각 항목은 `{hash, expiresAt, maxUses?}`. 스킨빌더 마커로 병합 권장 |
| `skinId` | string | ✅ | skin.json의 `skinId`와 동일. 이걸로 아래 경로를 자동 유추 |
| `name` | string | ✅ | 앱 목록 표시 이름 |
| `price` | number | ❌ | 가격(원). **0 또는 생략 = 무료.** 무료/유료 판정의 단일 출처(`isFree`는 앱이 여기서 도출 — catalog에 `isFree`는 안 씀) |
| `productId` | string | 유료 ✅ | Play 인앱상품 SKU. 스킨빌더는 유료 스킨에 `skin_{skinid}`를 자동 입력. 무료 스킨에는 불필요 |
| `prestige` | boolean | ❌ | 희귀(프리스티지) 스킨. 평생이용권으로도 해금 안 됨 → 항상 개별구매. 상점 별도 표시. 생략 시 `false` |
| `hidden` | boolean | ❌ | catalog에는 유지하지만 상점 목록에는 노출하지 않을 때 사용. 생략 시 `false` |
| `saleStart` | string | ❌ | 판매 시작일 `"yyyy-MM-dd"`. 앱은 이 날짜 전이면 미출시로 보고 상점에서 숨김. 현재 빌더는 직접 생성하지 않으므로 수동 catalog용 |
| `saleEnd` | string | ❌ | 판매 종료일 `"yyyy-MM-dd"`(당일 포함). 종료일이 지나면 기간만료로 표시하고 신규 구매를 막음 |
| `description` | string | ❌ | 상점 히어로 카드 부제(한 줄). 생략 시 부제 줄 생략 |
| `localized` | object | ❌ | 언어별 이름/설명. 현재 빌더는 `localized.en.name`, `localized.en.description`을 생성 |
| `giftCodeHashes` | string[] | ❌ | 개별 테마 기프트코드 해시 목록. 스킨빌더의 `.skin-gift-codes.json` 마커로 병합 권장 |
| `createdAt` | string | ❌ | 출시일 `"yyyy-MM-dd"`. 상점 NEW 배지 판정(출시일+7일 이내). 생략 시 NEW 안 뜸 |
| `version` | number | ❌ | 테마 버전(사람이 보는 체인지로그용 — 앱 동작엔 미사용). 스킨빌더 자동배치 시 재업로드면 +1 됨 |

> **자동 유추 경로** (`{baseUrl}/` 기준): `character/zip/{skinId}.zip`, `character/preview/{skinId}/thumb.png`,
> `character/preview/{skinId}/prev01.png`, `prev02.png` …(가변).
> 특수한 경우만 catalog 항목에 `zipUrl`/`thumbnailUrl`로 개별 덮어쓸 수 있습니다(이 둘만 오버라이드 지원).

### 4. git push
`character/zip/` + 썸네일/미리보기 + `catalog.json` 커밋 후 push → **10~15분 후** CDN 반영 → 앱 목록에 표시.
