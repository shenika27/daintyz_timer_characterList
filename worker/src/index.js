// 스킨 빌더 인증 및 _inbox 커밋 프록시 Worker
// 필요한 바인딩/시크릿: DB(Cloudflare D1), GITHUB_TOKEN

const DEFAULTS = {
  OWNER: "shenika27",
  REPO: "daintyz_timer_characterList",
  BRANCH: "main",
  ALLOW_ORIGIN: "https://shenika27.github.io",
  SESSION_TTL_SECONDS: "28800",
};
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_MAX_FAILURES = 5;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,64}$/;

function cfg(env, name) { return (env && env[name]) || DEFAULTS[name]; }
function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": cfg(env, "ALLOW_ORIGIN"),
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400", "Cache-Control": "no-store", "Vary": "Origin",
  };
}
function json(body, status, env) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(env) },
  });
}
function bytesToHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
function bytesToBase64(bytes) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}
function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
function randomToken() {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}
async function passwordHash(password, saltBase64, iterations) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: base64ToBytes(saltBase64), iterations }, key, 256
  );
  return bytesToBase64(new Uint8Array(bits));
}
function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function bearerToken(request) {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("Authorization") || "");
  return match ? match[1].trim() : "";
}
async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

async function requireSession(request, env) {
  const token = bearerToken(request);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const now = Math.floor(Date.now() / 1000);
  const session = await env.DB.prepare(
    `SELECT s.expires_at, s.last_seen_at, u.id AS user_id, u.username
       FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND u.is_active = 1`
  ).bind(tokenHash).first();
  if (!session) return null;
  if (Number(session.expires_at) <= now) {
    await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(tokenHash).run();
    return null;
  }
  if (now - Number(session.last_seen_at || 0) >= 300) {
    await env.DB.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?")
      .bind(now, tokenHash).run();
  }
  return { tokenHash, userId: session.user_id, username: session.username, expiresAt: session.expires_at };
}

async function loginRateKey(request, username) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  return sha256(`${username.toLowerCase()}|${ip}`);
}
async function checkLoginBlocked(env, rateKey, now) {
  const row = await env.DB.prepare("SELECT blocked_until FROM auth_login_attempts WHERE rate_key = ?")
    .bind(rateKey).first();
  return !!row && Number(row.blocked_until || 0) > now;
}
async function recordLoginFailure(env, rateKey, now) {
  const row = await env.DB.prepare(
    "SELECT failed_count, first_failed_at FROM auth_login_attempts WHERE rate_key = ?"
  ).bind(rateKey).first();
  const reset = !row || now - Number(row.first_failed_at) >= LOGIN_WINDOW_SECONDS;
  const failedCount = reset ? 1 : Number(row.failed_count) + 1;
  const firstFailedAt = reset ? now : Number(row.first_failed_at);
  const blockedUntil = failedCount >= LOGIN_MAX_FAILURES ? now + LOGIN_WINDOW_SECONDS : 0;
  await env.DB.prepare(
    `INSERT INTO auth_login_attempts (rate_key, failed_count, first_failed_at, blocked_until)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(rate_key) DO UPDATE SET failed_count = excluded.failed_count,
       first_failed_at = excluded.first_failed_at, blocked_until = excluded.blocked_until`
  ).bind(rateKey, failedCount, firstFailedAt, blockedUntil).run();
  return blockedUntil;
}

