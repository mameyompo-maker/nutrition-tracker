// ---------------------------------------------------------------
// dev/check.mjs
// ビルド工程を持たないぶん、機械的に見つかる崩れはここで拾う。
//
//   node dev/check.mjs
//
// 1. すべてのJSが構文として通るか
// 2. manifest.json が壊れていないか
// 3. index.html が読み込むファイルが実在するか
// 4. サービスワーカーの ASSETS に入れ忘れがないか  ← いちばん忘れやすい
// ---------------------------------------------------------------

import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ROOT } from "./lib.mjs";

const run = promisify(execFile);
let failures = 0;
const fail = (msg) => { failures++; console.log(`NG  ${msg}`); };
const pass = (msg) => console.log(`OK  ${msg}`);

// --- 1. JSの構文 ---
const JS = ["icons.js", "nutrition.js", "exif.js", "storage.js", "charts.js",
            "api.js", "share.js", "app.js", "sw.js"];
for (const f of JS) {
  try {
    await run(process.execPath, ["--check", join(ROOT, f)]);
    pass(`構文 ${f}`);
  } catch (e) {
    fail(`構文 ${f}\n${e.stderr || e.message}`);
  }
}

// --- 2. manifest.json ---
let manifest;
try {
  manifest = JSON.parse(await readFile(join(ROOT, "manifest.json"), "utf8"));
  pass("manifest.json が読める");
} catch (e) {
  fail(`manifest.json: ${e.message}`);
}

// --- 3. index.html が読み込むファイル ---
const html = await readFile(join(ROOT, "index.html"), "utf8");
const refs = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((m) => m[1]);
for (const r of new Set(refs)) {
  try {
    await access(join(ROOT, r));
    pass(`index.html が読む ${r} が存在する`);
  } catch {
    fail(`index.html が読む ${r} が見つからない`);
  }
}

// --- 4. サービスワーカーのキャッシュ対象 ---
// アセットを足したのに ASSETS へ入れ忘れると、利用者の端末に古い版が残る。
const sw = await readFile(join(ROOT, "sw.js"), "utf8");
const assets = [...sw.matchAll(/"\.\/([^"]+)"/g)].map((m) => m[1]);
for (const r of new Set(refs)) {
  if (assets.includes(r)) pass(`sw.js が ${r} をキャッシュする`);
  else fail(`sw.js の ASSETS に ${r} が入っていない`);
}
if (manifest) {
  for (const icon of manifest.icons.map((i) => i.src)) {
    if (assets.includes(icon)) pass(`sw.js が ${icon} をキャッシュする`);
    else fail(`sw.js の ASSETS に ${icon} が入っていない`);
  }
}

const version = (sw.match(/CACHE_NAME = "([^"]+)"/) || [])[1];
if (version) pass(`サービスワーカーの版: ${version}`);
else fail("sw.js から CACHE_NAME を読み取れない");

console.log(failures === 0 ? "\nすべて通りました。" : `\n${failures} 件の問題があります。`);
process.exitCode = failures === 0 ? 0 : 1;
