# daintyz_timer_characterList

캐릭터 타이머 위젯 앱의 스킨 배포 리포지토리입니다.  
앱 업데이트 없이 신규 캐릭터를 추가할 수 있습니다.

---

## 구조

```
catalog.json      ← 앱이 읽는 스킨 목록
{skinId}.zip      ← 신규 스킨 패키지 (skin.json + PNG)
```

---

## 신규 캐릭터 추가 방법

### 1. zip 파일 준비

```
{skinId}/
├── skin.json
├── idle_01.png
├── run_01.png
├── run_02.png
...
```

위 구조로 zip으로 압축합니다.

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

### 3. zip + catalog.json 커밋 후 push

10~15분 후 jsDelivr CDN에 반영되면 앱에서 다운로드 가능해집니다.

---

## skin.json 형식

```json
{
  "skinId": "example",
  "name": "예시",
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
    "complete": {
      "frames": ["run_04.png"],
      "frameDurationMs": 500
    }
  }
}
```
