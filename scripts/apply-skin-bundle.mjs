// _inbox/*.zip (스킨빌더 번들)을 풀어서 디자인레포에 배치하고 catalog.json을 병합한다.
//
// 번들 구조(스킨빌더 = 이 레포 최상위 index.html 출력):
//   character/zip/{skinId}.zip
//   character/preview/{skinId}/thumb.png, stop.png, motion_{state}.{gif,png}
//   catalog_entry.json   ← catalog.json "skins"에 upsert 할 항목
//
// 동작: 번들을 레포 레이아웃 그대로 펼치고(character/ 하위 zip·preview), catalog만 병합.
// unzip(ubuntu-latest 기본 제공) 외 외부 의존성 없음.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const INBOX = path.join(ROOT, "_inbox");
const CATALOG = path.join(ROOT, "catalog.json");
const WORK = path.join(ROOT, "_inbox_work");
// 유료 zip 스테이징/삭제 매니페스트(둘 다 .gitignore 대상 — 절대 공개 커밋 금지).
// 워크플로우의 R2 스텝이 이 둘을 읽어 업로드/삭제한 뒤 catalog를 커밋한다.
const R2_UPLOAD = path.join(ROOT, "_r2_upload");      // {skinId}.zip 들을 R2로 올림
const R2_DELETE = path.join(ROOT, "_r2_delete.txt");  // R2에서 지울 키({skinId}.zip) 한 줄씩
// Play 인앱상품 동기화 매니페스트(둘 다 .gitignore 대상 — 작업 산출물, 커밋하지 않음).
// 워크플로우의 Play 스텝이 이 둘을 읽어 인앱상품(SKU)을 upsert/비활성화한 뒤 catalog를 커밋한다.
const PLAY_UPSERT = path.join(ROOT, "_play_upsert.json"); // [{productId,skinId,name,price}] — 등록/수정할 유료 상품
const PLAY_DELETE = path.join(ROOT, "_play_delete.txt");  // 비활성화할 productId 한 줄씩(삭제된 유료 스킨)
const PLAY_DELETE_RESULTS = path.join(ROOT, "_play_delete_results.json");
const PENDING_PAID_DELETES = path.join(ROOT, "_pending_paid_deletes.json");
// 은퇴(삭제)한 skinId/productId 원장 — 이 파일은 '커밋'된다(.gitignore 대상 아님).
// 삭제할 때마다 자동 적립하고, 나중에 같은 skinId가 다시 올라오면 재사용을 감지해 경고한다.
const RETIRED = path.join(ROOT, "_retired_ids.json");

function log(msg) { console.log(`[apply-skin-bundle] ${msg}`); }

/** _inbox 마커 파일을 읽어 JSON 파싱. 실패하면 로그만 남기고 null(호출부는 건너뜀). */
function readJsonMarker(marker) {
  try {
    return JSON.parse(fs.readFileSync(path.join(INBOX, marker), "utf8"));
  } catch {
    log(`⚠ ${marker}: JSON 파싱 실패 — 건너뜀`);
    return null;
  }
}

/** YYYY-MM-DD (UTC) — 은퇴 기록 날짜. */
function today() { return new Date().toISOString().slice(0, 10); }

/** catalog 항목이 유료인지(price>0). */
function isPaidEntry(e) { return e && Number(e.price) > 0; }

/** 유료 catalog 항목의 Play 인앱상품 ID(SKU). 빌더는 productId를 넣지만, 누락 시 결정적으로 파생. */
function productIdOf(entry) {
  return entry.productId || `skin_${String(entry.skinId).toLowerCase()}`;
}

/** Play 동기화 매니페스트에 upsert 항목 누적(파일이 없으면 새로).
 *  isNew=true 는 이 skinId가 catalog에 '처음' 등장한다는 뜻 — sync 스크립트가 productId 재사용을 차단하는 데 쓴다. */
