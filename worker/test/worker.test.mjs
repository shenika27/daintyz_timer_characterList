import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import test from "node:test";
import worker, { __test } from "../src/index.js";

test("PBKDF2 비밀번호 해시는 계정 생성 도구와 동일하다", async () => {
  const salt = Buffer.from("0123456789abcdef").toString("base64");
  const expected = pbkdf2Sync("correct horse battery staple", Buffer.from(salt, "base64"), 100_000, 32, "sha256")
    .toString("base64");
  assert.equal(await __test.passwordHash("correct horse battery staple", salt, 100_000), expected);
  assert.equal(__test.safeEqual(expected, expected), true);
  assert.equal(__test.safeEqual(expected, `${expected}x`), false);
});

test("Cloudflare가 지원하는 PBKDF2 반복 횟수만 허용한다", () => {
  assert.equal(__test.isSupportedPasswordIterations(100_000), true);
  assert.equal(__test.isSupportedPasswordIterations(210_000), false);
  assert.equal(__test.isSupportedPasswordIterations(9_999), false);
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

test("PBKDF2 상한을 넘긴 기존 계정은 Worker 예외 대신 갱신 안내를 반환한다", async () => {
  const legacyUser = {
    id: 1,
    username: "legacy-user",
    password_salt: Buffer.from("0123456789abcdef").toString("base64"),
    password_hash: "legacy-hash",
    password_iterations: 210_000,
  };
  const DB = {
    prepare(sql) {
      return {
        bind() {
          return {
            async first() {
              if (sql.includes("FROM auth_login_attempts")) return null;
              if (sql.includes("FROM auth_users")) return legacyUser;
              return null;
            },
            async run() { return { success: true }; },
          };
        },
      };
    },
  };
  const request = new Request("https://worker.example/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "legacy-user", password: "wrong-password" }),
  });
  const response = await worker.fetch(request, { DB });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /비밀번호 설정을 갱신/);
});
