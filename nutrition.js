// ---------------------------------------------------------------
// nutrition.js
// 1日の必要栄養量の算出。
//
// 出典: 厚生労働省「日本人の食事摂取基準(2025年版)」策定検討会報告書
//       https://www.mhlw.go.jp/stf/newpage_44138.html
//
// 数値はすべて同報告書の表から18歳以上の年齢区分ごとに転記したもので、
// 概算や丸めは加えていない。改定時はこのファイルの表だけを差し替えればよい。
//
// 医療的な助言ではなく、健康な人の一般的な目安として扱うこと。
// ---------------------------------------------------------------

const NUTRIENT_META = {
  calories:     { label: "エネルギー",   unit: "kcal",  basis: "推定エネルギー必要量" },
  protein:      { label: "たんぱく質",   unit: "g",     basis: "推奨量・目標量" },
  fat:          { label: "脂質",         unit: "g",     basis: "目標量(20〜30%エネルギー)" },
  carb:         { label: "炭水化物",     unit: "g",     basis: "目標量(50〜65%エネルギー)" },
  fiber:        { label: "食物繊維",     unit: "g",     basis: "目標量" },
  salt:         { label: "食塩相当量",   unit: "g",     basis: "目標量", isLimit: true },
  saturatedFat: { label: "飽和脂肪酸",   unit: "g",     basis: "目標量(7%エネルギー以下)", isLimit: true },
  calcium:      { label: "カルシウム",   unit: "mg",    basis: "推奨量" },
  iron:         { label: "鉄",           unit: "mg",    basis: "推奨量" },
  zinc:         { label: "亜鉛",         unit: "mg",    basis: "推奨量" },
  magnesium:    { label: "マグネシウム", unit: "mg",    basis: "推奨量" },
  potassium:    { label: "カリウム",     unit: "mg",    basis: "目標量" },
  vitaminA:     { label: "ビタミンA",    unit: "µgRAE", basis: "推奨量" },
  vitaminC:     { label: "ビタミンC",    unit: "mg",    basis: "推奨量" },
  vitaminD:     { label: "ビタミンD",    unit: "µg",    basis: "目安量" },
  vitaminE:     { label: "ビタミンE",    unit: "mg",    basis: "目安量" },
  vitaminB1:    { label: "ビタミンB1",   unit: "mg",    basis: "推奨量" },
  vitaminB2:    { label: "ビタミンB2",   unit: "mg",    basis: "推奨量" },
  vitaminB6:    { label: "ビタミンB6",   unit: "mg",    basis: "推奨量" },
  vitaminB12:   { label: "ビタミンB12",  unit: "µg",    basis: "目安量" },
  folate:       { label: "葉酸",         unit: "µg",    basis: "推奨量" },
};

// ホーム画面のメインで見せる項目(多すぎると煩雑になるため)
const PRIMARY_NUTRIENTS = ["calories", "protein", "fat", "carb", "fiber", "salt"];
const SECONDARY_NUTRIENTS = [
  "saturatedFat", "calcium", "iron", "zinc", "magnesium", "potassium",
  "vitaminA", "vitaminC", "vitaminD", "vitaminE",
  "vitaminB1", "vitaminB2", "vitaminB6", "vitaminB12", "folate",
];

// ---------------------------------------------------------------
// 年齢区分(食事摂取基準の区分に合わせる)
// 以降の表はすべてこの順に [18〜29, 30〜49, 50〜64, 65〜74, 75以上] で並ぶ
// ---------------------------------------------------------------

const AGE_BANDS = [
  { key: "18-29", min: 18, max: 29, label: "18〜29歳" },
  { key: "30-49", min: 30, max: 49, label: "30〜49歳" },
  { key: "50-64", min: 50, max: 64, label: "50〜64歳" },
  { key: "65-74", min: 65, max: 74, label: "65〜74歳" },
  { key: "75+",   min: 75, max: 999, label: "75歳以上" },
];

function ageBandIndex(age) {
  const i = AGE_BANDS.findIndex((b) => age >= b.min && age <= b.max);
  return i === -1 ? 0 : i;
}

// ---------------------------------------------------------------
// エネルギー
//   推定エネルギー必要量 = 基礎代謝量(基礎代謝基準値 × 体重) × 身体活動レベル
//   報告書 表3(基礎代謝量基準値)・表4/表5(身体活動レベル)
// ---------------------------------------------------------------

