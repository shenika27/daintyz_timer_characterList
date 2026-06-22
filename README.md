# daintyz_timer_characterList

캐릭터 타이머 위젯 앱의 **스킨 배포 리포지토리**입니다.
앱 업데이트 없이 신규 캐릭터를 추가할 수 있습니다.

> 스킨 1개 = **캐릭터 + 런닝머신 배경이 합성된 한 세트**
> (예: "감자" → 감자 캐릭터 + 흙밭 배경 / "우주" → 우주인 + 우주 배경)

---

## 리포 구조

```
catalog.json        ← 앱이 읽는 스킨 목록
{skinId}.zip        ← 스킨 한 세트 (skin.json + PNG들)
```

신규 캐릭터 출시 = zip + catalog.json 수정해서 **git push만** 하면 됩니다.
10~15분 후 jsDelivr CDN에 반영되면 앱 다운로드 목록에 자동으로 나타납니다.

---
---

# 🎨 PART 1. 그림 제작 (디자이너용)

> **이 파트만 보고 PNG를 그리면 됩니다.** JSON(PART 2)은 몰라도 됩니다 —
> 그림을 넘겨주면 개발자가 채웁니다.

## 1. 무엇을 그리나 — 캐릭터의 4가지 상태

타이머 상태에 따라 캐릭터가 바뀝니다. 각 상태는 **여러 장의 PNG가 순서대로 반복 재생**되는 애니메이션입니다.

| 상태 | 캐릭터가 하는 행동 | 프레임 수 | 파일명 |
|---|---|---|---|
| **정지(stop)** | 타이머 멈춤 — 가만히 서 있기 | 보통 1장 | `idle_01.png` |
| **달리기(running)** | 타이머 작동 중 — 런닝머신 위에서 달리기 | 3~6장 | `run_01.png` ~ `run_NN.png` |
| **일시정지(pause)** | 잠깐 멈춤 — 숨 고르기 (선택, 생략 가능) | 1~2장 | `pause_01.png` |
| **완료(complete)** | 시간 끝! — 승리 포즈 | 2~4장 | `win_01.png` ~ `win_NN.png` |

- `pause`는 **선택 사항** — 안 그리면 정지(idle) 그림을 대신 씁니다.
- 프레임이 많을수록 애니메이션이 부드럽습니다 (달리기는 4장 권장).

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
│──발──│ │──발──│ │──발──│               │──발──│ │──발──│ │ 발   │
└──────┘ └──────┘ └──────┘              └──────┘ └──────┘ └──────┘
```

- **정지(idle) 프레임의 발도 달리기 최저점과 같은 바닥선**에 두세요. (안 그러면 정지일 때만 캐릭터가 떠 보임)
- 권장: 그림 바닥을 캔버스 맨 아래에서 4px 이내로 정렬 → "러닝머신 위에 서 있는" 느낌.

### 비율 / 해상도
- 캐릭터 영역은 정사각형에 가깝습니다(위젯 2×2 칸). 세로가 약간 긴 비율도 OK.
- 모든 프레임 동일 크기라면 해상도는 자유. **참고: 기본 감자 스킨은 96×130px**.
  더 또렷하게 하려면 2~3배(예: 약 200~400px)로 키워도 됩니다. 단 과도하게 크면 위젯 로딩이 무거워집니다.

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
    "frames": ["run_01.png", "run_02.png", "run_03.png", "run_04.png"],
    "frameDurationMs": 250
  }
}
```

**예시 2) 6장 왕복 달리기** — 1→4까지 갔다가 3,2로 되돌아와 더 부드럽게
```json
"running": {
  "default": {
    "frames": ["run_01.png", "run_02.png", "run_03.png", "run_04.png", "run_03.png", "run_02.png"],
    "frameDurationMs": 250
  }
}
```

**예시 3) 정지(1장)** — 프레임이 1장이면 값은 무시됨 (아무 값이나 OK)
```json
"stop": { "frames": ["idle_01.png"], "frameDurationMs": 1000 }
```

**예시 4) 완료 포즈** — 느긋하게 반복하려고 `500ms`로 길게
```json
"complete": { "frames": ["win_01.png", "win_02.png"], "frameDurationMs": 500 }
```

> **재생 시간 계산:** `frameDurationMs × 프레임 수` = 한 사이클 길이.
> 예) 200ms × 4장 = 0.8초 / 250ms × 6장 = 1.5초. 이 사이클이 계속 반복됩니다.

## 4. 파일명 규칙

- 소문자 + 언더스코어 + 2자리 번호: `run_01.png`, `win_02.png`
- 번호는 재생 순서. 빠지는 번호 없이 `_01`부터 연속으로.

## 5. 디자이너 체크리스트

