// ---------------------------------------------------------------
// share.js
// 記録を「人に見せられる1枚のカード画像」にして、端末の共有メニューへ渡す。
//
// この方式(案0)を選んでいる理由:
//   サーバーもデータベースも持たないので、利用者が何人に増えても費用が0のまま。
//   いいね・コメントは渡した先のSNS(X・Instagram・LINEなど)に乗る。
//   投稿を預からないため、通報対応や利用規約といった運用の負担も生じない。
//
// 画像はすべて端末の中で描く。どこにも送信しない。
// 共有するかどうか、どのアプリへ渡すかは、毎回利用者が選ぶ。
// ---------------------------------------------------------------

const SHARE_W = 1080;   // 書き出すカードの幅(px)
const SHARE_PAD = 72;

// このアプリの配色。style.css のトークンと合わせてある
const SHARE_COLORS = {
  bg: "#FFFDF8",
  ink: "#3D3226",
  ink2: "#6B5C48",
  ink3: "#8A7C68",
  accent: "#3F6B42",
  sun: "#C28308",
  line: "rgba(122,102,72,0.18)",
  protein: "#B0512F",
  fat: "#B87F1C",
  carb: "#7C9A3C",
};

const SHARE_FONT = `-apple-system, "SF Pro Text", "Hiragino Sans", "Yu Gothic", Meiryo, sans-serif`;

