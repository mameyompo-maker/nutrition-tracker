// サービスワーカー: アプリの見た目(シェル)をキャッシュしてオフラインでも開けるようにする。
// 栄養解析にはネット接続と、利用者自身のAI APIキーが必要です。
//
// アセットを追加したら ASSETS と CACHE_NAME の版を必ず上げること。
// 忘れると利用者の端末に古いファイルが残る。

const CACHE_NAME = "nutriapp-shell-v8";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./icons.js",
  "./nutrition.js",
  "./exif.js",
  "./storage.js",
  "./charts.js",
  "./api.js",
  "./share.js",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // 外部のAI APIへのリクエストはキャッシュしない(常にネットワークへ)
  if (url.origin !== self.location.origin) return;

  // 画面そのものの読み込みはネットワークを先に試す。
  // こうしておくと、新しい版を出したときに次の起動で自然に切り替わる。
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match("./index.html")))
    );
    return;
  }

  // それ以外はキャッシュを即返し、裏で新しいものを取り直しておく
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
