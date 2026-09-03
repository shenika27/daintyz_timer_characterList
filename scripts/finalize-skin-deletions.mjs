// apply-skin-bundle가 보류한 유료 삭제를 Play 판매 이력 판정 결과에 따라 확정한다.
// DRAFT/미존재 상품만 완전 삭제하고, 판매 이력이 있는 상품은 기존 구매자의 재다운로드를 위해
// catalog 최소 메타데이터·preview·R2 원본을 보존한 채 archived+hidden 처리한다.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const INBOX = path.join(ROOT, "_inbox");
const CATALOG = path.join(ROOT, "catalog.json");
const RETIRED = path.join(ROOT, "_retired_ids.json");
const PENDING = path.join(ROOT, "_pending_paid_deletes.json");
const RESULTS = path.join(ROOT, "_play_delete_results.json");
const R2_DELETE = path.join(ROOT, "_r2_delete.txt");

function log(message) { console.log(`[finalize-skin-deletions] ${message}`); }
function today() { return new Date().toISOString().slice(0, 10); }

if (!fs.existsSync(PENDING)) {
  log("확정할 유료 삭제 없음.");
  process.exit(0);
}
if (!fs.existsSync(RESULTS)) throw new Error("Play 삭제 판정 결과가 없습니다.");

const pending = JSON.parse(fs.readFileSync(PENDING, "utf8"));
const results = JSON.parse(fs.readFileSync(RESULTS, "utf8"));
const resultByProductId = new Map(results.map((item) => [item.productId, item.outcome]));
const catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
if (!Array.isArray(catalog.skins)) catalog.skins = [];
let ledger = { retired: [] };
try { ledger = JSON.parse(fs.readFileSync(RETIRED, "utf8")); } catch {}
if (!Array.isArray(ledger.retired)) ledger.retired = [];

for (const item of pending) {
  const outcome = resultByProductId.get(item.productId);
  if (!outcome) throw new Error(`${item.productId}의 Play 삭제 판정 결과가 없습니다.`);
  const existingIndex = catalog.skins.findIndex((entry) => entry.skinId === item.skinId);

  if (outcome === "archived") {
    const preserved = existingIndex >= 0 ? catalog.skins[existingIndex] : item.catalogEntry;
    const archived = {
      ...preserved,
      skinId: item.skinId,
      productId: item.productId,
      price: Math.max(1, Number(preserved?.price) || 1),
      name: String(preserved?.name || item.skinId),
      hidden: true,
      archived: true,
    };
    if (existingIndex >= 0) catalog.skins[existingIndex] = archived;
    else catalog.skins.push(archived);
    log(`보관 처리(구매 이력 보존): ${item.skinId}`);
  } else if (outcome === "hard_deleted") {
    const version = Math.max(1, Number((existingIndex >= 0 ? catalog.skins[existingIndex] : item.catalogEntry)?.version) || 1);
    catalog.skins = catalog.skins.filter((entry) => entry.skinId !== item.skinId);
    fs.rmSync(path.join(ROOT, "character", "zip", `${item.skinId}.zip`), { force: true });
    fs.rmSync(path.join(ROOT, "character", "preview", item.skinId), { recursive: true, force: true });
    fs.rmSync(path.join(ROOT, "character", "versioned", item.skinId), { recursive: true, force: true });
    fs.appendFileSync(R2_DELETE, `${item.skinId}.zip\n`);
    for (let deployedVersion = 1; deployedVersion <= version; deployedVersion++) {
      fs.appendFileSync(R2_DELETE, `versions/${item.skinId}/v${deployedVersion}.zip\n`);
    }
    const record = { skinId: item.skinId, productId: item.productId, retiredAt: today() };
    const ledgerIndex = ledger.retired.findIndex((entry) => entry.skinId === item.skinId);
    if (ledgerIndex >= 0) ledger.retired[ledgerIndex] = record;
    else ledger.retired.push(record);
    log(`완전 삭제(미판매): ${item.skinId}`);
  } else {
    throw new Error(`${item.productId}의 알 수 없는 판정 결과: ${outcome}`);
  }

  fs.rmSync(path.join(INBOX, item.marker), { force: true });
}

ledger.retired.sort((a, b) => String(a.skinId).localeCompare(String(b.skinId)));
fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n");
fs.writeFileSync(RETIRED, JSON.stringify(ledger, null, 2) + "\n");
log(`완료: ${pending.length}개 유료 삭제 확정.`);
