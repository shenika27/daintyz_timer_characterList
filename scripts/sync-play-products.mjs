// _play_upsert.json / _play_delete.txt (apply-skin-bundle.mjs 산출물)을 읽어
// Google Play 인앱상품(SKU)을 자동 등록/수정/비활성화한다.
//
// ★ 2024+ 신 모델: 레거시 `inappproducts` API 는 이 앱에서 403
//   "Please migrate to the new publishing API" 로 거부된다. 그래서 이 스크립트는
//   **`monetization.onetimeproducts`**(신 퍼블리싱 API)를 쓴다.
//   - upsert:   POST oneTimeProducts:batchUpdate (allowMissing=true → 없으면 생성)
//   - 존재확인: GET  oneTimeProducts/{productId} (404=미존재)
//   - 가격환산: POST pricing:convertRegionPrices (옛 autoConvertMissingPrices 재현)
//   - 상태변경: POST oneTimeProducts/{id}/purchaseOptions:batchUpdateStates (활성/비활성)
//
// 앱 클라이언트는 Play Billing Library 9의 queryProductDetails(INAPP)를 사용한다.
//   buyOption.legacyCompatible=true도 유지하며, 앱은 조회된 1회성 오퍼의 offerToken을 구매 요청에 전달한다.
//
// 흐름(워크플로우): 번들 배치 → catalog 병합 → R2 업로드 → [이 스크립트] → catalog 커밋.
//   유료 스킨이 새로 올라오면 Play Console에 SKU(skin_{skinid})를 만들어 둬야
//   앱 상점의 구매 버튼이 실제 상품을 가리킨다 → 그래서 커밋 '전에' 동기화한다.
//
// 설계 결정:
//   - 신규 상품의 구매옵션은 생성 직후 **DRAFT**(=한 번도 노출된 적 없음)로 만들어진다.
//     이는 옛 모델의 status=inactive 보다 안전하다(가격 오타가 곧바로 실판매로 이어지지 않음).
//     PLAY_PRODUCT_STATUS=active 로 실행하거나 Play Console에서 활성화하면 판매가 시작된다.
//   - 이미 존재하는 상품은 구매옵션 state 를 건드리지 않는다(활성 상품을 되돌리지 않음).
//     → 가격/이름(리스팅)만 갱신. state 는 서버 관리(Output only)라 patch 로 바뀌지 않는다.
//   - 삭제된 유료 스킨은 하드 삭제 대신 구매옵션을 INACTIVE 로 내린다(구매 이력 보존).
//
// 인증: 결제 Worker와 동일한 서비스계정 JWT → OAuth2(androidpublisher 스코프).
//   Node 20 전역 Web Crypto/atob/btoa 사용 → 외부 의존성 0.
//
// 환경변수:
//   GOOGLE_SERVICE_ACCOUNT_JSON  (secret) GCP 서비스계정 JSON 전체. 없으면:
//        - 처리할 유료 변경이 있으면 명확히 실패(커밋 차단 → 깨진 상태 방지)
//        - 유료 변경이 없으면 조용히 통과(무료 전용 파이프라인은 토큰 없이도 동작)
//   ANDROID_PACKAGE_NAME         앱 패키지명(예: com.daintyz.timerwidget)
//   PLAY_PRODUCT_STATUS          신규 구매옵션 초기 상태("inactive" 기본=DRAFT 유지 | "active"=자동 활성)
//   PLAY_PRICE_CURRENCY          기준 통화(기본 "KRW")
//   ALLOW_PRODUCT_ID_REUSE       "1"이면 productId 재사용 차단(방법3)을 강행 해제

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PLAY_UPSERT = path.join(ROOT, "_play_upsert.json");
const PLAY_DELETE = path.join(ROOT, "_play_delete.txt");
const PLAY_DELETE_RESULTS = path.join(ROOT, "_play_delete_results.json");

const PKG = process.env.ANDROID_PACKAGE_NAME || "";
const NEW_STATUS = (process.env.PLAY_PRODUCT_STATUS || "inactive").toLowerCase() === "active"
  ? "active" : "inactive";
const CURRENCY = process.env.PLAY_PRICE_CURRENCY || "KRW";
// 방법3: 신규 스킨이 '이미 존재하는' productId를 재사용하면 기본 차단(과거 구매 이력 누수 방지).
// 정당한 재시도(예: 상품은 만들어졌는데 catalog 커밋이 실패한 경우) 등에서만 =1로 강행 허용.
const ALLOW_REUSE = String(process.env.ALLOW_PRODUCT_ID_REUSE || "").trim() === "1";

