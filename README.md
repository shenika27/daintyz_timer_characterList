# daintyz_timer_characterList

캐릭터 타이머 위젯 앱의 스킨 배포 리포지토리입니다.  
앱 업데이트 없이 신규 캐릭터를 추가할 수 있습니다.

---

## 리포 구조

```
catalog.json        ← 앱이 읽는 스킨 목록
{skinId}.zip        ← 신규 스킨 패키지 (skin.json + PNG)
```

---

## 신규 캐릭터 추가 방법

### 1. PNG 제작

| 파일 | 용도 |
|---|---|
| `idle_01.png` | 정지 상태 |
| `run_01.png ~ run_N.png` | 달리기 (프레임 수 자유) |
| `pause_01.png` | 일시정지 (생략 시 idle로 대체) |
| `win_01.png ~ win_N.png` | 완료 |

- 캐릭터 + 런닝머신 배경을 **합성한 PNG**로 제작 (배경 분리 없음)
- 권장 해상도: 2×2 셀 기준 hdpi~xxxhdpi 대응 크기

### 2. skin.json 작성

```json
{
  "skinId": "newchar",
  "name": "캐릭터 이름",
  "isFree": true,
  "character": {
    "stop": {
      "frames": ["idle_01.png"],
      "frameDurationMs": 1000
    },
    "running": {
      "default": {
        "frames": ["run_01.png", "run_02.png", "run_03.png", "run_04.png"],
        "frameDurationMs": 250
      }
    },
    "pause": {
      "frames": ["pause_01.png"],
      "frameDurationMs": 1000
    },
    "complete": {
      "frames": ["win_01.png", "win_02.png"],
      "frameDurationMs": 500
    }
  }
}
```

> `pause` 블록은 선택 사항입니다. 생략하면 `stop` 프레임으로 대체됩니다.

### 3. zip 파일로 묶기

```
newchar.zip
├── skin.json
├── idle_01.png
├── run_01.png
├── run_02.png
...
└── win_01.png
```

### 4. catalog.json에 항목 추가

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

### 5. push

zip + catalog.json을 커밋 후 push합니다.  
**10~15분 후** jsDelivr CDN에 반영되면 앱에서 다운로드 버튼이 표시됩니다.

---

## JSON 필드 설명

### catalog.json

| 필드 | 타입 | 설명 |
|---|---|---|
| `skinId` | string | 스킨 고유 ID. 영소문자+언더스코어만 사용 (예: `space_cat`) |
| `name` | string | 앱 스킨 선택 화면에 표시될 이름 |
| `isFree` | boolean | `true`: 무료 / `false`: 유료 (잠금 표시됨) |
| `zipUrl` | string | jsDelivr CDN 다운로드 URL |
| `version` | number | 스킨 버전. 리소스 수정 시 값을 올려주세요 |

---

### skin.json (zip 내부)

#### 최상위 필드

| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| `skinId` | string | ✅ | catalog.json의 `skinId`와 일치해야 함 |
| `name` | string | ✅ | 스킨 이름 |
| `isFree` | boolean | ✅ | 무료 여부 |
| `character` | object | ✅ | 캐릭터 상태별 프레임 정의 |

#### character 블록

| 키 | 필수 | 설명 |
|---|---|---|
| `stop` | ✅ | 타이머 정지 상태 |
| `running.default` | ✅ | 타이머 진행 중 (달리기) |
| `pause` | ❌ | 일시정지 상태. 생략 시 `stop` 프레임으로 대체 |
| `complete` | ✅ | 타이머 완료 상태 |

#### 프레임셋 공통 필드

| 필드 | 타입 | 설명 |
|---|---|---|
| `frames` | string[] | PNG 파일명 배열. 순서대로 재생됨 |
| `frameDurationMs` | number | 프레임 1장 표시 시간 (밀리초). 예: `250` = 초당 4프레임 |

---

## 참고

- `skinId`는 영소문자+언더스코어만 사용 (예: `space_cat`)
- 버전 업데이트 시 catalog.json의 `version` 값을 올려주세요
- 유료 스킨은 `"isFree": false` 로 설정
