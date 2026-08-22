// ---------------------------------------------------------------
// dev/lib.mjs
// 開発用スクリプトの共通部分。
// 外部パッケージは使わない(このリポジトリは npm install 不要で動く)。
// ---------------------------------------------------------------

import { createServer } from "node:http";
import { readFile, mkdtemp, cp, rm, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

export const DEV_DIR = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(DEV_DIR, "..");

// アプリ本体を構成するファイル。dev/ と文書類は含めない
export const APP_FILES = [
  "index.html", "style.css", "manifest.json", "sw.js",
  "icons.js", "nutrition.js", "exif.js", "storage.js",
  "charts.js", "api.js", "share.js", "app.js",
  "icon-192.png", "icon-512.png", "icon-maskable-512.png",
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

// 静的ファイルを配るだけの簡易サーバー。
// テストのときは、ページから結果を POST /__result で送り返してもらう。
// こうすると「いつ終わったか」をこちら側が正確に知れるので、
// 待ち時間の当て推量とヘッドレスの終了待ちが要らなくなる。
export function serveDir(dir, port = 0) {
  return new Promise((ok) => {
    let onResult = null;
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, "http://x");

      if (req.method === "POST" && url.pathname === "/__result") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          res.writeHead(204).end();
          if (onResult) onResult(body);
        });
        return;
      }

      let p = decodeURIComponent(url.pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = join(dir, p);
      // ディレクトリの外へ出る要求は拒む
      if (!resolve(file).startsWith(resolve(dir))) {
        res.writeHead(403).end("forbidden");
        return;
      }
      try {
        const buf = await readFile(file);
        res.writeHead(200, {
          "content-type": MIME[extname(file)] || "application/octet-stream",
          "cache-control": "no-store",
        });
        res.end(buf);
      } catch {
        res.writeHead(404).end("not found");
      }
    });
    server.listen(port, "127.0.0.1", () =>
      ok({
        server,
        port: server.address().port,
        // 次に送られてくる結果を1回だけ待つ
        nextResult: () => new Promise((r) => { onResult = r; }),
      })
    );
  });
}

// Chrome / Edge の実行ファイルを探す
export function findBrowser() {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const candidates = {
    win32: [
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    ],
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ],
    linux: [
      "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium", "/usr/bin/chromium-browser",
    ],
  }[process.platform] || [];
  return candidates.find((p) => existsSync(p)) || null;
}

// ヘッドレスChromeを1回だけ走らせる。
//
// opts.waitFor に Promise を渡すと、それが解決した時点でブラウザを終了させ、
// 解決値を result として返す。ページ側から結果を送り返してもらう使い方を想定。
//
// 踏んだ罠(HANDOVER.md 参照):
//   - --user-data-dir は必ず指定し、毎回新しい場所にする。
//     付けないと無言で何も出力せず、使い回すと固まる。
//   - **--virtual-time-budget と --dump-dom の組み合わせは当てにしない。**
//     ページ側が canvas.toBlob のような非同期処理をしていると、
//     ブラウザが終了しなくなることがある(実際に何度も踏んだ)。
//     結果を待ちたいときは waitFor を使い、こちらから終了させる。
export async function runChrome(url, extraArgs = [], opts = {}) {
  const { timeoutMs = 60000, waitFor = null } = opts;
  const bin = findBrowser();
  if (!bin) {
    throw new Error(
      "Chrome か Edge が見つかりません。環境変数 CHROME_PATH に実行ファイルの場所を指定してください。"
    );
  }
  const profile = await mkdtemp(join(tmpdir(), "nutriapp-profile-"));
  const args = [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--hide-scrollbars",
    `--user-data-dir=${profile}`,
    "--force-prefers-reduced-motion",
    ...extraArgs,
    url,
  ];

  try {
    return await new Promise((ok, ng) => {
      const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      let settled = false;

      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(arg);
      };

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(ng, new Error(`ブラウザが ${timeoutMs / 1000} 秒以内に応答しませんでした`));
      }, timeoutMs);

      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => finish(ng, e));
      child.on("close", () => finish(ok, { out, err, result: null }));

      if (waitFor) {
        waitFor.then((result) => {
          // 結果が届いたら用は済んだので、こちらから閉じる
          child.kill("SIGKILL");
          finish(ok, { out, err, result });
        });
      }
    });
  } finally {
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

// アプリ一式 + テスト用スクリプトを一時フォルダに組み立てる。
// プロジェクト本体は汚さない。
export async function buildTestCopy() {
  const dir = await mkdtemp(join(tmpdir(), "nutriapp-build-"));
  for (const f of APP_FILES) {
    await cp(join(ROOT, f), join(dir, f));
  }
  for (const f of await readdir(join(DEV_DIR, "harness"))) {
    await cp(join(DEV_DIR, "harness", f), join(dir, f));
  }

  // 本物の index.html にテスト用スクリプトを差し込む。
  // 別にコピーを持たず毎回作るので、本体を直しても取り残されない。
  let html = await readFile(join(dir, "index.html"), "utf8");
  html = html.replace(
    '<script src="./icons.js"></script>',
    '<script src="./seed.js"></script>\n  <script src="./icons.js"></script>'
  );
  html = html.replace(
    '<script src="./app.js"></script>',
    '<script src="./app.js"></script>\n  <script src="./sheet.js"></script>' +
    '\n  <script src="./theme.js"></script>\n  <script src="./probe.js"></script>'
  );
  await writeFile(join(dir, "index.html"), html);
  return dir;
}

export const cleanup = (dir) => rm(dir, { recursive: true, force: true }).catch(() => {});

// DOMのダンプから、指定したidのdivの中身を取り出す
export function extractDiv(html, id) {
  const m = html.match(new RegExp(`<div id="${id}"[^>]*>([\\s\\S]*?)</div>`));
  if (!m) return null;
  return m[1]
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