// 基礎代謝基準値 (kcal/kg体重/日) — 報告書 表3
const BMR_PER_KG = {
  male:   [23.7, 22.5, 21.8, 21.6, 21.5],
  female: [22.1, 21.9, 20.7, 20.7, 20.7],
};

// 身体活動レベル基準値 — 報告書 表4・表5
// 75歳以上は「高い」が設定されていないため、「ふつう」と同じ値を用いる
const PAL_BY_BAND = {
  low:    [1.50, 1.50, 1.50, 1.50, 1.40],
  normal: [1.75, 1.75, 1.75, 1.70, 1.70],
  high:   [2.00, 2.00, 2.00, 1.90, 1.70],
};

const ACTIVITY_LEVELS = {
  low:    { label: "低い",   desc: "生活の大部分が座位で、静的な活動が中心" },
  normal: { label: "ふつう", desc: "座位中心の仕事だが、職場内での移動や立位での作業・接客、通勤や買い物での歩行、家事、軽いスポーツのいずれかを含む" },
  high:   { label: "高い",   desc: "移動や立位の多い仕事に従事している、または余暇に活発な運動習慣がある" },
};

// ---------------------------------------------------------------
// たんぱく質・エネルギー産生栄養素バランス
// ---------------------------------------------------------------

// たんぱく質 推奨量 (g/日)
const PROTEIN_RDA = {
  male:   [65, 65, 65, 60, 60],
  female: [50, 50, 50, 50, 50],
};

// たんぱく質 目標量 (%エネルギー) — 男女共通
const PROTEIN_DG = [[13, 20], [13, 20], [14, 20], [15, 20], [15, 20]];

// 脂質・炭水化物・飽和脂肪酸の目標量 (%エネルギー) — 18歳以上は男女・年齢共通
const FAT_DG = [20, 30];
const CARB_DG = [50, 65];
const SATURATED_FAT_DG_MAX = 7;

// ---------------------------------------------------------------
// その他の栄養素 (18歳以上の年齢区分ごと)
//   推奨量: たんぱく質・カルシウム・鉄・亜鉛・マグネシウム・
//           ビタミンA/C/B1/B2/B6・葉酸
//   目安量: ビタミンD/E/B12
//   目標量: 食物繊維・食塩相当量・カリウム
// ---------------------------------------------------------------

const DRI = {
  fiber:      { male: [20, 22, 22, 21, 20],       female: [18, 18, 18, 18, 17] },
  salt:       { male: [7.5, 7.5, 7.5, 7.5, 7.5],  female: [6.5, 6.5, 6.5, 6.5, 6.5] },
  potassium:  { male: [3000, 3000, 3000, 3000, 3000], female: [2600, 2600, 2600, 2600, 2600] },
  calcium:    { male: [800, 750, 750, 750, 750],  female: [650, 650, 650, 650, 600] },
  magnesium:  { male: [340, 380, 370, 350, 330],  female: [280, 290, 290, 280, 270] },
  zinc:       { male: [9.0, 9.5, 9.5, 9.0, 9.0],  female: [7.5, 8.0, 8.0, 7.5, 7.0] },
  vitaminA:   { male: [850, 900, 900, 850, 800],  female: [650, 700, 700, 700, 650] },
  vitaminC:   { male: [100, 100, 100, 100, 100],  female: [100, 100, 100, 100, 100] },
  vitaminD:   { male: [9.0, 9.0, 9.0, 9.0, 9.0],  female: [9.0, 9.0, 9.0, 9.0, 9.0] },
  vitaminE:   { male: [6.5, 6.5, 6.5, 7.5, 7.0],  female: [5.0, 6.0, 6.0, 7.0, 6.0] },
  vitaminB1:  { male: [1.1, 1.2, 1.1, 1.0, 1.0],  female: [0.8, 0.9, 0.8, 0.8, 0.7] },
  vitaminB2:  { male: [1.6, 1.7, 1.6, 1.4, 1.4],  female: [1.2, 1.2, 1.2, 1.1, 1.1] },
  vitaminB6:  { male: [1.5, 1.5, 1.5, 1.4, 1.4],  female: [1.2, 1.2, 1.2, 1.2, 1.2] },
  vitaminB12: { male: [4.0, 4.0, 4.0, 4.0, 4.0],  female: [4.0, 4.0, 4.0, 4.0, 4.0] },
  folate:     { male: [240, 240, 240, 240, 240],  female: [240, 240, 240, 240, 240] },
};