const playUpserts = [];
function queuePlayUpsert(entry, isNew) {
  playUpserts.push({
    productId: productIdOf(entry),
    skinId: entry.skinId,
    name: entry.name,
    ...(entry.localized ? { localized: entry.localized } : {}),
    price: Number(entry.price) || 0,
    isNew: !!isNew,
  });
}
/** Play 삭제(비활성화) 매니페스트에 productId 한 줄 추가. */
function queuePlayDelete(entry) {
  fs.appendFileSync(PLAY_DELETE, `${productIdOf(entry)}\n`);
}

if (!fs.existsSync(INBOX)) { log("_inbox 폴더 없음 — 처리할 것 없음."); process.exit(0); }

const inboxFiles = fs.readdirSync(INBOX);
const zips = inboxFiles.filter(f => f.toLowerCase().endsWith(".zip"));
const hasDeleteMarkers = inboxFiles.some(f => f.toLowerCase().endsWith(".delete.json"));
const passCodeMarkers = inboxFiles.filter(f => f.toLowerCase().endsWith(".lifetime-pass-codes.json"));
const skinCodeMarkers = inboxFiles.filter(f => f.toLowerCase().endsWith(".skin-gift-codes.json"));
if (zips.length === 0 && !hasDeleteMarkers && passCodeMarkers.length === 0 && skinCodeMarkers.length === 0) {
  log("_inbox에 처리할 zip·삭제마커·해금코드 마커 없음.");
  process.exit(0);
}

// catalog 로드 (없으면 생성)
let catalog;
try {
  catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
} catch {
  catalog = { skins: [] };
}
if (!Array.isArray(catalog.skins)) catalog.skins = [];
if (!Array.isArray(catalog.lifetimePassGiftCodes)) catalog.lifetimePassGiftCodes = [];

// 은퇴 원장 로드(없으면 새로). { retired: [{ skinId, productId?, retiredAt }] }
let retiredLedger;
try {
  retiredLedger = JSON.parse(fs.readFileSync(RETIRED, "utf8"));
} catch {
  retiredLedger = { retired: [] };
}
if (!Array.isArray(retiredLedger.retired)) retiredLedger.retired = [];
const retiredIndexOf = (skinId) => retiredLedger.retired.findIndex(r => r.skinId === skinId);

fs.rmSync(WORK, { recursive: true, force: true });
// R2 스테이징/매니페스트는 매 실행 새로 시작(이전 실행 잔여물이 섞이면 안 됨).
fs.rmSync(R2_UPLOAD, { recursive: true, force: true });
fs.rmSync(R2_DELETE, { force: true });
// Play 동기화 매니페스트도 매 실행 새로 시작.
fs.rmSync(PLAY_UPSERT, { force: true });
fs.rmSync(PLAY_DELETE, { force: true });
fs.rmSync(PLAY_DELETE_RESULTS, { force: true });
fs.rmSync(PENDING_PAID_DELETES, { force: true });
let applied = 0;

