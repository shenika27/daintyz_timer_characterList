import { pbkdf2Sync, randomBytes } from "node:crypto";

// Cloudflare Workers Web Crypto의 PBKDF2 상한은 100,000회다.
const ITERATIONS = 100_000;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,64}$/;
const username = String(process.argv[2] || "").trim();

if (!USERNAME_PATTERN.test(username)) {
  console.error("사용법: node scripts/create-user.mjs <아이디>");
  console.error("아이디는 영문, 숫자, 점, 밑줄, 하이픈으로 된 3~64자여야 합니다.");
  process.exit(1);
}
if (!process.stdin.isTTY) {
  console.error("비밀번호 보호를 위해 대화형 터미널에서 실행해 주세요.");
  process.exit(1);
}

function readSecret(label) {
  return new Promise((resolve, reject) => {
    let value = "";
    process.stdout.write(label);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          reject(new Error("취소되었습니다."));
          return;
        }
        if (char === "\r" || char === "\n") {
          process.stdin.off("data", onData);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          if (value) { value = value.slice(0, -1); process.stdout.write("\b \b"); }
          continue;
        }
        if (char >= " ") { value += char; process.stdout.write("*"); }
      }
    };
    process.stdin.on("data", onData);
  });
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

try {
  const password = await readSecret("비밀번호: ");
  const confirmation = await readSecret("비밀번호 확인: ");
  if (password !== confirmation) throw new Error("비밀번호가 서로 다릅니다.");
  if (password.length < 12) throw new Error("비밀번호는 12자 이상이어야 합니다.");

  const salt = randomBytes(16).toString("base64");
  const hash = pbkdf2Sync(password, Buffer.from(salt, "base64"), ITERATIONS, 32, "sha256").toString("base64");
  const createdAt = Math.floor(Date.now() / 1000);
  const sql = [
    "INSERT INTO auth_users (username, password_salt, password_hash, password_iterations, is_active, created_at)",
    `VALUES (${sqlText(username)}, ${sqlText(salt)}, ${sqlText(hash)}, ${ITERATIONS}, 1, ${createdAt})`,
    "ON CONFLICT(username) DO UPDATE SET",
    "password_salt = excluded.password_salt, password_hash = excluded.password_hash,",
    "password_iterations = excluded.password_iterations, is_active = 1;",
    `DELETE FROM auth_sessions WHERE user_id = (SELECT id FROM auth_users WHERE username = ${sqlText(username)} COLLATE NOCASE);`,
  ].join(" ");
  console.log("\n아래 SQL을 D1에 실행하세요. 평문 비밀번호는 포함되지 않습니다.\n");
  console.log(sql);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