// 鉄だけは女性で月経の有無により推奨量が分かれる。
// 65歳以上には「月経あり」の値が設定されていないため、月経なしの値を用いる。
const IRON_RDA = {
  male:            [7.0, 7.5, 7.0, 7.0, 6.5],
  femaleNoPeriod:  [6.0, 6.0, 6.0, 6.0, 5.5],
  femaleWithPeriod:[10.0, 10.5, 10.5, null, null],
};

// ---------------------------------------------------------------
// 目標(増量・減量)による調整
//
// ここだけは食事摂取基準の範囲外。体格を変えたい人向けの一般的な目安として、
// エネルギーを増減し、たんぱく質を体重当たりで確保する。
// ただし、たんぱく質は推奨量を下回らず、目標量の上限(20%エネルギー)も超えない。
// ---------------------------------------------------------------

const GOALS = {
  maintain: { label: "維持", desc: "今の体格をキープしたい", calorieAdjust: 0 },
  bulk:     { label: "増量", desc: "筋肉をつけて体を大きくしたい", calorieAdjust: 350 },
  cut:      { label: "減量", desc: "脂肪を減らして引き締めたい", calorieAdjust: -400 },
};
const PROTEIN_PER_KG = { bulk: 1.8, cut: 2.0 };

// ---------------------------------------------------------------
// 算出
// ---------------------------------------------------------------

function round1(v) {
  return Math.round(v * 10) / 10;
}

// 基礎代謝量(kcal/日)
function calcBMR(sex, weightKg, age) {
  const i = ageBandIndex(age);
  const perKg = (BMR_PER_KG[sex] || BMR_PER_KG.male)[i];
  return perKg * weightKg;
}

function ironTarget(sex, bandIndex, hasPeriod) {
  if (sex === "male") return IRON_RDA.male[bandIndex];
  if (hasPeriod) {
    const v = IRON_RDA.femaleWithPeriod[bandIndex];
    if (v != null) return v;
  }
  return IRON_RDA.femaleNoPeriod[bandIndex];
}

// 算出の根拠を画面に出せるようにまとめて返す
function targetBasis(profile) {
  const i = ageBandIndex(profile.age);
  const sex = profile.sex === "female" ? "female" : "male";
  const activity = ACTIVITY_LEVELS[profile.activity] ? profile.activity : "normal";
  return {
    bandIndex: i,
    bandLabel: AGE_BANDS[i].label,
    sexLabel: sex === "male" ? "男性" : "女性",
    bmrPerKg: BMR_PER_KG[sex][i],
    bmr: Math.round(calcBMR(sex, profile.weight, profile.age)),
    pal: PAL_BY_BAND[activity][i],
    activityLabel: ACTIVITY_LEVELS[activity].label,
    palIsSubstituted: i === 4 && activity === "high",
  };
}

// 利用者が自分で決めてよい目標。
// 既定値は厚生労働省「日本人の食事摂取基準(2025年版)」から算出するが、
// ここに挙げた項目は設定で上書きできる。
// 上書きは「自分の身体のことは自分が決める」という考え方によるもので、
// 既定値を消すわけではない(空にすればいつでも既定値に戻る)。
const CUSTOMIZABLE_TARGETS = [
  "calories", "protein", "fat", "carb", "fiber", "salt",
  "calcium", "iron", "vitaminC", "potassium",
];

function calcTargets(profile) {
  const base = calcTargetsFromDri(profile);
  const custom = (profile && profile.customTargets) || {};
  CUSTOMIZABLE_TARGETS.forEach((key) => {
    const v = parseFloat(custom[key]);
    // 0や負の値は「制限なし」ではなく入力の誤りとみなし、既定値のままにする
    if (Number.isFinite(v) && v > 0) base[key] = v;
  });
  return base;
}

// どの項目が既定値から変えられているか(画面で「自分で決めた」と示すため)
function customizedTargetKeys(profile) {
  const custom = (profile && profile.customTargets) || {};
  return CUSTOMIZABLE_TARGETS.filter((k) => {
    const v = parseFloat(custom[k]);
    return Number.isFinite(v) && v > 0;
  });
}

