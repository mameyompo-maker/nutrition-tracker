// ---------------------------------------------------------------
// dev/serve.mjs
// 手元でアプリを開くための簡易サーバー。
//
//   node dev/serve.mjs          http://127.0.0.1:8080 で開く
//   node dev/serve.mjs 3000     ポートを指定する
//
// index.html を直接ダブルクリックしても大半は動くが、
// サービスワーカー(オフライン対応)は http:// 経由でないと有効にならない。
// ---------------------------------------------------------------

import { serveDir, ROOT } from "./lib.mjs";

const port = Number(process.argv[2]) || 8080;
const { port: actual } = await serveDir(ROOT, port);
console.log(`http://127.0.0.1:${actual}/ で開けます (Ctrl+C で終了)`);
