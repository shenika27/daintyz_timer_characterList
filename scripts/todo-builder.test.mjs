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
