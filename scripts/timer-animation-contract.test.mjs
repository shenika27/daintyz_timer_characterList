import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const builderSource = fs.readFileSync(new URL("../docs/timer-builder/index.html", import.meta.url), "utf8");

function builderFunction(name) {
  const match = builderSource.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
  assert.ok(match, `${name} 함수를 찾지 못했습니다.`);
  return match[0];
}

const calculateEffectiveDuration = new Function(`
  const WIDGET_MIN_FRAME_MS = 90;
  const WIDGET_MIN_LOOP_CYCLE_MS = 800;
  const GIF_DELAY_STEP_MS = 10;
  ${builderFunction("normalizedFrameDurationMs")}
  ${builderFunction("isLoopingPreview")}
  ${builderFunction("effectiveFrameDurationMs")}
  return effectiveFrameDurationMs;
`)();

test("빌더는 실제 위젯과 같은 최소 프레임 간격을 사용한다", () => {
  assert.match(builderSource, /const WIDGET_MIN_FRAME_MS = 90;/);
  assert.match(builderSource, /min="\$\{WIDGET_MIN_FRAME_MS\}"/);
  assert.match(builderSource, /frameDurationMs: effectiveFrameDurationMs\(stateKey, store\[stateKey\]\.dur, names\.length\)/);
});

test("반복 프레임이 적으면 한 바퀴가 최소 800ms가 되도록 보정한다", () => {
  assert.match(builderSource, /const WIDGET_MIN_LOOP_CYCLE_MS = 800;/);
  assert.match(builderSource, /stateKey === "running" \|\| stateKey === "interlude"/);
  assert.match(builderSource, /WIDGET_MIN_LOOP_CYCLE_MS \/ frameCount \/ GIF_DELAY_STEP_MS/);
  assert.match(builderSource, /effectiveFrameDurationMs\(stateKey, configuredDur, urls\.length\)/);
  assert.match(builderSource, /effectiveFrameDurationMs\(stateKey, st\.dur, ordered\.length, 200\)/);
  assert.match(builderSource, /최소 0\.8초\/회전/);
  assert.equal(calculateEffectiveDuration("running", 170, 2), 400);
  assert.equal(calculateEffectiveDuration("running", 170, 3), 270);
  assert.equal(calculateEffectiveDuration("running", 170, 4), 200);
  assert.equal(calculateEffectiveDuration("running", 170, 5), 170);
  assert.equal(calculateEffectiveDuration("pause", 170, 2), 170);
});

test("빌더 편집 미리보기는 누적 인덱스가 아니라 경과 시간으로 프레임을 선택한다", () => {
  assert.match(builderSource, /buildComposedPreviewUrls\(stateKey\)/);
  assert.match(builderSource, /composeWidgetFrame\(ctx, geom, bitmap, tctx, stateKey\)/);
  assert.match(builderSource, /performance\.now\(\) - startedAt/);
  assert.match(builderSource, /Math\.floor\(elapsed \/ dur\)/);
  assert.doesNotMatch(builderSource, /setInterval\(\(\) => \{ i = \(i \+ 1\)/);
});

test("구운 GIF는 작동 상태만 무한 반복한다", () => {
  assert.match(builderSource, /i === 0 \? \(stateKey === "running" \? 0 : -1\) : undefined/);
  assert.match(builderSource, /stateKey === "interlude"/);
  assert.match(builderSource, /totalDuration - elapsed/);
});

test("빌더는 목록 썸네일과 이미지 상세 미리보기를 별도 파일로 발행한다", () => {
  assert.match(builderSource, /<h2>4\. 이미지 첨부<\/h2>/);
  assert.match(builderSource, /id="asset_thumb"/);
  assert.match(builderSource, /id="asset_detail"/);
  assert.match(builderSource, /if \(!previewDetail\) errors\.push/);
  assert.match(builderSource, /prevDir\.file\("detail\.png", await toPngBlob\(previewDetail\.file\)\)/);
  assert.match(builderSource, /character\/preview\/\$\{entry\.skinId\}\/detail\.png/);
});
