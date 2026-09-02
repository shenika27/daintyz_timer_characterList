import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("todo-builder가 판매 캐릭터·최초 발급·발급 원장 화면을 제공한다", () => {
  const html = read("docs/todo-builder/index.html");
  for (const id of [
    "characterForm",
    "orderForm",
    "orderItems",
    "initialCodeResult",
    "orderSearchForm",
    "orderTableBody",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /todo-builder\.css/);
  assert.match(html, /todo-builder\.js/);
});

test("캐릭터 제작·관리와 주문·코드를 전체 폭 작업 화면으로 분리한다", () => {
  const html = read("docs/todo-builder/index.html");
  assert.match(html, /data-workspace-tab="characters"/);
  assert.match(html, /data-workspace-tab="sales"/);
  assert.match(html, /id="characterLibraryScreen"/);
  assert.match(html, /id="characterEditorScreen"/);
  assert.match(html, /id="salesWorkspace"[^>]*hidden/);
  assert.doesNotMatch(html, /class="todo-layout"/);
});

test("캐릭터 편집기가 기본정보·행동 구성·미리보기 단계를 제공한다", () => {
  const html = read("docs/todo-builder/index.html");
  for (const tab of ["basic", "actions", "preview"]) {
    assert.match(html, new RegExp(`data-editor-tab="${tab}"`));
    assert.match(html, new RegExp(`data-editor-panel="${tab}"`));
  }
  for (const id of [
    "characterActionSlots",
    "previewActionButtons",
    "previewCanvas",
    "publishDialog",
    "publishLogInput",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test("실제 PC 앱 액션과 패치 버전 게시 UI를 사용한다", () => {
  const html = read("docs/todo-builder/index.html");
  const source = read("docs/todo-builder/todo-builder.js");
  for (const action of ["default", "overdue", "delete", "idle", "done", "add", "work", "pause", "timer_done", "open", "closed"]) {
    assert.match(source, new RegExp(`id: "${action}"`));
  }
  assert.match(source, /async function loadPublicationPlan\(\)/);
  assert.match(source, /data\.currentVersion/);
  assert.match(source, /data\.nextVersion/);
  assert.match(html, /id="nextAppVersion"[^>]*readonly/);
  assert.match(html, /id="confirmPublishButton" disabled/);
});

test("발급 횟수 이력과 재발급·폐기·환불 대화상자를 제공한다", () => {
  const html = read("docs/todo-builder/index.html");
  assert.match(html, /id="historyDialog"/);
  assert.match(html, /id="reasonDialog"/);
  assert.match(html, /id="codeDialog"/);
  assert.match(html, /aria-live="polite"/);

  const source = read("docs/todo-builder/todo-builder.js");
  assert.match(source, /data-history-item/);
  assert.match(source, /data-history-action="reissue"/);
  assert.match(source, /data-history-action="revoke"/);
  assert.match(source, /data-history-action="refund"/);
});

test("todo-builder가 2단계 CharacterTodo API 계약을 모두 사용한다", () => {
  const source = read("docs/todo-builder/todo-builder.js");
  for (const endpoint of [
    "/v1/todo/characters",
    "/v1/todo/orders",
    "/v1/todo/order-items/",
    "/v1/todo/issuances/",
    "/v1/todo/order-units/",
  ]) {
    assert.ok(source.includes(endpoint), endpoint);
  }
  assert.match(source, /credentials: "include"/);
  assert.match(source, /request_id: state\.orderRequestId/);
  assert.match(source, /body\.request_id = action\.requestId/);
});

test("주문 상품 선택에 커스텀 기능 이용권을 고정 제공하고 기능 상품 계약으로 전송한다", () => {
  const source = read("docs/todo-builder/todo-builder.js");
  assert.match(source, /CUSTOMIZATION_OPTION_VALUE = `feature:\$\{CUSTOMIZATION_FEATURE_ID\}`/);
  assert.match(source, /CUSTOMIZATION_PRODUCT_LABEL = "커스텀 기능 영구 이용권"/);
  assert.match(source, /entitlement_type: "FEATURE"/);
  assert.match(source, /feature_id: CUSTOMIZATION_FEATURE_ID/);
  assert.match(source, /selectedId === CUSTOMIZATION_OPTION_VALUE/);
});

test("운영 화면은 Worker 비밀값을 포함하지 않고 스크립트 문법이 유효하다", () => {
  const html = read("docs/todo-builder/index.html");
  const source = read("docs/todo-builder/todo-builder.js");
  assert.doesNotMatch(`${html}\n${source}`, /TODO_SALES_SECRET/);
  assert.doesNotThrow(() => new Function(source));
});

test("좁은 화면용 반응형 규칙이 있다", () => {
  const css = read("docs/todo-builder/todo-builder.css");
  assert.match(css, /@media \(max-width: 980px\)/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /\.todo-layout\s*\{/);
  assert.match(css, /\.todo-dialog::backdrop/);
});
