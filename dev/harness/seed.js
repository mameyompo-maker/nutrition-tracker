// テスト用: localStorage に profile / logs / weights / favorites を仕込む。
// app.js より前に読み込むこと。
// サービスワーカーはテストでは登録しない。
// 登録すると (1) 終了と競合してヘッドレスが終わらない (2) 前回の古い資産を返す
// という2つの厄介ごとが起きるため。
if (navigator.serviceWorker) {
  try { navigator.serviceWorker.register = () => Promise.resolve(null); } catch (e) {}
}

(function () {
  const q = new URLSearchParams(location.search);
  if (q.get("fresh") === "1") { localStorage.clear(); return; }

  localStorage.setItem("nutriapp_profile_v1", JSON.stringify({
    age: 34, sex: "male", height: 172, weight: 68, activity: "normal", goal: "maintain",
    menstruation: "yes",
    provider: "gemini",
    apiKeys: { gemini: "AIzaTESTKEY1234567890abcd" },
    models: { gemini: "gemini-3.5-flash-lite" },
    baseUrls: {},
  }));

  const N = (o) => Object.assign({
    calories: 0, protein: 0, fat: 0, carb: 0, fiber: 0, salt: 0, saturatedFat: 0,
    calcium: 0, iron: 0, zinc: 0, magnesium: 0, potassium: 0,
    vitaminA: 0, vitaminC: 0, vitaminD: 0, vitaminE: 0,
    vitaminB1: 0, vitaminB2: 0, vitaminB6: 0, vitaminB12: 0, folate: 0,
  }, o);

  const key = (back) => {
    const d = new Date();
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
    const p = (n) => String(n).padStart(2, "0");
    return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
  };

  // 写真つきの経路も検査したいので、その場で小さな画像を1枚作る。
  // 大きなbase64を埋め込まずに済み、ファイルが読みやすいままになる。
  function makeFakeThumb() {
    const c = document.createElement("canvas");
    c.width = 240; c.height = 180;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 240, 180);
    grad.addColorStop(0, "#e8d9b5");
    grad.addColorStop(1, "#8fae72");
    g.fillStyle = grad;
    g.fillRect(0, 0, 240, 180);
    g.fillStyle = "#6b4f2a";
    g.beginPath(); g.arc(120, 90, 56, 0, Math.PI * 2); g.fill();
    return c.toDataURL("image/jpeg", 0.7);
  }
  const fakeThumb = makeFakeThumb();

  const logs = {};
  const mk = (id, name, meal, time, kcal, p, f, c) => ({
    id, name, meal, time,
    items: [{ name, amount: "1人前", grams: 320 }],
    nutrients: N({ calories: kcal, protein: p, fat: f, carb: c, fiber: 4.2, salt: 2.4,
      saturatedFat: 5.1, calcium: 180, iron: 2.4, zinc: 2.8, magnesium: 70, potassium: 640,
      vitaminA: 190, vitaminC: 22, vitaminD: 2.1, vitaminE: 1.6,
      vitaminB1: 0.28, vitaminB2: 0.31, vitaminB6: 0.42, vitaminB12: 1.1, folate: 68 }),
    note: "", thumb: null,
    portion: { basis: "撮影情報の実寸から算出", reference: "皿の直径を約22cmと仮定", totalGrams: 420 },
    source: "estimate", confidence: "high",
  });

  logs[key(0)] = [
    mk("t3", "鮭の塩焼き定食", "dinner", "19:20", 720, 38, 22, 88),
    mk("t2", "コーヒー", "snack", "15:10", 12, 0.3, 0.1, 1.5),
    mk("t1", "サラダチキンサンド", "lunch", "12:30", 430, 26, 12, 52),
    Object.assign(mk("t0", "納豆ごはんと味噌汁", "breakfast", "07:40", 480, 19, 8, 82),
                  { thumb: fakeThumb }),
  ];
  logs[key(1)] = [mk("y1", "カレーライス", "dinner", "19:00", 980, 27, 34, 132),
                  mk("y0", "トースト", "breakfast", "08:00", 320, 9, 11, 46)];
  logs[key(2)] = [mk("d2", "ラーメン", "lunch", "12:10", 860, 30, 28, 118)];
  logs[key(4)] = [mk("d4", "牛丼", "lunch", "12:40", 760, 24, 25, 104)];
  logs[key(5)] = [mk("d5", "パスタ", "dinner", "20:10", 690, 22, 21, 96)];
  logs[key(9)] = [mk("d9", "焼き魚定食", "dinner", "19:30", 640, 33, 18, 78)];
  logs[key(20)] = [mk("d20", "うどん", "lunch", "12:00", 520, 16, 8, 96)];
  localStorage.setItem("nutriapp_logs_v1", JSON.stringify(logs));

  const w = {};
  [0, 2, 5, 9, 14, 20].forEach((b, i) => { w[key(b)] = 68.9 - i * 0.35; });
  localStorage.setItem("nutriapp_weights_v1", JSON.stringify(w));

  localStorage.setItem("nutriapp_favs_v1", JSON.stringify([
    { id: "f1", name: "納豆ごはんと味噌汁", meal: "breakfast",
      nutrients: N({ calories: 480, protein: 19, fat: 8, carb: 82 }), thumb: null, items: [] },
    { id: "f2", name: "サラダチキン", meal: "lunch",
      nutrients: N({ calories: 114, protein: 24, fat: 1.5, carb: 0.6 }), thumb: null, items: [] },
  ]));
})();
