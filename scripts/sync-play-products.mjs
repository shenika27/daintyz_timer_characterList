// _play_upsert.json / _play_delete.txt (apply-skin-bundle.mjs 산출물)을 읽어
// Google Play 인앱상품(SKU)을 자동 등록/수정/비활성화한다.
//
// 흐름(워크플로우): 번들 배치 → catalog 병합 → R2 업로드 → [이 스크립트] → catalog 커밋.
//   유료 스킨이 새로 올라오면 Play Console에 SKU(skin_{skinid})를 만들어 둬야
//   앱 상점의 구매 버튼이 실제 상품을 가리킨다 → 그래서 커밋 '전에' 동기화한다.
//
// 설계 결정:
//   - 신규 상품은 status=inactive 로 만든다(가격 오타가 곧바로 실판매로 이어지는 사고 방지).
//     안정화되면 Play Console에서 '활성'만 누르면 판매 시작.
//   - 이미 존재하는 상품은 기존 status를 보존한다(활성 상품을 비활성으로 되돌리지 않음).
//     → 가격/이름만 갱신. "안정화되면 즉시판매로 쉽게 돌리는" 구조를 깨지 않는다.
//   - 삭제된 유료 스킨은 하드 삭제 대신 status=inactive 로 내린다(구매 이력 보존).
//
// 인증: 결제 Worker와 동일한 서비스계정 JWT → OAuth2(androidpublisher 스코프).
//   Node 20 전역 Web Crypto/atob/btoa 사용 → 외부 의존성 0.
//
// 환경변수:
//   GOOGLE_SERVICE_ACCOUNT_JSON  (secret) GCP 서비스계정 JSON 전체. 없으면:
//        - 처리할 유료 변경이 있으면 명확히 실패(커밋 차단 → 깨진 상태 방지)
//        - 유료 변경이 없으면 조용히 통과(무료 전용 파이프라인은 토큰 없이도 동작)
//   ANDROID_PACKAGE_NAME         앱 패키지명(예: com.daintyz.timerwidget)
//   PLAY_PRODUCT_STATUS          신규 상품 초기 상태("inactive" 기본 | "active")
//   PLAY_PRICE_CURRENCY          기준 통화(기본 "KRW")

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PLAY_UPSERT = path.join(ROOT, "_play_upsert.json");
const PLAY_DELETE = path.join(ROOT, "_play_delete.txt");

const PKG = process.env.ANDROID_PACKAGE_NAME || "";
const NEW_STATUS = (process.env.PLAY_PRODUCT_STATUS || "inactive").toLowerCase() === "active"
  ? "active" : "inactive";
const CURRENCY = process.env.PLAY_PRICE_CURRENCY || "KRW";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3";
const SCOPE = "https://www.googleapis.com/auth/androidpublisher";

function log(m) { console.log(`[sync-play-products] ${m}`); }
function fail(m) { console.error(`::error::[sync-play-products] ${m}`); process.exit(1); }

