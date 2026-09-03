import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function inlineScripts(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1])
    .filter((source) => source.trim());
}

test("빌더 허브가 두 빌더 경로와 공용 인증을 연결한다", () => {
  const html = read("docs/index.html");
  assert.match(html, /href="\.\/timer-builder\/"/);
  assert.match(html, /href="\.\/todo-builder\/"/);
  assert.match(html, /src="\.\/shared\/builder-auth\.js"/);
});

test("각 빌더에 상단 전환 메뉴와 현재 위치 표시가 있다", () => {
  const timer = read("docs/timer-builder/index.html");
  const todo = read("docs/todo-builder/index.html");
  assert.match(timer, /href="\.\/" aria-current="page">타이머 위젯/);
  assert.match(timer, /href="\.\.\/todo-builder\/">CharacterTodo/);
  assert.match(todo, /href="\.\.\/timer-builder\/">타이머 위젯/);
  assert.match(todo, /href="\.\/" aria-current="page">CharacterTodo/);
});

test("이동한 타이머 빌더의 핵심 작업 버튼을 보존한다", () => {
  const html = read("docs/timer-builder/index.html");
  for (const id of ["makeBtn", "autoUploadBtn", "loginForm", "logoutBtn"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test("타이머 빌더 출시 목록이 업로드 진행률과 실패 재시도를 표시한다", () => {
  const html = read("docs/timer-builder/index.html");
  assert.match(html, /class="rel-progress-track"/);
  assert.match(html, /className = "rel-percent"/);
  assert.match(html, /retryDeployment\(entry\.skinId\)/);
  assert.match(html, /\/v1\/inbox\/deployment\/retry/);
});

test("타이머 빌더는 최신 catalog와 삭제 완료를 Worker에서 자동 확인한다", () => {
  const html = read("docs/timer-builder/index.html");
  assert.match(html, /\/v1\/catalog/);
  assert.match(html, /monitorDeletion\(id, ok\.commit, paid\)/);
  assert.match(html, /CATALOG_FALLBACK_URL/);
});

test("공용 인증은 허용된 내부 빌더 이름만 이동 경로로 사용한다", () => {
  const source = read("docs/shared/builder-auth.js");
  assert.match(source, /"timer-builder": "\.\/timer-builder\/"/);
  assert.match(source, /"todo-builder": "\.\/todo-builder\/"/);
  assert.match(source, /return ROUTES\[key\] \|\| ""/);
});

test("세 HTML의 인라인 스크립트 문법이 유효하다", () => {
  for (const relativePath of [
    "docs/index.html",
    "docs/timer-builder/index.html",
    "docs/todo-builder/index.html",
  ]) {
    for (const source of inlineScripts(read(relativePath))) {
      assert.doesNotThrow(() => new Function(source), relativePath);
    }
  }
});