- [ ] 모든 프레임 캔버스 크기 동일
- [ ] 배경 투명 (RGBA)
- [ ] 모든 프레임 발 높이(바닥선) 일치 — 정지 프레임 포함
- [ ] 4가지 상태 그림 준비 (pause는 선택)
- [ ] 파일명 규칙 준수
- [ ] (선택) 타이머 숫자 색이 배경과 잘 보이는지 — 어두운 배경이면 밝은 글자색 필요

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
    "showBox": true,
    "showDividers": true,
    "buttonStyle": "default",
    "font": {
      "family": "monospace",
      "color": "#1A1A1A",
      "sizeSp": 30
    }
  },
  "character": {
    "stop":     { "frames": ["idle_01.png"], "frameDurationMs": 1000 },
    "running":  { "default": { "frames": ["run_01.png", "run_02.png", "run_03.png", "run_04.png"], "frameDurationMs": 250 } },
    "pause":    { "frames": ["pause_01.png"], "frameDurationMs": 1000 },
    "complete": { "frames": ["win_01.png", "win_02.png"], "frameDurationMs": 500 }
  }
}
```

> `timer` 와 `pause` 는 선택 사항입니다.
> - `timer` 생략 → **노스킨**(박스/구분선/버튼 그림 없이 투명, 탭 영역만 동작)
> - `pause` 생략 → `stop` 프레임으로 대체

## 최상위 필드

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `skinId` | string | ✅ | 스킨 고유 ID. 영소문자+언더스코어 (예: `space_cat`). catalog.json과 일치 |
| `name` | string | ✅ | 앱에 표시될 이름 |
| `isFree` | boolean | ✅ | `true` 무료 / `false` 유료(잠금 표시) |
| `timer` | object | ❌ | 타이머 영역 스킨. 생략 시 노스킨(투명) |
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

타이머 숫자/버튼 영역의 시각 요소. 생략하면 **노스킨**(전부 투명, 탭 영역만 동작).

| 필드 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `background` | string | `null` | 박스 배경 PNG 파일명. 지정 시 박스 뒤에 깔리고 내장 박스는 끔 |
| `showBox` | boolean | `true` | 박스 배경/테두리 표시. `background`가 있으면 무시 |
| `showDividerH` | boolean | `true` | 숫자↔버튼 사이 가로선 표시 |
| `dividerHImage` | string | `null` | 가로선 PNG (지정 시 색 대신 이미지) |
| `dividerHHeightDp` | number | `1` | 가로선 높이(dp). 이미지 사용 시 반드시 키울 것 |
| `showDividers` | boolean | `true` | 버튼 사이 세로선 표시 |
| `dividersColor` | string | `#2B2B2B` | 세로선 색 (`#RRGGBB`/`#AARRGGBB`) |
| `dividersImage` | string | `null` | 세로선 PNG (지정 시 색 대신 이미지) |
| `dividersWidthDp` | number | `1` | 세로선 폭(dp). 이미지 사용 시 반드시 키울 것 |
| `buttonStyle` | string | `default` | `default`(내장 기호) / `none`(투명) / `skin`(아래 PNG 사용) |
| `buttons` | object | `null` | `buttonStyle:skin`일 때 `minus`/`plus`/`play`/`pause`/`stop` PNG. 누락 심볼은 내장 기호로 대체 |
| `font` | object | `null` | 숫자 글꼴 `family`/`color`/`sizeSp`. 생략 시 monospace·30sp·`#1A1A1A` |

### 타이머 영역 구조 (참고)

```
┌────────────────────────────┐  ← 박스 (배경/테두리)
│           10:00            │  ← 숫자 (font)
├────────────────────────────┤  ← 가로 구분선 (showDividerH)
│    −    |    ▶    |    +  │  ← 버튼 행 (세로선 = showDividers)
└────────────────────────────┘
```

**상태별 보이는 버튼** (버튼 칸은 균등 분할 → 상태마다 폭이 달라짐):

| 상태 | 버튼 | 칸 |
|---|---|---|
| 정지 | − ▶ + | 1/3씩 |
| 진행 | II □ | 1/2씩 |
| 일시정지 | ▶ □ | 1/2씩 |
| 완료 | 없음 | — |

> 배경 이미지에 **버튼 칸 구분선을 그리지 마세요.** 상태마다 칸 폭이 바뀌어 안 맞습니다. 구분선은 `showDividers`로.

### 제약 사항

- **커스텀 글꼴(.ttf) 미지원** — `font.family`는 내장 패밀리명만(`monospace`, `sans-serif`, `serif` 등). 색/크기는 자유.
- 버튼/배경 PNG는 **투명 배경(RGBA)** 으로. 배경 위에 겹쳐 그려지므로 불투명하면 디자인을 가림.
- 배경 PNG는 `fitXY`로 늘어남 → 코너 장식보다 **단순·대칭** 구성 권장.

> 타이머 영역의 고급 디자인(배경 PNG, 구분선 이미지, 버튼 PNG 합성 등)은 위 표만으로 충분히 구성할 수 있습니다.
> 더 복잡한 조합이 필요하면 개발자와 상의하세요.

---
---

# 📦 PART 3. 배포 절차

### 1. zip으로 묶기
```
newchar.zip
├── skin.json
├── idle_01.png
├── run_01.png ~ run_04.png
└── win_01.png ~ win_02.png
```

### 2. catalog.json에 항목 추가
```json
{
  "skins": [
    {
      "skinId": "newchar",
      "name": "캐릭터 이름",
      "isFree": true,
      "zipUrl": "https://cdn.jsdelivr.net/gh/shenika27/daintyz_timer_characterList@main/newchar.zip",
      "version": 1
    }
  ]
}
```

| 필드 | 설명 |
|---|---|
| `skinId` | skin.json의 `skinId`와 동일 |
| `name` | 앱 목록 표시 이름 |
| `isFree` | 무료 여부 |
| `zipUrl` | jsDelivr CDN URL (위 패턴에서 파일명만 교체) |
| `version` | 스킨 버전. 리소스 수정 시 값을 올리면 앱이 다시 받음 |

### 3. git push
zip + catalog.json 커밋 후 push → **10~15분 후** CDN 반영 → 앱 다운로드 목록에 표시.