// 画像を読み込む(サムネイルの data URL を想定)
function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// 角丸の矩形パスを引く。roundRect が無い環境でも動くようにしてある
function roundedPath(ctx, x, y, w, h, r) {
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 中央を切り出して正方形に収める(写真の比率を崩さない)
function drawImageCover(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

// 帯グラフ1本。ラベル・数値・目標に対する割合を1行で描く
function drawMacroBar(ctx, x, y, w, label, value, unit, target, color) {
  ctx.font = `500 30px ${SHARE_FONT}`;
  ctx.fillStyle = SHARE_COLORS.ink2;
  ctx.textAlign = "left";
  ctx.fillText(label, x, y);

  ctx.font = `700 30px ${SHARE_FONT}`;
  ctx.fillStyle = SHARE_COLORS.ink;
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(value)}${unit}`, x + w, y);

  const barY = y + 16;
  const barH = 10;
  ctx.fillStyle = "rgba(118,118,128,0.16)";
  roundedPath(ctx, x, barY, w, barH, barH / 2);
  ctx.fill();

  const ratio = target > 0 ? Math.max(0, Math.min(1, value / target)) : 0;
  if (ratio > 0) {
    ctx.fillStyle = color;
    roundedPath(ctx, x, barY, Math.max(barH, w * ratio), barH, barH / 2);
    ctx.fill();
  }
  return barY + barH;
}

// 長い料理名を折り返す。指定の行数を超えたら末尾を「…」にする
function wrapText(ctx, text, maxWidth, maxLines) {
  const lines = [];
  let line = "";
  for (const ch of String(text)) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch;
      if (lines.length === maxLines) break;
    } else {
      line += ch;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1];
    if (ctx.measureText(last).width > maxWidth - 20) {
      lines[maxLines - 1] = last.slice(0, -1) + "…";
    }
  }
  return lines;
}

// ---------------------------------------------------------------
// カード画像を描く
//   entry: 記録1件 / targets: その日の目標 / opts.showNutrients: 栄養を載せるか
// 戻り値: Blob (image/png)
// ---------------------------------------------------------------

// 各段の高さ。ここを1か所にまとめておかないと、高さの計算と実際の描画がずれる
const ROW = {
  nameLine: 64,   // 料理名1行
  meta: 74,       // 区分と時刻
  kcal: 116,      // エネルギー
  rule: 54,       // 区切り線とその下の余白
  bar: 78,        // 帯グラフ1本
  sign: 62,       // 署名
};

async function renderShareCard(entry, targets, opts = {}) {
  const showNutrients = opts.showNutrients !== false;
  const img = await loadImage(entry.thumb);

  const canvas = document.createElement("canvas");
  canvas.width = SHARE_W;
  const ctx = canvas.getContext("2d");
  const innerW = SHARE_W - SHARE_PAD * 2;

  // 料理名が何行になるかは実際に測らないと分からないので、先に測ってから高さを決める
  ctx.font = `700 52px ${SHARE_FONT}`;
  const nameLines = wrapText(ctx, entry.name || "食事", innerW, 2);

  const photoH = img ? innerW : 0;
  const bodyH =
    ROW.nameLine * nameLines.length +
    ROW.meta +
    ROW.kcal +
    (showNutrients ? ROW.rule + ROW.bar * 3 : 0) +
    ROW.sign;
  const H = SHARE_PAD + photoH + (img ? 56 : 0) + bodyH + SHARE_PAD;

  // 高さを決めてから作り直す(canvas.height を変えると描画状態が初期化される)
  canvas.height = H;

  ctx.fillStyle = SHARE_COLORS.bg;
  ctx.fillRect(0, 0, SHARE_W, H);

  let y = SHARE_PAD;

  if (img) {
    ctx.save();
    roundedPath(ctx, SHARE_PAD, y, photoH, photoH, 44);
    ctx.clip();
    drawImageCover(ctx, img, SHARE_PAD, y, photoH, photoH);
    ctx.restore();
    y += photoH + 56;
  }

  // 料理名
  ctx.font = `700 52px ${SHARE_FONT}`;
  ctx.fillStyle = SHARE_COLORS.ink;
  ctx.textAlign = "left";
  nameLines.forEach((l) => {
    ctx.fillText(l, SHARE_PAD, y + 44);
    y += ROW.nameLine;
  });

  // 区分と時刻
  const mealLabel = MEALS[entry.meal]?.label || "";
  ctx.font = `400 30px ${SHARE_FONT}`;
  ctx.fillStyle = SHARE_COLORS.ink3;
  ctx.fillText([mealLabel, entry.time].filter(Boolean).join("  "), SHARE_PAD, y + 30);
  y += ROW.meta;

  // エネルギー
  ctx.font = `700 88px ${SHARE_FONT}`;
  ctx.fillStyle = SHARE_COLORS.accent;
  const kcal = String(Math.round(entry.nutrients?.calories || 0));
  ctx.fillText(kcal, SHARE_PAD, y + 72);
  const kcalW = ctx.measureText(kcal).width;
  ctx.font = `500 34px ${SHARE_FONT}`;
  ctx.fillStyle = SHARE_COLORS.ink2;
  ctx.fillText("kcal", SHARE_PAD + kcalW + 14, y + 72);
  y += ROW.kcal;

  if (showNutrients) {
    ctx.strokeStyle = SHARE_COLORS.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(SHARE_PAD, y);
    ctx.lineTo(SHARE_W - SHARE_PAD, y);
    ctx.stroke();
    y += ROW.rule;

    const n = entry.nutrients || {};
    const bars = [
      ["たんぱく質", n.protein || 0, targets?.protein, SHARE_COLORS.protein],
      ["脂質", n.fat || 0, targets?.fat, SHARE_COLORS.fat],
      ["炭水化物", n.carb || 0, targets?.carb, SHARE_COLORS.carb],
    ];
    for (const [label, value, target, color] of bars) {
      drawMacroBar(ctx, SHARE_PAD, y, innerW, label, value, "g", target, color);
      y += ROW.bar;
    }
  }

  // 差出人の署名。控えめに1行だけ
  ctx.font = `500 26px ${SHARE_FONT}`;
  ctx.fillStyle = SHARE_COLORS.ink3;
  ctx.textAlign = "center";
  ctx.fillText("食事栄養トラッカー", SHARE_W / 2, H - SHARE_PAD + 4);

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

// 共有に添える文章
function shareText(entry, opts = {}) {
  const parts = [];
  const mealLabel = MEALS[entry.meal]?.label;
  parts.push(`${mealLabel ? mealLabel + "は" : ""}${entry.name || "食事"}`);
  parts.push(`${Math.round(entry.nutrients?.calories || 0)} kcal`);
  if (opts.showNutrients !== false) {
    const n = entry.nutrients || {};
    parts.push(`P ${Math.round(n.protein || 0)}g / F ${Math.round(n.fat || 0)}g / C ${Math.round(n.carb || 0)}g`);
  }
  if (entry.note) parts.push(entry.note);
  return parts.join("\n");
}

// ---------------------------------------------------------------
// 共有の入口
// ---------------------------------------------------------------

// この端末が画像付きの共有に対応しているか
function canShareFiles() {
  if (!navigator.canShare || !navigator.share || typeof File === "undefined") return false;
  try {
    const probe = new File([new Blob(["x"], { type: "image/png" })], "p.png", { type: "image/png" });
    return navigator.canShare({ files: [probe] });
  } catch (e) {
    return false;
  }
}

// 共有メニューを開く。
// 戻り値: "shared" | "cancelled" | "downloaded" | "failed"
async function shareEntry(entry, targets, opts = {}) {
  let blob;
  try {
    blob = await renderShareCard(entry, targets, opts);
  } catch (e) {
    return "failed";
  }
  if (!blob) return "failed";

  const fileName = `meal-${entry.time ? entry.time.replace(":", "") : "card"}.png`;
  const text = shareText(entry, opts);

  if (canShareFiles()) {
    const file = new File([blob], fileName, { type: "image/png" });
    try {
      await navigator.share({ files: [file], text });
      return "shared";
    } catch (e) {
      // 利用者が共有シートを閉じた場合は AbortError。失敗として扱わない
      if (e && e.name === "AbortError") return "cancelled";
      // 対応していない組み合わせだった場合は、保存に切り替える
    }
  }

  // 共有に対応していない端末(パソコンのブラウザなど)では、画像として保存する
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return "downloaded";
  } catch (e) {
    return "failed";
  }
}