for (const zip of zips) {
  const zipPath = path.join(INBOX, zip);
  const tmp = path.join(WORK, zip.replace(/\.zip$/i, ""));
  fs.mkdirSync(tmp, { recursive: true });
  log(`풀기: _inbox/${zip}`);
  execFileSync("unzip", ["-o", "-q", zipPath, "-d", tmp], { stdio: "inherit" });

  // 1) catalog 항목 먼저 읽어 유료/무료를 판정한다(배치 방식이 갈리므로).
  const entryPath = path.join(tmp, "catalog_entry.json");
  if (!fs.existsSync(entryPath)) {
    throw new Error(`${zip}: catalog_entry.json 이 없습니다. 스킨빌더로 만든 번들인지 확인하세요.`);
  }
  const entry = JSON.parse(fs.readFileSync(entryPath, "utf8"));
  const skinId = String(entry.skinId || "").trim();
  if (!/^[A-Za-z0-9_]+$/.test(skinId)) {
    throw new Error(`${zip}: catalog_entry.json 의 skinId 형식이 올바르지 않습니다(영문/숫자/_).`);
  }
  entry.skinId = skinId;
  const paid = isPaidEntry(entry);
  if (paid && !entry.productId) {
    // 빌더가 유료엔 productId를 반드시 넣는다. 없으면 손상된 번들 → 멈춤(보호 깨짐 방지).
    throw new Error(`${zip}: 유료(price=${entry.price})인데 productId가 없습니다. 스킨빌더로 다시 만드세요.`);
  }

  // 2) preview는 무료/유료 공통으로 공개 배치(상점 썸네일·미리보기).
  const previewSrc = path.join(tmp, "character", "preview", skinId);
  if (fs.existsSync(previewSrc)) {
    const previewDst = path.join(ROOT, "character", "preview", skinId);
    // 새 번들을 디렉터리 단위로 교체해 제거된 motion/과거 prevNN 파일이 CDN에 남지 않게 한다.
    fs.rmSync(previewDst, { recursive: true, force: true });
    fs.cpSync(previewSrc, previewDst, { recursive: true });
    log(`  → character/preview/${skinId} 배치`);
  } else {
    log(`  ⚠ 번들에 character/preview/${skinId} 없음 (건너뜀)`);
  }

  // 3) 캐릭터 zip: 무료=공개(character/zip), 유료=_r2_upload 스테이징(공개 금지) + 기존 공개본 제거.
  const zipSrc = path.join(tmp, "character", "zip", `${skinId}.zip`);
  if (!fs.existsSync(zipSrc)) {
    throw new Error(`${zip}: 번들에 character/zip/${skinId}.zip 이 없습니다.`);
  }
  const publicZip = path.join(ROOT, "character", "zip", `${skinId}.zip`);
  if (paid) {
    fs.mkdirSync(R2_UPLOAD, { recursive: true });
    fs.copyFileSync(zipSrc, path.join(R2_UPLOAD, `${skinId}.zip`));
    // 무료였다가 유료로 바뀐 경우/테스트 잔여물: 공개 zip이 남아 있으면 보호가 깨지므로 삭제.
    if (fs.existsSync(publicZip)) {
      fs.rmSync(publicZip, { force: true });
      log(`  → (유료 전환) 공개 character/zip/${skinId}.zip 제거`);
    }
    log(`  → 유료: _r2_upload/${skinId}.zip 스테이징 (공개 커밋 안 함)`);
  } else {
    fs.mkdirSync(path.dirname(publicZip), { recursive: true });
    fs.copyFileSync(zipSrc, publicZip);
    log(`  → 무료: character/zip/${skinId}.zip 공개 배치`);
  }

  // 4) catalog 병합 (skinId 기준 upsert; 기존이면 version +1)
  const idx = catalog.skins.findIndex(s => s.skinId === entry.skinId);
  if (idx >= 0 && catalog.skins[idx].archived) {
    throw new Error(`${zip}: '${entry.skinId}'는 판매 이력 보존을 위해 보관된 ID입니다. 새 skinId/productId를 사용하세요.`);
  }

  // 방법1: 예전에 삭제(은퇴)했던 skinId가 다시 올라오는지 감지.
  //   skinId 재사용은 보안 누수는 아니지만, 옛 스킨을 보유했던 사용자 화면에 잘못 '보유'로 뜨는
  //   UX 잔상을 만들 수 있어 경고만 남긴다(배포는 계속). 되살아났으니 원장에서는 제거한다.
  const revivedIdx = retiredIndexOf(entry.skinId);
  if (revivedIdx >= 0) {
    const prev = retiredLedger.retired[revivedIdx];
    console.log(`::warning::[apply-skin-bundle] skinId '${entry.skinId}' 는 ${prev.retiredAt}에 삭제된 적이 있는 id의 재사용입니다. ` +
      `같은 스킨의 부활이면 OK. 다른 스킨이면 새 skinId 권장(옛 보유자에게 '보유 표시인데 다운로드 실패'가 남을 수 있음).`);
    retiredLedger.retired.splice(revivedIdx, 1);
  }

  if (idx >= 0) {
    const prevVer = Number(catalog.skins[idx].version) || 1;
    entry.version = prevVer + 1; // 재업로드 = 변경 → 버전 올림
    const previousGiftCodes = Array.isArray(catalog.skins[idx].giftCodes)
      ? catalog.skins[idx].giftCodes
      : [];
    if (!Array.isArray(entry.giftCodes) && previousGiftCodes.length > 0) {
      entry.giftCodes = previousGiftCodes;
    }
    if (!entry.localized && catalog.skins[idx].localized) {
      entry.localized = catalog.skins[idx].localized;
    }
    catalog.skins[idx] = entry;
    log(`  → catalog 갱신: ${entry.skinId} (version ${entry.version})`);
  } else {
    entry.version = Number(entry.version) || 1;
    catalog.skins.push(entry);
    log(`  → catalog 신규: ${entry.skinId} (version ${entry.version})`);
  }

  // 새 앱은 버전별 고정 경로를 사용해 jsDelivr @main 및 기기 이미지 캐시의 이전 내용을 피한다.
  // 기존 preview/zip 경로도 계속 배치하므로 이미 출시된 앱과 빌더 편집 기능은 그대로 동작한다.
  const versionedRoot = path.join(ROOT, "character", "versioned", skinId, `v${entry.version}`);
  if (fs.existsSync(previewSrc)) {
    fs.cpSync(previewSrc, path.join(versionedRoot, "preview"), { recursive: true });
    log(`  → 버전 미리보기: character/versioned/${skinId}/v${entry.version}/preview`);
  }
  if (!paid) {
    fs.mkdirSync(versionedRoot, { recursive: true });
    fs.copyFileSync(zipSrc, path.join(versionedRoot, "skin.zip"));
    log(`  → 버전 무료 zip: character/versioned/${skinId}/v${entry.version}/skin.zip`);
  }
  entry.assetVersion = entry.version;

  // 5) 유료면 Play 인앱상품 동기화 큐에 올린다(SKU 등록/가격·이름 수정).
  //    idx<0 = catalog에 처음 등장하는 skinId → isNew. sync가 productId 재사용을 막는 데 쓴다.
  if (paid) {
    queuePlayUpsert(entry, idx < 0);
    log(`  → Play 동기화 예약: ${productIdOf(entry)} (${entry.price}원)`);
    // 현재 키와 별도로 버전 키도 보존해 잘못된 업데이트를 이전 버전으로 되돌릴 수 있게 한다.
    const versionedZip = path.join(R2_UPLOAD, "versions", skinId, `v${entry.version}.zip`);
    fs.mkdirSync(path.dirname(versionedZip), { recursive: true });
    fs.copyFileSync(zipSrc, versionedZip);
    log(`  → R2 버전 보관 예약: versions/${skinId}/v${entry.version}.zip`);
  }

  // 6) 처리한 inbox zip 제거
  fs.rmSync(zipPath, { force: true });
  applied++;
}