function calcTargetsFromDri(profile) {
  const sex = profile.sex === "female" ? "female" : "male";
  const i = ageBandIndex(profile.age);
  const activity = ACTIVITY_LEVELS[profile.activity] ? profile.activity : "normal";
  const goalMeta = GOALS[profile.goal] || GOALS.maintain;
  const hasPeriod = sex === "female" && profile.menstruation !== "no";

  // エネルギー: 基礎代謝基準値 × 体重 × 身体活動レベル
  const eer = calcBMR(sex, profile.weight, profile.age) * PAL_BY_BAND[activity][i];
  const calories = Math.max(1000, Math.round((eer + goalMeta.calorieAdjust) / 50) * 50);

  // たんぱく質: 推奨量と目標量の下限のうち大きい方。
  // 増量・減量では体重当たりの量を使うが、目標量の上限(20%エネルギー)は超えない。
  const [dgLow, dgHigh] = PROTEIN_DG[i];
  const rda = PROTEIN_RDA[sex][i];
  const proteinFloor = Math.max(rda, (calories * dgLow) / 100 / 4);
  const proteinCeil = (calories * dgHigh) / 100 / 4;
  // 丸めたあとに目標量の範囲から外れないよう、下限は切り上げ・上限は切り捨てで挟む
  const perKg = PROTEIN_PER_KG[profile.goal];
  let protein = perKg ? Math.round(profile.weight * perKg) : Math.ceil(proteinFloor);
  protein = Math.max(protein, Math.ceil(proteinFloor));
  protein = Math.min(protein, Math.floor(proteinCeil));

  // 脂質: 目標量20〜30%エネルギーの中央値25%
  let fat = Math.round((calories * 25) / 100 / 9);

  // 炭水化物: 残り。目標量50〜65%から外れる場合は脂質を範囲内で調整して収める
  let carb = Math.round((calories - protein * 4 - fat * 9) / 4);
  const carbLow = Math.round((calories * CARB_DG[0]) / 100 / 4);
  const carbHigh = Math.round((calories * CARB_DG[1]) / 100 / 4);
  if (carb < carbLow || carb > carbHigh) {
    const wanted = Math.min(carbHigh, Math.max(carbLow, carb));
    const fatKcal = calories - protein * 4 - wanted * 4;
    const fatLow = (calories * FAT_DG[0]) / 100 / 9;
    const fatHigh = (calories * FAT_DG[1]) / 100 / 9;
    fat = Math.round(Math.min(fatHigh, Math.max(fatLow, fatKcal / 9)));
    carb = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  }

  const pick = (key) => DRI[key][sex][i];

  return {
    calories,
    protein,
    fat,
    carb,
    fiber: pick("fiber"),
    salt: pick("salt"),
    saturatedFat: round1((calories * SATURATED_FAT_DG_MAX) / 100 / 9),
    calcium: pick("calcium"),
    iron: ironTarget(sex, i, hasPeriod),
    zinc: pick("zinc"),
    magnesium: pick("magnesium"),
    potassium: pick("potassium"),
    vitaminA: pick("vitaminA"),
    vitaminC: pick("vitaminC"),
    vitaminD: pick("vitaminD"),
    vitaminE: pick("vitaminE"),
    vitaminB1: pick("vitaminB1"),
    vitaminB2: pick("vitaminB2"),
    vitaminB6: pick("vitaminB6"),
    vitaminB12: pick("vitaminB12"),
    folate: pick("folate"),
  };
}

// ---------------------------------------------------------------
// アドバイス
// ---------------------------------------------------------------