// 구매옵션 ID(신 모델 필수, 상품 내 유일·immutable). 이 스크립트가 만든 상품은 항상 이 값 하나.
// 기존 상품 갱신 시엔 서버가 준 실제 purchaseOptionId를 우선 사용한다(콘솔서 만든 경우 대비).
const DEFAULT_PURCHASE_OPTION_ID = "buy";
// regionsVersion 폴백. 보통은 convertRegionPrices 응답의 regionVersion을 그대로 쓴다(하드코딩 안 함).
// 참조: https://support.google.com/googleplay/android-developer/answer/10532353
const REGIONS_VERSION_FALLBACK = { version: "2022/02" };

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

// ── androidpublisher monetization.onetimeproducts ───────────────────────────
const APP = `${API}/applications/${encodeURIComponent(PKG)}`;
// 경로 케이싱은 discovery 문서 기준(주의: get/batch 계열은 camelCase `oneTimeProducts`).
const otpUrl = (productId) => `${APP}/oneTimeProducts/${encodeURIComponent(productId)}`;
const otpBatchUpdateUrl = () => `${APP}/oneTimeProducts:batchUpdate`;
const optStatesUrl = (productId) => `${APP}/oneTimeProducts/${encodeURIComponent(productId)}/purchaseOptions:batchUpdateStates`;
const convertPricesUrl = () => `${APP}/pricing:convertRegionPrices`;

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

/** 소수 통화금액 → Money(units 문자열, nanos). KRW 700 → {KRW,"700",0}. */
function money(amount, currencyCode) {
  const n = Number(amount) || 0;
  const units = Math.trunc(n);
  const nanos = Math.round((n - units) * 1e9);
  return { currencyCode, units: String(units), nanos };
}

/** 기준가(tax exclusive)를 전지역 가격으로 환산한다(옛 autoConvertMissingPrices 대체).
 *  반환: { configs:[{regionCode,price,availability}], newRegionsConfig, regionsVersion } */
async function convertRegionPrices(token, price) {
  const r = await apiFetch(token, convertPricesUrl(), "POST", { price: money(price, CURRENCY) });
  if (!r.ok) throw new Error(`convertRegionPrices 실패(HTTP ${r.status}): ${JSON.stringify(r.json)}`);
  const map = r.json.convertedRegionPrices || {};
  const configs = Object.values(map).map((c) => ({
    regionCode: c.regionCode,
    price: c.price,               // 환산가(tax inclusive) — 신 모델 config 가격으로 그대로 사용
    availability: "AVAILABLE",
  }));
  const other = r.json.convertedOtherRegionsPrice || {};
  const newRegionsConfig = (other.usdPrice && other.eurPrice)
    ? { usdPrice: other.usdPrice, eurPrice: other.eurPrice, availability: "AVAILABLE" }
    : undefined;
  const regionsVersion = r.json.regionVersion || REGIONS_VERSION_FALLBACK;
  return { configs, newRegionsConfig, regionsVersion };
}

/** OneTimeProduct 리소스 본문. 구매옵션 하나(legacyCompatible)로 앱이 조회·구매 가능하게 만든다.
 *  state 는 Output-only 라 여기서 설정하지 않는다(활성/비활성은 별도 batchUpdateStates). */
function buildProduct(item, pricing, purchaseOptionId) {
  const title = String(item.name || item.skinId).slice(0, 55);
  const enTitle = String(item.localized?.en?.name || "").trim().slice(0, 55);
  const listings = [{ languageCode: "ko-KR", title, description: title }];
  if (enTitle) listings.push({ languageCode: "en-US", title: enTitle, description: enTitle });
  const purchaseOption = {
    purchaseOptionId,
    buyOption: { legacyCompatible: true }, // ← PBL7 레거시 조회 호환(필수)
    regionalPricingAndAvailabilityConfigs: pricing.configs,
  };
  if (pricing.newRegionsConfig) purchaseOption.newRegionsConfig = pricing.newRegionsConfig;
  return {
    packageName: PKG,
    productId: item.productId,
    listings,
    purchaseOptions: [purchaseOption],
  };
}