// ── 입력 로드 ───────────────────────────────────────────────────────────────
let upserts = [];
if (fs.existsSync(PLAY_UPSERT)) {
  try { upserts = JSON.parse(fs.readFileSync(PLAY_UPSERT, "utf8")); }
  catch { fail("_play_upsert.json 파싱 실패."); }
  if (!Array.isArray(upserts)) upserts = [];
}
let deletes = [];
if (fs.existsSync(PLAY_DELETE)) {
  deletes = fs.readFileSync(PLAY_DELETE, "utf8").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

if (upserts.length === 0 && deletes.length === 0) {
  log("Play 변경 없음(무료 전용/변경 없음) — 건너뜀.");
  process.exit(0);
}

if (!PKG) fail("ANDROID_PACKAGE_NAME 이 비어 있습니다(워크플로우 env에 패키지명을 넣으세요).");
const saRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
if (!saRaw) {
  fail("유료 상품 변경이 있으나 GOOGLE_SERVICE_ACCOUNT_JSON 시크릿이 없습니다. " +
    "Play API 호출 불가 — 중단합니다(catalog는 커밋되지 않아 깨진 상태가 생기지 않음).");
}

// ── 인증(서비스계정 JWT → 액세스 토큰) ──────────────────────────────────────
function b64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function importPrivateKey(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8", der.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
}
async function getAccessToken(sa) {
  const iat = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = { iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 };
  const enc = (o) => b64url(new TextEncoder().encode(JSON.stringify(o)));
  const unsigned = `${enc(header)}.${enc(claim)}`;
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(new Uint8Array(sig))}`;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    fail(`OAuth 토큰 발급 실패(HTTP ${res.status}): ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

// ── androidpublisher inappproducts ──────────────────────────────────────────
function ipUrl(sku, query = "") {
  const base = `${API}/applications/${encodeURIComponent(PKG)}/inappproducts`;
  return sku ? `${base}/${encodeURIComponent(sku)}${query}` : `${base}${query}`;
}
async function apiFetch(token, url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { ok: res.ok, status: res.status, json };
}

/** 인앱상품 리소스 본문. 기존(prev) 있으면 status 보존, 없으면 NEW_STATUS. */
function buildProduct(item, prev) {
  const priceMicros = String(Math.round(Number(item.price) * 1_000_000));
  const title = String(item.name || item.skinId).slice(0, 55);
  const enTitle = String(item.localized?.en?.name || "").trim().slice(0, 55);
  const listings = { "ko-KR": { title, description: title } };
  if (enTitle) listings["en-US"] = { title: enTitle, description: enTitle };
  return {
    packageName: PKG,
    sku: item.productId,
    status: prev?.status || NEW_STATUS,
    purchaseType: "managedUser", // 1회 구매 비소비성(스킨 영구 보유)
    defaultLanguage: prev?.defaultLanguage || "ko-KR",
    defaultPrice: { priceMicros, currency: CURRENCY },
    listings,
  };
}

const SA = (() => {
  try { return JSON.parse(saRaw); }
  catch { fail("GOOGLE_SERVICE_ACCOUNT_JSON 파싱 실패(JSON 전체를 넣었는지 확인)."); }
})();

const token = await getAccessToken(SA);
let created = 0, updated = 0, deactivated = 0, skipped = 0;
const errors = [];

// 등록/수정: GET → 없으면 insert, 있으면 status 보존하여 update.
for (const item of upserts) {
  const sku = item.productId;
  if (!sku) { errors.push("productId 없는 upsert 항목"); continue; }
  const got = await apiFetch(token, ipUrl(sku), "GET");
  if (got.status === 404) {
    const body = buildProduct(item, null);
    const r = await apiFetch(token, ipUrl(null, "?autoConvertMissingPrices=true"), "POST", body);
    if (r.ok) { created++; log(`등록: ${sku} (${item.price}${CURRENCY}, status=${body.status})`); }
    else errors.push(`insert ${sku} 실패(HTTP ${r.status}): ${JSON.stringify(r.json)}`);
  } else if (got.ok) {
    const body = buildProduct(item, got.json);
    const r = await apiFetch(token, ipUrl(sku, "?autoConvertMissingPrices=true"), "PUT", body);
    if (r.ok) { updated++; log(`수정: ${sku} (${item.price}${CURRENCY}, status 유지=${body.status})`); }
    else errors.push(`update ${sku} 실패(HTTP ${r.status}): ${JSON.stringify(r.json)}`);
  } else {
    errors.push(`get ${sku} 실패(HTTP ${got.status}): ${JSON.stringify(got.json)}`);
  }
}

// 삭제된 유료 스킨: 하드삭제 대신 비활성화(구매 이력 보존).
for (const sku of deletes) {
  const got = await apiFetch(token, ipUrl(sku), "GET");
  if (got.status === 404) { skipped++; log(`비활성화 대상 없음(이미 삭제됨): ${sku}`); continue; }
  if (!got.ok) { errors.push(`get(삭제용) ${sku} 실패(HTTP ${got.status}): ${JSON.stringify(got.json)}`); continue; }
  if (got.json.status === "inactive") { skipped++; log(`이미 비활성: ${sku}`); continue; }
  const body = { ...got.json, status: "inactive" };
  const r = await apiFetch(token, ipUrl(sku), "PUT", body);
  if (r.ok) { deactivated++; log(`비활성화: ${sku}`); }
  else errors.push(`deactivate ${sku} 실패(HTTP ${r.status}): ${JSON.stringify(r.json)}`);
}

log(`완료: 등록 ${created}, 수정 ${updated}, 비활성화 ${deactivated}, 건너뜀 ${skipped}.`);

if (errors.length > 0) {
  for (const e of errors) console.error(`::error::[sync-play-products] ${e}`);
  fail(`${errors.length}건 실패. 위 오류를 확인하세요. ` +
    "권한 부족(403)이면 Play Console에서 서비스계정에 인앱상품 관리 권한을 부여해야 합니다.");
}