// 삭제 마커 처리. 유료 상품은 Play 판매 이력을 확인하기 전에는 catalog/R2/preview를 건드리지 않는다.
let deleted = 0;
const pendingPaidDeletes = [];
const markers = fs.readdirSync(INBOX).filter(f => f.toLowerCase().endsWith(".delete.json"));
for (const marker of markers) {
  const markerData = readJsonMarker(marker);
  if (!markerData) continue;
  const skinId = String(markerData.deleteSkinId || "").trim();
  if (!skinId || !/^[A-Za-z0-9_]+$/.test(skinId)) {
    log(`⚠ ${marker}: deleteSkinId 누락/형식오류 — 건너뜀`);
    continue;
  }
  // 유료였던 스킨은 zip이 공개 레포가 아니라 R2에 있다 → R2 삭제 큐에 올린다(공개본 제거는 무해한 no-op).
  const existing = catalog.skins.find(s => s.skinId === skinId);
  const markerProductId = String(markerData.productId || "").trim();
  const validMarkerProductId = markerProductId && /^[A-Za-z0-9_.]+$/.test(markerProductId);
  if (markerProductId && !validMarkerProductId) {
    log(`  ! ${marker}: invalid productId; skip marker-based Play deactivation (${markerProductId})`);
  }
  const markerPaid = Number(markerData.price) > 0 || !!validMarkerProductId;
  const deleteEntry = existing || (markerPaid ? {
    skinId,
    name: String(markerData.name || skinId),
    productId: validMarkerProductId ? markerProductId : `skin_${skinId.toLowerCase()}`,
    price: Number(markerData.price) || 1,
  } : null);
  if (isPaidEntry(existing) || markerPaid) {
    queuePlayDelete(deleteEntry);
    pendingPaidDeletes.push({
      skinId,
      marker,
      productId: productIdOf(deleteEntry),
      catalogEntry: existing || deleteEntry,
    });
    log(`  → (유료) Play 이력 판정 대기: ${skinId} (catalog/R2 보존)`);
    continue;
  }
  fs.rmSync(path.join(ROOT, "character", "zip", `${skinId}.zip`), { force: true });
  fs.rmSync(path.join(ROOT, "character", "preview", skinId), { recursive: true, force: true });
  fs.rmSync(path.join(ROOT, "character", "versioned", skinId), { recursive: true, force: true });
  const before = catalog.skins.length;
  catalog.skins = catalog.skins.filter(s => s.skinId !== skinId);
  log(`  → 삭제: ${skinId} (character/zip·preview 제거, catalog ${before}→${catalog.skins.length})`);

  // 방법1: 은퇴 원장에 기록(중복 skinId면 최신 날짜로 갱신). free/paid 모두 기록해 skinId 재사용을 감지.
  const retiredProductId = (existing && existing.productId) || (deleteEntry && deleteEntry.productId) || null;
  const record = { skinId, ...(retiredProductId ? { productId: retiredProductId } : {}), retiredAt: today() };
  const rIdx = retiredIndexOf(skinId);
  if (rIdx >= 0) retiredLedger.retired[rIdx] = record; else retiredLedger.retired.push(record);

  fs.rmSync(path.join(INBOX, marker), { force: true });
  deleted++;
}

