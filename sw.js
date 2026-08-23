// サービスワーカー: アプリの見た目(シェル)をキャッシュしてオフラインでも開けるようにする。
// 栄養解析にはネット接続と、利用者自身のAI APIキーが必要です。
//
// アセットを追加したら ASSETS と CACHE_NAME の版を必ず上げること。
// 忘れると利用者の端末に古いファイルが残る。

const CACHE_NAME = "nutriapp-shell-v12";

// 共有シートから渡された写真を、画面へ引き渡すまでの一時置き場。
// シェルのキャッシュとは別に持ち、版を上げても消さない。
const SHARE_CACHE = "nutriapp-share";
const SHARE_KEY = "./__shared-photo";
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
      // 共有の受け渡し用は消さない。消すと、共有した直後に版が上がったときに
      // 写真が行方不明になる。
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== SHARE_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 共有シートから写真が渡ってきたとき。
  // GitHub Pages のような静的なホストは POST を受け取れないので、
  // ここで横取りして保管し、画面へは GET で戻す。
  // サーバーを持たずに「共有から記録」を成立させられるのは、この経路だけ。
  if (req.method === "POST" && url.searchParams.has("share-target")) {
    event.respondWith((async () => {
      try {
        const fd = await req.formData();
        const file = fd.get("photo");
        if (file && file.size) {
          const cache = await caches.open(SHARE_CACHE);
          await cache.put(SHARE_KEY, new Response(file, {
            headers: { "content-type": file.type || "image/jpeg" },
          }));
        }
      } catch (e) {
        // 受け取れなくても、画面だけは開く。黙って何も起きないのが最悪なので。
      }
      return Response.redirect(new URL("./index.html?shared=1", self.location).href, 303);
    })());
    return;
  }

  if (req.method !== "GET") return;
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
