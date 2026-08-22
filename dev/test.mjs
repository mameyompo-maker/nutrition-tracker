// ---------------------------------------------------------------
// dev/test.mjs
// ヘッドレスブラウザでアプリを一通り操作し、結果を報告する。
//
//   node dev/test.mjs            通常のテスト
//   node dev/test.mjs --verbose  通った項目もすべて表示する
//
// 失敗があれば終了コード1を返すので、CIでそのまま使える。
//
// 仕組み: テスト用のページが結果を POST /__result で送り返し、
// 受け取った時点でこちらからブラウザを終了させる。
// ---------------------------------------------------------------

import { buildTestCopy, serveDir, runChrome, cleanup } from "./lib.mjs";

const verbose = process.argv.includes("--verbose") || process.argv.includes("-v");

// 端末のダークモードに関わらず配色を固定する変更(v4 フェーズA)を入れたら、
// ここを true にする。ライトとダークで同じ値になることを検査するようになる。
const EXPECT_FIXED_THEME = false;

// 算出値の一覧から、キーがちょうど一致する行の値を取り出す。
// 前方一致にすると "--bg" が "--bg-deep" を拾ってしまうので、必ず完全一致で見る。
function pick(dump, key) {
  for (const line of (dump || "").split("\n")) {
    const i = line.indexOf("=");
    if (i === -1) continue;
    if (line.slice(0, i).trim() === key) return line.slice(i + 1).trim();
  }
  return null;
}

const THEME_KEYS = ["--bg", "--surface", "--text", "--accent", "body bg"];

async function main() {
  const dir = await buildTestCopy();
  const { server, port, nextResult } = await serveDir(dir);
  let failures = 0;

  const say = (ok, text) => {
    if (!ok) failures++;
    if (!ok || verbose) console.log(`${ok ? "PASS" : "FAIL"}  ${text}`);
  };

  try {
    // ---- 1) 操作のテスト ----
    const opWait = nextResult();
    const { result: body } = await runChrome(
      `http://127.0.0.1:${port}/index.html?probe=1`,
      ["--window-size=560,2400"],
      { waitFor: opWait, timeoutMs: 120000 }
    );

    if (!body) {
      console.error("テスト結果が返ってきませんでした。");
      console.error("ページのスクリプトが最初の段階で止まっている可能性があります。");
      process.exitCode = 1;
      return;
    }

    const lines = body.trim().split("\n");
    const head = lines[0];
    const results = lines.slice(1);
    failures += results.filter((l) => l.startsWith("FAIL")).length;

    for (const l of results) {
      if (verbose || l.startsWith("FAIL")) console.log(l);
    }
    console.log(`\n操作テスト: ${head}`);

    // ---- 2) 配色のテスト ----
    const themes = {};
    for (const [name, args] of [["light", []], ["dark", ["--force-dark-mode"]]]) {
      const wait = nextResult();
      const r = await runChrome(
        `http://127.0.0.1:${port}/index.html?view=trends&theme=1`,
        ["--window-size=560,1200", ...args],
        { waitFor: wait, timeoutMs: 60000 }
      );
      themes[name] = r.result;
    }

    console.log("");
    const before = failures;
    say(!!themes.light && !!themes.dark, "配色の算出値を取り出せる");

    if (themes.light && themes.dark) {
      // どちらのモードでもトークンが解決していること(CSSが壊れると空になる)
      for (const key of THEME_KEYS) {
        const l = pick(themes.light, key);
        const d = pick(themes.dark, key);
        say(!!l && !!d, `トークンが解決する (${key}): light=${l} dark=${d}`);
        if (EXPECT_FIXED_THEME) {
          say(l === d, `ダークでも配色が変わらない (${key}): light=${l} dark=${d}`);
        }
      }
      // ダークの検出そのものが効いているか(検査の前提が崩れていないか)
      say(pick(themes.dark, "prefers-color-scheme:dark") === "true",
          "--force-dark-mode で prefers-color-scheme が dark になる");
    }
    const themeFails = failures - before;
    console.log(`配色テスト: ${themeFails === 0 ? "ALL PASS" : themeFails + " FAILED"}`);

    if (failures > 0) {
      console.error(`\n合計 ${failures} 件の失敗があります。`);
      process.exitCode = 1;
    } else {
      console.log(`\nすべて通りました。`);
    }
  } finally {
    server.close();
    await cleanup(dir);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});