// 평생이용권 코드 마커(_inbox/*.lifetime-pass-codes.json) 처리: catalog 최상위 lifetimePassGiftCodes에 병합.
let passCodesApplied = 0;
for (const marker of passCodeMarkers) {
  const markerData = readJsonMarker(marker);
  if (!markerData) continue;
  const codes = Array.isArray(markerData.lifetimePassGiftCodes)
    ? markerData.lifetimePassGiftCodes
    : [];
  for (const code of codes) {
    const hash = String(code.hash || "").trim().toLowerCase();
    const expiresAt = String(code.expiresAt || "").trim();
    const maxUses = Math.max(0, Number(code.maxUses) || 0);
    if (!/^[a-f0-9]{64}$/.test(hash) || (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt))) {
      log(`  ! ${marker}: 평생이용권 코드 형식 오류 — 건너뜀`);
      continue;
    }
    if (maxUses !== 0 && maxUses !== 1) {
      log(`  ! ${marker}: 평생이용권 maxUses는 1 또는 생략만 허용 — 건너뜀`);
      continue;
    }
    const next = { hash, maxUses, ...(expiresAt ? { expiresAt } : {}) };
    const idx = catalog.lifetimePassGiftCodes.findIndex(c => c.hash === hash);
    if (idx >= 0) catalog.lifetimePassGiftCodes[idx] = next;
    else catalog.lifetimePassGiftCodes.push(next);
    passCodesApplied++;
  }
  fs.rmSync(path.join(INBOX, marker), { force: true });
}
if (passCodesApplied > 0) {
  catalog.lifetimePassGiftCodes.sort((a, b) =>
    String(a.expiresAt || "").localeCompare(String(b.expiresAt || "")) ||
    String(a.hash || "").localeCompare(String(b.hash || ""))
  );
  log(`  → 평생이용권 코드 ${passCodesApplied}개 병합`);
}

