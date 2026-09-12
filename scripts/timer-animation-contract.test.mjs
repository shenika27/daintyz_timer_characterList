import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const builderSource = fs.readFileSync(new URL("../docs/timer-builder/index.html", import.meta.url), "utf8");

test("빌더는 실제 위젯과 같은 최소 프레임 간격을 사용한다", () => {
  assert.match(builderSource, /const WIDGET_MIN_FRAME_MS = 90;/);
  assert.match(builderSource, /min="\$\{WIDGET_MIN_FRAME_MS\}"/);
  assert.match(builderSource, /frameDurationMs: normalizedFrameDurationMs\(store\[stateKey\]\.dur\)/);
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
