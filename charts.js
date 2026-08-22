// ---------------------------------------------------------------
// charts.js
// トレンド画面のチャートを、外部ライブラリなしのインラインSVGで組む。
// 色はCSSクラスに委ねる(ライト/ダークの切り替えをCSSに任せるため)。
// viewBoxは320基準で、表示幅に合わせて等倍に拡大される。
// ---------------------------------------------------------------

const CH_W = 320;

function chText(x, y, str, cls, anchor) {
  return `<text x="${x}" y="${y}" class="${cls}"${anchor ? ` text-anchor="${anchor}"` : ""}>${str}</text>`;
}

// 日ごとのエネルギー棒グラフ。
// days: [{ label, v, today, over }] (古い→新しい) / target: 目標kcal
function energyBarChart(days, target) {
  const H = 150;
  const padTop = 14, padBottom = 22;
  const plotH = H - padTop - padBottom;
  const n = days.length;
  const slot = CH_W / n;
  const barW = Math.min(22, slot * 0.62);
  // 目標線が必ず入るだけの高さは確保しつつ、棒が縮んで読みにくくならないようにする
  const maxV = Math.max(target * 1.06, ...days.map((d) => d.v * 1.12), 1);
  const y = (v) => padTop + plotH * (1 - Math.min(v, maxV) / maxV);

  let bars = "";
  days.forEach((d, i) => {
    const cx = slot * i + slot / 2;
    if (d.v > 0) {
      const top = y(d.v);
      const h = Math.max(3, padTop + plotH - top);
      const rx = Math.min(3, barW / 2);
      bars += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="${rx}" class="ch-bar${d.over ? " over" : ""}${d.today ? " today" : ""}"/>`;
    } else {
      // 記録なしの日は、底に小さな点を置いて「空」だと分かるようにする
      bars += `<circle cx="${cx.toFixed(1)}" cy="${(padTop + plotH - 2).toFixed(1)}" r="1.8" class="ch-empty"/>`;
    }
  });

  // 目標線
  const ty = y(target);
  const targetLine = `
    <line x1="0" x2="${CH_W}" y1="${ty.toFixed(1)}" y2="${ty.toFixed(1)}" class="ch-target"/>
    ${chText(CH_W, ty - 4, `目標 ${target}`, "ch-axis strong", "end")}`;

  // 軸ラベル: 7日なら曜日を全部、30日なら数カ所だけ
  let labels = "";
  const labelIdx = n <= 10 ? days.map((_, i) => i) : [0, Math.round(n / 3), Math.round((n * 2) / 3), n - 1];
  labelIdx.forEach((i) => {
    const cx = slot * i + slot / 2;
    labels += chText(cx.toFixed(1), H - 6, days[i].label, `ch-axis${days[i].today ? " strong" : ""}`, "middle");
  });

  return `<svg class="chart" viewBox="0 0 ${CH_W} ${H}" role="img" aria-label="日ごとのエネルギー摂取量">${targetLine}${bars}${labels}</svg>`;
}

// 体重の折れ線グラフ。points: [{ key, kg }] (古い→新しい)
function weightLineChart(points) {
  const H = 140;
  const padL = 34, padR = 14, padTop = 12, padBottom = 22;
  const plotW = CH_W - padL - padR;
  const plotH = H - padTop - padBottom;

  const vals = points.map((p) => p.kg);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(hi - lo, 1);
  lo -= span * 0.15;
  hi += span * 0.15;

  const x = (i) => (points.length === 1 ? padL + plotW / 2 : padL + (plotW * i) / (points.length - 1));
  const y = (v) => padTop + plotH * (1 - (v - lo) / (hi - lo));

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(p.kg).toFixed(1)}`).join(" ");
  const dots = points
    .map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.kg).toFixed(1)}" r="${i === points.length - 1 ? 4 : 2.4}" class="ch-dot${i === points.length - 1 ? " last" : ""}"/>`)
    .join("");

  const gridY = [lo + span * 0.15, hi - span * 0.15];
  const grid = gridY
    .map((v) => `<line x1="${padL}" x2="${CH_W - padR}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="ch-grid"/>` +
      chText(padL - 5, y(v) + 3.5, (Math.round(v * 10) / 10).toFixed(1), "ch-axis", "end"))
    .join("");

  const first = points[0], last = points[points.length - 1];
  const labels =
    chText(x(0).toFixed(1), H - 6, formatDateShort(first.key), "ch-axis", points.length === 1 ? "middle" : "start") +
    (points.length > 1 ? chText(x(points.length - 1).toFixed(1), H - 6, formatDateShort(last.key), "ch-axis strong", "end") : "");

  return `<svg class="chart" viewBox="0 0 ${CH_W} ${H}" role="img" aria-label="体重の推移">${grid}<path d="${path}" class="ch-line"/>${dots}${labels}</svg>`;
}

// PFCバランスの1行。目標の帯(band)の上に、実績のマーカーを置く。
// key: "protein"|"fat"|"carb" / actualPct: 実績%E / band: [lo, hi]
function pfcBalanceRow(key, labelText, actualPct, band) {
  const scaleMax = 80; // %E の表示上限(炭水化物の上限65%が収まる)
  const pos = (v) => Math.max(0, Math.min(100, (v / scaleMax) * 100));
  const inBand = actualPct >= band[0] && actualPct <= band[1];
  return `
    <div class="pfc-row">
      <span class="pfc-name"><i class="dot c-${key}"></i>${labelText}</span>
      <span class="pfc-track">
        <i class="band" style="left:${pos(band[0])}%;width:${pos(band[1]) - pos(band[0])}%;"></i>
        <i class="marker c-${key} ${inBand ? "" : "out"}" style="left:${pos(actualPct)}%;"></i>
      </span>
      <span class="pfc-val tnum ${inBand ? "" : "out"}">${Math.round(actualPct)}<small>%</small></span>
    </div>
  `;
}