/** 상품 하나를 upsert(없으면 생성). 반환: 서버가 준 OneTimeProduct. */
async function upsertProduct(token, product, regionsVersion) {
  const body = {
    requests: [{
      oneTimeProduct: product,
      updateMask: "listings,purchaseOptions",
      allowMissing: true, // 없으면 생성(create 시 updateMask 는 무시됨)
      regionsVersion,
    }],
  };
  const r = await apiFetch(token, otpBatchUpdateUrl(), "POST", body);
  if (!r.ok) throw new Error(`batchUpdate 실패(HTTP ${r.status}): ${JSON.stringify(r.json)}`);
  return (r.json.oneTimeProducts || [])[0];
}

/** 구매옵션 상태 변경(activate/deactivate). action="activate"|"deactivate". */
async function setPurchaseOptionState(token, productId, purchaseOptionId, action) {
  const key = action === "activate" ? "activatePurchaseOptionRequest" : "deactivatePurchaseOptionRequest";
  const body = { requests: [{ [key]: { packageName: PKG, productId, purchaseOptionId } }] };
  const r = await apiFetch(token, optStatesUrl(productId), "POST", body);
  if (!r.ok) throw new Error(`purchaseOptions:batchUpdateStates(${action}) 실패(HTTP ${r.status}): ${JSON.stringify(r.json)}`);
  return r.json;
}

/** 상품 하드삭제(되돌릴 수 없음). '한 번도 판매된 적 없는' 상품에만 쓴다(호출부에서 판정). */
async function deleteProduct(token, productId) {
  const r = await apiFetch(token, otpUrl(productId), "DELETE");
  // 이미 없으면(404) 성공으로 본다(idempotent).
  if (!r.ok && r.status !== 404) throw new Error(`delete ${productId} 실패(HTTP ${r.status}): ${JSON.stringify(r.json)}`);
}

/** 기존 상품에서 첫 구매옵션 id를 얻는다(없으면 기본값). */
function existingPurchaseOptionId(existing) {
  const opts = existing?.purchaseOptions;
  return (Array.isArray(opts) && opts[0]?.purchaseOptionId) || DEFAULT_PURCHASE_OPTION_ID;
}

const SA = (() => {
  try { return JSON.parse(saRaw); }
  catch { fail("GOOGLE_SERVICE_ACCOUNT_JSON 파싱 실패(JSON 전체를 넣었는지 확인)."); }
})();

const token = await getAccessToken(SA);
let created = 0, updated = 0, deactivated = 0, hardDeleted = 0, skipped = 0;
const errors = [];
const deleteResults = [];

// 등록/수정: GET → 없으면 생성(구매옵션 DRAFT), 있으면 리스팅·가격만 갱신(state 보존).
for (const item of upserts) {
  const productId = item.productId;
  if (!productId) { errors.push("productId 없는 upsert 항목"); continue; }
  try {
    const got = await apiFetch(token, otpUrl(productId), "GET");
    const exists = got.ok;
    if (!exists && got.status !== 404) {
      errors.push(`get ${productId} 실패(HTTP ${got.status}): ${JSON.stringify(got.json)}`);
      continue;
    }

    // 방법3: 새 스킨(catalog에 처음 등장)이 이미 존재하는 productId를 재사용하려는 경우 차단.
    //   기존 상품엔 과거 구매 이력이 남아 있어, 그대로 갱신하면 옛 구매자가 새 스킨을 무료로 언락한다.
    //   같은 스킨의 수정/재업로드는 isNew=false 라 여기 안 걸린다(정상 수정 경로로 진행).
    //   단, 'DRAFT 전용' 상품은 예외 — 한 번도 활성/판매된 적이 없어 구매자가 0이라 누수 위험이 없다.
    //   이는 보통 '상품은 batchUpdate로 생성됐는데 같은 런이 뒤에서 실패해 catalog 커밋만 안 된'
    //   우리 파이프라인 잔여물이다. 이걸 막으면 재실행마다 같은 지점에서 죽는 영구 데드락이 되므로,
    //   판매 이력 가능성이 있는(=DRAFT 아닌 구매옵션이 하나라도 있는) 상품만 차단한다.
    const everLive = Array.isArray(got.json.purchaseOptions)
      && got.json.purchaseOptions.some(o => o.state && o.state !== "DRAFT" && o.state !== "STATE_UNSPECIFIED");
    if (exists && item.isNew && !ALLOW_REUSE && everLive) {
      errors.push(`productId 재사용 차단: '${productId}' 는 이미 Play에 활성/판매 이력이 있는 상품입니다(옛 구매자 누수 위험). ` +
        `새 스킨 '${item.skinId}' 에는 새 productId를 쓰세요. ` +
        `정당한 재시도로 강행하려면 워크플로 env ALLOW_PRODUCT_ID_REUSE=1 로 실행하세요.`);
      continue;
    }

    const pricing = await convertRegionPrices(token, item.price);
    const purchaseOptionId = exists ? existingPurchaseOptionId(got.json) : DEFAULT_PURCHASE_OPTION_ID;
    const product = buildProduct(item, pricing, purchaseOptionId);
    await upsertProduct(token, product, pricing.regionsVersion);

    if (!exists) {
      // 신규: 구매옵션은 DRAFT 로 생성됨. 기본은 그대로 두고(수동 활성),
      //       PLAY_PRODUCT_STATUS=active 면 즉시 활성화한다.
      if (NEW_STATUS === "active") {
        await setPurchaseOptionState(token, productId, purchaseOptionId, "activate");
        log(`등록+활성: ${productId} (${item.price}${CURRENCY})`);
      } else {
        log(`등록(DRAFT): ${productId} (${item.price}${CURRENCY}) — 활성화는 콘솔/PLAY_PRODUCT_STATUS=active`);
      }
      created++;
    } else {
      // 기존: state 는 건드리지 않음(활성 상품 유지). 가격·리스팅만 갱신됨.
      updated++;
      log(`수정: ${productId} (${item.price}${CURRENCY}, state 보존)`);
    }
  } catch (e) {
    errors.push(String(e.message || e));
  }
}