async function handleLogin(request, env) {
  const payload = await readJson(request);
  const username = String(payload?.username || "").trim();
  const password = String(payload?.password || "");
  if (!USERNAME_PATTERN.test(username) || !password || password.length > 1024) {
    return json({ ok: false, error: "아이디 또는 비밀번호가 올바르지 않습니다." }, 401, env);
  }
  const now = Math.floor(Date.now() / 1000);
  const rateKey = await loginRateKey(request, username);
  if (await checkLoginBlocked(env, rateKey, now)) {
    return json({ ok: false, error: "로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요." }, 429, env);
  }
  const user = await env.DB.prepare(
    `SELECT id, username, password_salt, password_hash, password_iterations
       FROM auth_users WHERE username = ? COLLATE NOCASE AND is_active = 1`
  ).bind(username).first();
  let verified = false;
  if (user) {
    const calculated = await passwordHash(password, user.password_salt, Number(user.password_iterations));
    verified = safeEqual(calculated, user.password_hash);
  }
  if (!verified) {
    const blockedUntil = await recordLoginFailure(env, rateKey, now);
    const error = blockedUntil ? "로그인 시도가 너무 많습니다. 15분 후 다시 시도해 주세요."
      : "아이디 또는 비밀번호가 올바르지 않습니다.";
    return json({ ok: false, error }, blockedUntil ? 429 : 401, env);
  }
  await env.DB.prepare("DELETE FROM auth_login_attempts WHERE rate_key = ?").bind(rateKey).run();
  await env.DB.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").bind(now).run();
  const token = randomToken();
  const tokenHash = await sha256(token);
  const configuredTtl = Number.parseInt(cfg(env, "SESSION_TTL_SECONDS"), 10);
  const ttl = Number.isFinite(configuredTtl) ? Math.min(Math.max(configuredTtl, 900), 86400) : 28800;
  const expiresAt = now + ttl;
  await env.DB.prepare(
    "INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)"
  ).bind(tokenHash, user.id, expiresAt, now, now).run();
  return json({ ok: true, token, username: user.username, expiresAt }, 200, env);
}
async function handleSession(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ ok: false, error: "로그인이 필요합니다." }, 401, env);
  return json({ ok: true, username: session.username, expiresAt: session.expiresAt }, 200, env);
}
async function handleLogout(request, env) {
  const token = bearerToken(request);
  if (token) await env.DB.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return json({ ok: true }, 200, env);
}

function isSafeInboxPath(path) {
  if (typeof path !== "string" || !path.startsWith("_inbox/")) return false;
  if (path.includes("..") || path.includes("//")) return false;
  return /^[A-Za-z0-9._-]+$/.test(path.slice("_inbox/".length));
}
async function githubRequest(env, method, path, body) {
  return fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`, "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "daintyz-inbox-worker",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function handleInbox(request, env) {
  const session = await requireSession(request, env);
  if (!session) return json({ ok: false, error: "로그인이 필요합니다." }, 401, env);
  if (!env.GITHUB_TOKEN) return json({ ok: false, error: "서버 설정이 완료되지 않았습니다." }, 500, env);
  const payload = await readJson(request);
  if (!payload) return json({ ok: false, error: "JSON 형식이 올바르지 않습니다." }, 400, env);
  const path = payload.path;
  if (!isSafeInboxPath(path)) return json({ ok: false, error: `허용되지 않는 경로: ${path}` }, 400, env);
  if (typeof payload.contentBase64 !== "string" || !payload.contentBase64) {
    return json({ ok: false, error: "contentBase64가 없습니다." }, 400, env);
  }
  const owner = cfg(env, "OWNER"), repo = cfg(env, "REPO"), branch = cfg(env, "BRANCH");
  const apiPath = `/repos/${owner}/${repo}/contents/${path}`;
  const message = typeof payload.message === "string" && payload.message.trim() ? payload.message.trim()
    : `스킨 빌더 업로드: ${path.slice("_inbox/".length)}`;
  let sha;
  const getResponse = await githubRequest(env, "GET", `${apiPath}?ref=${encodeURIComponent(branch)}`);
  if (getResponse.status === 200) sha = (await getResponse.json()).sha;
  else if (getResponse.status !== 404) {
    return json({ ok: false, error: `기존 파일 조회 실패(${getResponse.status})` }, 502, env);
  }
  const putResponse = await githubRequest(env, "PUT", apiPath, {
    message, content: payload.contentBase64, branch, ...(sha ? { sha } : {}),
  });
  if (putResponse.status === 200 || putResponse.status === 201) {
    const output = await putResponse.json();
    return json({ ok: true, path, commit: output.commit?.sha,
      htmlUrl: output.content?.html_url, uploadedBy: session.username }, 200, env);
  }
  return json({ ok: false, error: `GitHub 커밋 실패(${putResponse.status})` }, 502, env);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(env) });
    if (!env.DB) return json({ ok: false, error: "D1 DB 바인딩이 없습니다." }, 500, env);
    const path = new URL(request.url).pathname;
    if (request.method === "POST" && path === "/auth/login") return handleLogin(request, env);
    if (request.method === "GET" && path === "/auth/session") return handleSession(request, env);
    if (request.method === "POST" && path === "/auth/logout") return handleLogout(request, env);
    if (request.method === "POST" && (path === "/inbox" || path === "/")) return handleInbox(request, env);
    return json({ ok: false, error: "지원하지 않는 요청입니다." }, 404, env);
  },
};

export const __test = { passwordHash, safeEqual, isSafeInboxPath, sha256 };
