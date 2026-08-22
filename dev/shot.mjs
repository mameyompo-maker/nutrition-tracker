// ---------------------------------------------------------------
// dev/shot.mjs
// 各画面のスクリーンショットを撮る。見た目を直したときの確認用。
//
//   node dev/shot.mjs                  dev/screenshots/ に全画面を出力
//   node dev/shot.mjs home trends      画面を指定する
//   node dev/shot.mjs --dark           ダークモードで撮る
//
// ヘッドレスのウィンドウ幅には下限(およそ500px)があるため、
// 実機の幅で見たいときは harness/shot.html が幅390pxのiframeに読み込む。
// ---------------------------------------------------------------

import { buildTestCopy, serveDir, runChrome, cleanup, DEV_DIR } from "./lib.mjs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const VIEWS = ["home", "capture", "trends", "history", "settings"];
const SHEETS = { entry: "home", share: "home", basis: "settings", weight: "trends", manual: "capture", guide: "settings" };

const args = process.argv.slice(2);
const dark = args.includes("--dark");
const wanted = args.filter((a) => !a.startsWith("--"));
const targets = wanted.length ? wanted : VIEWS;

const outDir = join(DEV_DIR, "screenshots");
await mkdir(outDir, { recursive: true });

const dir = await buildTestCopy();
const { server, port } = await serveDir(dir);

try {
  for (const t of targets) {
    // 「entry」のようにシート名を指定されたら、そのシートを開いた状態で撮る
    const isSheet = Object.prototype.hasOwnProperty.call(SHEETS, t);
    const query = isSheet ? `view=${SHEETS[t]}&sheet=${t}` : `view=${t}`;
    const height = isSheet ? 900 : 1500;
    const name = `${dark ? "dark" : "light"}-${t}.png`;
    const file = join(outDir, name);

    await runChrome(
      `http://127.0.0.1:${port}/shot.html?${query}&h=${height}`,
      [`--window-size=560,${height}`, `--screenshot=${file}`, "--virtual-time-budget=8000",
       ...(dark ? ["--force-dark-mode"] : [])]
    );
    console.log(`撮影: dev/screenshots/${name}`);
  }
} finally {
  server.close();
  await cleanup(dir);
}
