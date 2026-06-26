// _inbox/*.zip (스킨빌더 번들)을 풀어서 디자인레포에 배치하고 catalog.json을 병합한다.
//
// 번들 구조(스킨빌더 tools/skin-builder/index.html 출력):
//   character_zip/{skinId}.zip
//   preview/{skinId}/thumb.png, prev01.png …
//   catalog_entry.json   ← catalog.json "skins"에 upsert 할 항목
//
// 동작: 번들을 레포 레이아웃 그대로 펼치고(character_zip/ · preview/), catalog만 병합.
// unzip(ubuntu-latest 기본 제공) 외 외부 의존성 없음.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const INBOX = path.join(ROOT, "_inbox");
const CATALOG = path.join(ROOT, "catalog.json");
const WORK = path.join(ROOT, "_inbox_work");

function log(msg) { console.log(`[apply-skin-bundle] ${msg}`); }

if (!fs.existsSync(INBOX)) { log("_inbox 폴더 없음 — 처리할 것 없음."); process.exit(0); }

const zips = fs.readdirSync(INBOX).filter(f => f.toLowerCase().endsWith(".zip"));
if (zips.length === 0) { log("_inbox에 zip 없음 — 처리할 것 없음."); process.exit(0); }

// catalog 로드 (없으면 생성)
let catalog;
try {
  catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
} catch {
  catalog = { skins: [] };
}
if (!Array.isArray(catalog.skins)) catalog.skins = [];

fs.rmSync(WORK, { recursive: true, force: true });
let applied = 0;

for (const zip of zips) {
  const zipPath = path.join(INBOX, zip);
  const tmp = path.join(WORK, zip.replace(/\.zip$/i, ""));
  fs.mkdirSync(tmp, { recursive: true });
  log(`풀기: _inbox/${zip}`);
  execFileSync("unzip", ["-o", "-q", zipPath, "-d", tmp], { stdio: "inherit" });

  // 1) character_zip/, preview/ 를 레포 루트로 오버레이
  for (const sub of ["character_zip", "preview"]) {
    const src = path.join(tmp, sub);
    if (fs.existsSync(src)) {
      fs.cpSync(src, path.join(ROOT, sub), { recursive: true });
      log(`  → ${sub}/ 배치 완료`);
    } else {
      log(`  ⚠ 번들에 ${sub}/ 없음 (건너뜀)`);
    }
  }

  // 2) catalog 병합 (skinId 기준 upsert; 기존이면 version +1)
  const entryPath = path.join(tmp, "catalog_entry.json");
  if (!fs.existsSync(entryPath)) {
    throw new Error(`${zip}: catalog_entry.json 이 없습니다. 스킨빌더로 만든 번들인지 확인하세요.`);
  }
  const entry = JSON.parse(fs.readFileSync(entryPath, "utf8"));
  if (!entry.skinId) throw new Error(`${zip}: catalog_entry.json 에 skinId가 없습니다.`);

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

  // 3) 처리한 inbox zip 제거
  fs.rmSync(zipPath, { force: true });
  applied++;
}

// catalog 저장 (2-space, 트레일링 개행)
fs.writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + "\n");
fs.rmSync(WORK, { recursive: true, force: true });
log(`완료: ${applied}개 번들 적용, catalog.json 갱신.`);
