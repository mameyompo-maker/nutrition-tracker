// 最小限のサービスワーカー: アプリの見た目(シェル)をキャッシュしてオフラインでも開けるようにする。
// 栄養解析にはネット接続と、利用者自身のAI APIキーが必要です。

const CACHE_NAME = "nutriapp-shell-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./icons.js",
  "./nutrition.js",
  "./storage.js",
  "./api.js",
  "./app.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
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
  const url = new URL(event.request.url);
  // 外部のAI APIへのリクエストはキャッシュしない(常にネットワークへ)
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => cached);
    })
  );
});
