import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APPLY = path.join(SCRIPT_DIR, "apply-skin-bundle.mjs");
const FINALIZE = path.join(SCRIPT_DIR, "finalize-skin-deletions.mjs");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "daintyz-skin-delete-"));
  fs.mkdirSync(path.join(root, "_inbox"), { recursive: true });
  fs.mkdirSync(path.join(root, "character", "preview", "paid"), { recursive: true });
  fs.mkdirSync(path.join(root, "character", "zip"), { recursive: true });
  fs.mkdirSync(path.join(root, "character", "versioned", "paid", "v2", "preview"), { recursive: true });
  fs.writeFileSync(path.join(root, "character", "preview", "paid", "thumb.png"), "preview");
  fs.writeFileSync(path.join(root, "character", "versioned", "paid", "v2", "preview", "thumb.png"), "preview-v2");
  fs.writeFileSync(path.join(root, "catalog.json"), JSON.stringify({
    skins: [{
      skinId: "paid", name: "유료", price: 1000, productId: "skin_paid", version: 2,
    }],
  }));
  fs.writeFileSync(path.join(root, "_inbox", "paid.delete.json"), JSON.stringify({
    deleteSkinId: "paid", productId: "skin_paid", price: 1000,
  }));
  return root;
}

function run(script, root) {
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

test("유료 삭제는 Play 판정 전 catalog·preview·마커를 보존한다", () => {
  const root = fixture();
  try {
    run(APPLY, root);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "catalog.json"))).skins.length, 1);
    assert.equal(fs.existsSync(path.join(root, "character", "preview", "paid", "thumb.png")), true);
    assert.equal(fs.existsSync(path.join(root, "character", "versioned", "paid", "v2", "preview", "thumb.png")), true);
    assert.equal(fs.existsSync(path.join(root, "_inbox", "paid.delete.json")), true);
    assert.equal(fs.existsSync(path.join(root, "_r2_delete.txt")), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "_pending_paid_deletes.json"))).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("판매 이력 상품은 hidden+archived로 남아 기존 구매자의 재다운로드를 보장한다", () => {
  const root = fixture();
  try {
    run(APPLY, root);
    fs.writeFileSync(path.join(root, "_play_delete_results.json"), JSON.stringify([
      { productId: "skin_paid", outcome: "archived" },
    ]));
    run(FINALIZE, root);
    const entry = JSON.parse(fs.readFileSync(path.join(root, "catalog.json"))).skins[0];
    assert.equal(entry.hidden, true);
    assert.equal(entry.archived, true);
    assert.equal(fs.existsSync(path.join(root, "character", "preview", "paid", "thumb.png")), true);
    assert.equal(fs.existsSync(path.join(root, "character", "versioned", "paid", "v2", "preview", "thumb.png")), true);
    assert.equal(fs.existsSync(path.join(root, "_r2_delete.txt")), false);
    assert.equal(fs.existsSync(path.join(root, "_inbox", "paid.delete.json")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("미판매 상품만 catalog·preview·R2에서 완전 삭제한다", () => {
  const root = fixture();
  try {
    run(APPLY, root);
    fs.writeFileSync(path.join(root, "_play_delete_results.json"), JSON.stringify([
      { productId: "skin_paid", outcome: "hard_deleted" },
    ]));
    run(FINALIZE, root);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "catalog.json"))).skins.length, 0);
    assert.equal(fs.existsSync(path.join(root, "character", "preview", "paid")), false);
    assert.equal(fs.existsSync(path.join(root, "character", "versioned", "paid")), false);
    assert.equal(
      fs.readFileSync(path.join(root, "_r2_delete.txt"), "utf8").trim(),
      "paid.zip\nversions/paid/v1.zip\nversions/paid/v2.zip",
    );
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "_retired_ids.json"))).retired[0].skinId, "paid");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