const ADVICE_FOOD = {
  protein:   { text: "たんぱく質が不足気味です。鶏むね肉・卵・豆腐・魚・納豆などを足してみましょう。", iconKey: "protein" },
  fiber:     { text: "食物繊維が不足気味です。野菜・きのこ・海藻・玄米などを増やしてみましょう。",   iconKey: "fiber" },
  calcium:   { text: "カルシウムが不足気味です。乳製品・小魚・豆腐・小松菜などがおすすめです。",     iconKey: "calcium" },
  iron:      { text: "鉄が不足気味です。赤身の肉・レバー・ほうれん草・ひじきなどを取り入れましょう。", iconKey: "iron" },
  vitaminC:  { text: "ビタミンCが不足気味です。柑橘類・いちご・ブロッコリー・パプリカなどを。",       iconKey: "vitaminC" },
  vitaminD:  { text: "ビタミンDが不足気味です。鮭やさんまなどの魚、きのこ類がおすすめです。",         iconKey: "vitaminD" },
  vitaminB1: { text: "ビタミンB1が不足気味です。豚肉・玄米・大豆製品を取り入れましょう。",             iconKey: "vitaminB1" },
  vitaminB2: { text: "ビタミンB2が不足気味です。乳製品・卵・レバー・納豆などがおすすめです。",         iconKey: "vitaminB2" },
  vitaminA:   { text: "ビタミンAが不足気味です。レバー・うなぎ・にんじん・かぼちゃ・ほうれん草などを取り入れましょう。", iconKey: "vitaminA" },
  vitaminE:   { text: "ビタミンEが不足気味です。アーモンドなどのナッツ類・アボカド・かぼちゃ・植物油などを。",         iconKey: "vitaminE" },
  vitaminB6:  { text: "ビタミンB6が不足気味です。まぐろ・かつお・鶏むね肉・バナナなどがおすすめです。",               iconKey: "vitaminB6" },
  vitaminB12: { text: "ビタミンB12が不足気味です。レバー・あさり・しじみ・さんまなどを取り入れましょう。",             iconKey: "vitaminB12" },
  folate:     { text: "葉酸が不足気味です。ほうれん草・ブロッコリー・枝豆・レバーなどがおすすめです。",               iconKey: "folate" },
  magnesium:  { text: "マグネシウムが不足気味です。アーモンドなどのナッツ類・海藻・大豆製品・玄米などを。",           iconKey: "magnesium" },
  potassium:  { text: "カリウムが不足気味です。バナナ・アボカド・ほうれん草・いも類などがおすすめです。",             iconKey: "potassium" },
  zinc:       { text: "亜鉛が不足気味です。牡蠣・牛肉・レバー・チーズなどを取り入れましょう。",                       iconKey: "zinc" },
};

// ---- 摂りすぎについて ----
// このアプリは減点法を採らない。「食べ過ぎ」を叱ることはしない。
// 食事の記録が続かなくなる最大の理由は、記録すると責められることだからで、
// 続かなければ栄養は改善しない。だから咎める代わりに、次に足すものを示す。
//
// ただし、食塩と飽和脂肪酸は「多く摂ると健康を損ねる」性質の栄養素で、
// 体型の話ではない。ここだけは事実として穏やかに伝える。
// エネルギー・脂質・炭水化物の超過は、あえて何も言わない。
const OVER_NOTE = {
  salt:         { text: "今日は塩分がやや多めです。明日は汁物を半分にする、くらいで十分です。", iconKey: "salt" },
  saturatedFat: { text: "飽和脂肪酸がやや多めです。魚や植物油に振り替えると和らぎます。",       iconKey: "saturatedFat" },
};

// よく摂れているときに返す言葉。足りない項目が無いときだけ使う。
const PRAISE = [
  { text: "よく摂れています。この調子で大丈夫です。", iconKey: "check" },
  { text: "栄養のバランスが取れています。よくできています。", iconKey: "check" },
];

function buildAdvice(consumed, targets) {
  const items = [];

  // まだ何も食べていない日に「不足しています」を並べない。
  // 朝いちばんに開いた人へ16項目の不足を突きつけるのは、
  // 減点しない方針のちょうど正反対になる。
  if (!(consumed.calories > 0)) {
    return [{ text: "今日はまだ記録がありません。写真を1枚撮るところから。", iconKey: "camera" }];
  }

  // 1) 足りないものを補う提案。これが主役なので必ず先に出す。
  Object.keys(ADVICE_FOOD).forEach((key) => {
    const c = consumed[key] || 0;
    const t = targets[key];
    if (t && c < t * 0.6) items.push(ADVICE_FOOD[key]);
  });

  // 2) 健康上の意味がある2つだけ、控えめに添える。色は変えない。
  ["salt", "saturatedFat"].forEach((key) => {
    const c = consumed[key] || 0;
    const t = targets[key];
    // 目標をわずかに超えた程度では何も言わない。1.15倍を超えたときだけ。
    if (t && c > t * 1.15) items.push(OVER_NOTE[key]);
  });

  if (items.length === 0) {
    // 記録がまだ無い日に「よくできています」と言うと白々しいので、
    // 何か食べている日にだけ褒める。
    const ate = (consumed.calories || 0) > 0;
    items.push(ate ? PRAISE[0] : { text: "今日はまだ記録がありません。写真を1枚撮るところから。", iconKey: "camera" });
  }
  return items.slice(0, 5);
}

