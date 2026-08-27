import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import test from "node:test";
import worker, { __test } from "../src/index.js";

test("PBKDF2 비밀번호 해시는 계정 생성 도구와 동일하다", async () => {
  const salt = Buffer.from("0123456789abcdef").toString("base64");
  const expected = pbkdf2Sync("correct horse battery staple", Buffer.from(salt, "base64"), 210_000, 32, "sha256")
    .toString("base64");
  assert.equal(await __test.passwordHash("correct horse battery staple", salt, 210_000), expected);
  assert.equal(__test.safeEqual(expected, expected), true);
  assert.equal(__test.safeEqual(expected, `${expected}x`), false);
});

test("_inbox 바로 아래의 안전한 파일명만 허용한다", () => {
  assert.equal(__test.isSafeInboxPath("_inbox/cha07.zip"), true);
  assert.equal(__test.isSafeInboxPath("_inbox/cha07.delete.json"), true);
  assert.equal(__test.isSafeInboxPath("_inbox/../catalog.json"), false);
  assert.equal(__test.isSafeInboxPath("_inbox/sub/file.zip"), false);
});

test("D1 바인딩이 없으면 명확한 설정 오류를 반환한다", async () => {
  const response = await worker.fetch(new Request("https://worker.example/auth/session"), {});
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, "D1 DB 바인딩이 없습니다.");
});