// 개별 테마 코드 마커(_inbox/*.skin-gift-codes.json) 처리: catalog.skins[].giftCodes에 병합.
let skinCodesApplied = 0;
for (const marker of skinCodeMarkers) {
  const markerData = readJsonMarker(marker);
  if (!markerData) continue;
  const codes = Array.isArray(markerData.skinGiftCodes)
    ? markerData.skinGiftCodes
    : [];
  for (const code of codes) {
    const skinId = String(code.skinId || "").trim();
    const hash = String(code.hash || "").trim().toLowerCase();
    const expiresAt = String(code.expiresAt || "").trim();
    const maxUses = Math.max(0, Number(code.maxUses) || 0);
    if (!/^[A-Za-z0-9_]+$/.test(skinId) || !/^[a-f0-9]{64}$/.test(hash)) {
      log(`  ! ${marker}: 개별 테마 코드 형식 오류 — 건너뜀`);
      continue;
    }
    if (expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
      log(`  ! ${marker}: 개별 테마 expiresAt 형식 오류 — 건너뜀`);
      continue;
    }
    if (maxUses !== 0 && maxUses !== 1) {
      log(`  ! ${marker}: 개별 테마 maxUses는 0 또는 1만 허용 — 건너뜀`);
      continue;
    }
    const entry = catalog.skins.find(s => s.skinId === skinId);
    if (!entry) {
      log(`  ! ${marker}: catalog에 skinId=${skinId} 없음 — 건너뜀`);
      continue;
    }
    const giftCodes = Array.isArray(entry.giftCodes) ? entry.giftCodes : [];
    const next = { hash, maxUses, ...(expiresAt ? { expiresAt } : {}) };
    const codeIdx = giftCodes.findIndex(c => c && c.hash === hash);
    if (codeIdx >= 0) giftCodes[codeIdx] = next; else giftCodes.push(next);
    entry.giftCodes = giftCodes.sort((a, b) => String(a.hash || "").localeCompare(String(b.hash || "")));
    skinCodesApplied++;
  }
  fs.rmSync(path.join(INBOX, marker), { force: true });
}
if (skinCodesApplied > 0) {
  log(`  → 개별 테마 코드 ${skinCodesApplied}개 병합`);
}

// catalog 저장 (2-space, 트레일링 개행)
fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n");

// 은퇴 원장 저장(커밋 대상). skinId 정렬로 diff 안정화. 항상 기록 → 첫 실행 때 파일 생성.
retiredLedger.retired.sort((a, b) => String(a.skinId).localeCompare(String(b.skinId)));
fs.writeFileSync(RETIRED, JSON.stringify(retiredLedger, null, 2) + "\n");

// Play upsert 매니페스트 기록(있을 때만 — 없으면 Play 스텝이 통째로 건너뜀).
if (playUpserts.length > 0) {
  fs.writeFileSync(PLAY_UPSERT, JSON.stringify(playUpserts, null, 2) + "\n");
  log(`Play upsert 매니페스트: ${playUpserts.length}개 → _play_upsert.json`);
}
if (pendingPaidDeletes.length > 0) {
  fs.writeFileSync(PENDING_PAID_DELETES, JSON.stringify(pendingPaidDeletes, null, 2) + "\n");
  log(`유료 삭제 대기 매니페스트: ${pendingPaidDeletes.length}개`);
}

fs.rmSync(WORK, { recursive: true, force: true });
log(`완료: ${applied}개 번들 적용, ${deleted}개 즉시 삭제, ${pendingPaidDeletes.length}개 Play 판정 대기, 평생이용권 코드 ${passCodesApplied}개, 개별 테마 코드 ${skinCodesApplied}개, catalog.json 갱신.`);
