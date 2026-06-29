// _inbox/*.zip (스킨빌더 번들)을 풀어서 디자인레포에 배치하고 catalog.json을 병합한다.
//
// 번들 구조(스킨빌더 = 이 레포 최상위 index.html 출력):
//   character/zip/{skinId}.zip
//   character/preview/{skinId}/thumb.png, prev01.png …
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

function log(msg) { console.log(`[apply-skin-bundle] ${msg}`); }

/** catalog 항목이 유료인지(price>0). */
function isPaidEntry(e) { return e && Number(e.price) > 0; }

/** R2 삭제 매니페스트에 키를 한 줄 추가(중복 무방, 워크플로우가 || true로 관대 처리). */
function queueR2Delete(skinId) {
  fs.appendFileSync(R2_DELETE, `${skinId}.zip\n`);
}

/** 유료 catalog 항목의 Play 인앱상품 ID(SKU). 빌더는 productId를 넣지만, 누락 시 결정적으로 파생. */
function productIdOf(entry) {
  return entry.productId || `skin_${String(entry.skinId).toLowerCase()}`;
}

/** Play 동기화 매니페스트에 upsert 항목 누적(파일이 없으면 새로). */
const playUpserts = [];
function queuePlayUpsert(entry) {
  playUpserts.push({
    productId: productIdOf(entry),
    skinId: entry.skinId,
    name: entry.name,
    price: Number(entry.price) || 0,
  });
}
/** Play 삭제(비활성화) 매니페스트에 productId 한 줄 추가. */
function queuePlayDelete(entry) {
  fs.appendFileSync(PLAY_DELETE, `${productIdOf(entry)}\n`);
}

if (!fs.existsSync(INBOX)) { log("_inbox 폴더 없음 — 처리할 것 없음."); process.exit(0); }

const inboxFiles = fs.readdirSync(INBOX);
const zips = inboxFiles.filter(f => f.toLowerCase().endsWith(".zip"));
const hasMarkers = inboxFiles.some(f => f.toLowerCase().endsWith(".delete.json"));
if (zips.length === 0 && !hasMarkers) { log("_inbox에 처리할 zip·삭제마커 없음."); process.exit(0); }

// catalog 로드 (없으면 생성)
let catalog;
try {
  catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
} catch {
  catalog = { skins: [] };
}
if (!Array.isArray(catalog.skins)) catalog.skins = [];

fs.rmSync(WORK, { recursive: true, force: true });
// R2 스테이징/매니페스트는 매 실행 새로 시작(이전 실행 잔여물이 섞이면 안 됨).
fs.rmSync(R2_UPLOAD, { recursive: true, force: true });
fs.rmSync(R2_DELETE, { force: true });
// Play 동기화 매니페스트도 매 실행 새로 시작.
fs.rmSync(PLAY_UPSERT, { force: true });
fs.rmSync(PLAY_DELETE, { force: true });
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
  if (!entry.skinId) throw new Error(`${zip}: catalog_entry.json 에 skinId가 없습니다.`);
  const skinId = entry.skinId;
  const paid = isPaidEntry(entry);
  if (paid && !entry.productId) {
    // 빌더가 유료엔 productId를 반드시 넣는다. 없으면 손상된 번들 → 멈춤(보호 깨짐 방지).
    throw new Error(`${zip}: 유료(price=${entry.price})인데 productId가 없습니다. 스킨빌더로 다시 만드세요.`);
  }

  // 2) preview는 무료/유료 공통으로 공개 배치(상점 썸네일·미리보기).
  const previewSrc = path.join(tmp, "character", "preview", skinId);
  if (fs.existsSync(previewSrc)) {
    const previewDst = path.join(ROOT, "character", "preview", skinId);
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
  if (idx >= 0) {
    const prevVer = Number(catalog.skins[idx].version) || 1;
    entry.version = prevVer + 1; // 재업로드 = 변경 → 버전 올림
    catalog.skins[idx] = entry;
    log(`  → catalog 갱신: ${entry.skinId} (version ${entry.version})`);
  } else {
    entry.version = Number(entry.version) || 1;
    catalog.skins.push(entry);
    log(`  → catalog 신규: ${entry.skinId} (version ${entry.version})`);
  }

  // 5) 유료면 Play 인앱상품 동기화 큐에 올린다(SKU 등록/가격·이름 수정).
  if (paid) {
    queuePlayUpsert(entry);
    log(`  → Play 동기화 예약: ${productIdOf(entry)} (${entry.price}원)`);
  }

  // 6) 처리한 inbox zip 제거
  fs.rmSync(zipPath, { force: true });
  applied++;
}

// 삭제 마커(_inbox/{skinId}.delete.json) 처리: character/zip·character/preview·catalog에서 전체 제거.
let deleted = 0;
const markers = fs.readdirSync(INBOX).filter(f => f.toLowerCase().endsWith(".delete.json"));
for (const marker of markers) {
  const markerPath = path.join(INBOX, marker);
  let markerData;
  let skinId;
  try {
    markerData = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    skinId = String(markerData.deleteSkinId || "").trim();
  } catch {
    log(`⚠ ${marker}: JSON 파싱 실패 — 건너뜀`);
    continue;
  }
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
    productId: validMarkerProductId ? markerProductId : `skin_${skinId.toLowerCase()}`,
    price: Number(markerData.price) || 1,
  } : null);
  if (isPaidEntry(existing) || markerPaid) {
    queueR2Delete(skinId);
    queuePlayDelete(deleteEntry);
    log(`  → (유료) R2 삭제 + Play 비활성화 예약: ${skinId}`);
  }
  fs.rmSync(path.join(ROOT, "character", "zip", `${skinId}.zip`), { force: true });
  fs.rmSync(path.join(ROOT, "character", "preview", skinId), { recursive: true, force: true });
  const before = catalog.skins.length;
  catalog.skins = catalog.skins.filter(s => s.skinId !== skinId);
  log(`  → 삭제: ${skinId} (character/zip·preview 제거, catalog ${before}→${catalog.skins.length})`);
  fs.rmSync(markerPath, { force: true });
  deleted++;
}

// catalog 저장 (2-space, 트레일링 개행)
fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n");

// Play upsert 매니페스트 기록(있을 때만 — 없으면 Play 스텝이 통째로 건너뜀).
if (playUpserts.length > 0) {
  fs.writeFileSync(PLAY_UPSERT, JSON.stringify(playUpserts, null, 2) + "\n");
  log(`Play upsert 매니페스트: ${playUpserts.length}개 → _play_upsert.json`);
}

fs.rmSync(WORK, { recursive: true, force: true });
log(`완료: ${applied}개 번들 적용, ${deleted}개 삭제, catalog.json 갱신.`);