// 삭제된 유료 스킨 처리 — 판매 이력 유무로 분기:
//   · '한 번도 판매/노출 안 됨'(구매옵션 전부 DRAFT) → 하드삭제(구매자 0이라 안전, Play도 깨끗이 정리)
//   · '활성/판매 이력 있음'(DRAFT 아닌 옵션 존재)     → 소프트 비활성화만(구매 이력 보존, 하드삭제 금지)
for (const productId of deletes) {
  try {
    const got = await apiFetch(token, otpUrl(productId), "GET");
    if (got.status === 404) {
      skipped++;
      deleteResults.push({ productId, outcome: "hard_deleted" });
      log(`삭제 대상 없음(이미 삭제됨): ${productId}`);
      continue;
    }
    if (!got.ok) { errors.push(`get(삭제용) ${productId} 실패(HTTP ${got.status}): ${JSON.stringify(got.json)}`); continue; }
    const opts = Array.isArray(got.json.purchaseOptions) ? got.json.purchaseOptions : [];
    const everLive = opts.some(o => o.state && o.state !== "DRAFT" && o.state !== "STATE_UNSPECIFIED");

    if (!everLive) {
      // 전부 DRAFT = 한 번도 판매/노출된 적 없음 → 하드삭제(되돌릴 수 없지만 누수 0).
      await deleteProduct(token, productId);
      hardDeleted++;
      deleteResults.push({ productId, outcome: "hard_deleted" });
      log(`하드삭제(미판매): ${productId}`);
      continue;
    }

    // 판매 이력 가능 → 이력 보존을 위해 하드삭제하지 않고 ACTIVE 옵션만 INACTIVE 로 내린다.
    // (DRAFT→INACTIVE 는 Play가 "Invalid transition" 400 을 내므로 ACTIVE 만 대상으로 한다.)
    const active = opts.filter(o => o.state === "ACTIVE");
    if (active.length === 0) {
      skipped++;
      deleteResults.push({ productId, outcome: "archived" });
      log(`비활성화 불필요(이력 보존): ${productId} (활성 구매옵션 없음 — 이미 비활성)`);
      continue;
    }
    for (const o of active) {
      await setPurchaseOptionState(token, productId, o.purchaseOptionId, "deactivate");
    }
    deactivated++;
    deleteResults.push({ productId, outcome: "archived" });
    log(`비활성화(이력 보존): ${productId} (구매옵션 ${active.length}개)`);
  } catch (e) {
    errors.push(String(e.message || e));
  }
}

log(`완료: 등록 ${created}, 수정 ${updated}, 비활성화 ${deactivated}, 하드삭제 ${hardDeleted}, 건너뜀 ${skipped}.`);

if (errors.length > 0) {
  for (const e of errors) console.error(`::error::[sync-play-products] ${e}`);
  fail(`${errors.length}건 실패. 위 오류를 확인하세요. ` +
    "권한 부족(403)이면 Play Console에서 서비스계정에 인앱상품 관리 권한을 부여해야 합니다.");
}

if (deleteResults.length > 0) {
  fs.writeFileSync(PLAY_DELETE_RESULTS, JSON.stringify(deleteResults, null, 2) + "\n");
}
