// ---------------------------------------------------------------
// nutrition.js
// 栄養目標の計算ロジック（成人向け・一般的な目安値）
// 参考: 日本人の食事摂取基準(2020年版)の考え方を簡略化したもの。
// 医療的な助言ではなく、あくまで一般的な目安として扱ってください。
// ---------------------------------------------------------------

const NUTRIENT_META = {
  calories:    { label: "エネルギー",     unit: "kcal" },
  protein:     { label: "たんぱく質",     unit: "g" },
  fat:         { label: "脂質",           unit: "g" },
  carb:        { label: "炭水化物",       unit: "g" },
  fiber:       { label: "食物繊維",       unit: "g" },
  salt:        { label: "食塩相当量",     unit: "g", isLimit: true },
  saturatedFat:{ label: "飽和脂肪酸",     unit: "g", isLimit: true },
  calcium:     { label: "カルシウム",     unit: "mg" },
  iron:        { label: "鉄",             unit: "mg" },
  zinc:        { label: "亜鉛",           unit: "mg" },
  magnesium:   { label: "マグネシウム",   unit: "mg" },
  potassium:   { label: "カリウム",       unit: "mg" },
  vitaminA:    { label: "ビタミンA",      unit: "µgRAE" },
  vitaminC:    { label: "ビタミンC",      unit: "mg" },
  vitaminD:    { label: "ビタミンD",      unit: "µg" },
  vitaminE:    { label: "ビタミンE",      unit: "mg" },
  vitaminB1:   { label: "ビタミンB1",     unit: "mg" },
  vitaminB2:   { label: "ビタミンB2",     unit: "mg" },
  vitaminB6:   { label: "ビタミンB6",     unit: "mg" },
  vitaminB12:  { label: "ビタミンB12",    unit: "µg" },
  folate:      { label: "葉酸",           unit: "µg" },
};

// ホーム画面のメインで見せる項目（多すぎると煩雑になるため）
const PRIMARY_NUTRIENTS = ["calories", "protein", "fat", "carb", "fiber", "salt"];
const SECONDARY_NUTRIENTS = [
  "saturatedFat", "calcium", "iron", "zinc", "magnesium", "potassium",
  "vitaminA", "vitaminC", "vitaminD", "vitaminE",
  "vitaminB1", "vitaminB2", "vitaminB6", "vitaminB12", "folate",
];

const ACTIVITY_LEVELS = {
  low:    { label: "低い",   desc: "座り仕事が中心・あまり運動しない", factor: 1.5 },
  normal: { label: "ふつう", desc: "立ち仕事や通勤・軽い運動を含む",   factor: 1.75 },
  high:   { label: "高い",   desc: "力仕事や活発な運動習慣がある",     factor: 2.0 },
};

// 目標に応じてカロリー収支とたんぱく質量を調整する。
// 増減量幅・g/kg量は一般的なトレーニング指導で使われる目安であり、個人差があります。
const GOALS = {
  maintain: { label: "維持",     desc: "今の体格をキープしたい",           calorieAdjust: 0 },
  bulk:     { label: "増量",     desc: "筋肉をつけて体を大きくしたい",     calorieAdjust: 350 },
  cut:      { label: "減量",     desc: "脂肪を減らして引き締めたい",       calorieAdjust: -400 },
};
const PROTEIN_PER_KG = { bulk: 1.8, cut: 2.0 };

function calcBMR(sex, weightKg, heightCm, age) {
  // Mifflin-St Jeor式
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === "male" ? base + 5 : base - 161;
}

function calcTargets(profile) {
  const { sex, age, height, weight, activity, goal } = profile;
  const bmr = calcBMR(sex, weight, height, age);
  const factor = (ACTIVITY_LEVELS[activity] || ACTIVITY_LEVELS.normal).factor;
  const tdee = bmr * factor;
  const goalMeta = GOALS[goal] || GOALS.maintain;

  const isMale = sex === "male";

  const calories = Math.round(tdee + goalMeta.calorieAdjust);

  // 増量・減量時はたんぱく質を体重比(g/kg)で優先して確保し、脂質は総カロリーの25%、
  // 炭水化物は残りで埋める。維持の場合は従来通りカロリー比(15/25/60%)で配分する。
  const proteinPerKg = PROTEIN_PER_KG[goal];
  let protein, fat, carb;
  if (proteinPerKg) {
    protein = Math.round(weight * proteinPerKg);
    fat = Math.round((calories * 0.25) / 9);
    carb = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  } else {
    protein = Math.round((calories * 0.15) / 4);
    fat = Math.round((calories * 0.25) / 9);
    carb = Math.round((calories * 0.6) / 4);
  }
  const saturatedFat = Math.round(((calories * 0.07) / 9) * 10) / 10;

  return {
    calories,
    protein,
    fat,
    carb,
    fiber: isMale ? 21 : 18,
    salt: isMale ? 7.5 : 6.5,
    saturatedFat,
    calcium: isMale ? 750 : 650,
    iron: isMale ? 7.5 : 10.5,
    zinc: isMale ? 11 : 8,
    magnesium: isMale ? 340 : 270,
    potassium: isMale ? 2500 : 2000,
    vitaminA: isMale ? 850 : 650,
    vitaminC: 100,
    vitaminD: 8.5,
    vitaminE: isMale ? 6.0 : 5.0,
    vitaminB1: isMale ? 1.4 : 1.1,
    vitaminB2: isMale ? 1.6 : 1.2,
    vitaminB6: isMale ? 1.4 : 1.1,
    vitaminB12: 2.4,
    folate: 240,
  };
}

// 不足している栄養素に対する簡易アドバイス（食品例）
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

const OVER_WARN = {
  calories:     { text: "エネルギーが目標を超えています。次の食事は軽めを意識しましょう。",           iconKey: "calories", warn: true },
  fat:          { text: "脂質が目標を超えています。揚げ物や脂の多い肉は控えめに。",                   iconKey: "fat", warn: true },
  salt:         { text: "食塩相当量が目標を超えています。汁物や加工食品は控えめに。",                 iconKey: "salt", warn: true },
  carb:         { text: "炭水化物が目標を超えています。主食の量を少し調整してみましょう。",           iconKey: "carb", warn: true },
  saturatedFat: { text: "飽和脂肪酸が目標を超えています。揚げ物やバター、脂身の多い肉は控えめに。", iconKey: "saturatedFat", warn: true },
};

function buildAdvice(consumed, targets) {
  const items = [];

  // 摂りすぎ警告（優先度高め）
  ["calories", "salt", "fat", "carb", "saturatedFat"].forEach((key) => {
    const c = consumed[key] || 0;
    const t = targets[key];
    if (t && key === "calories" && c > t * 1.05) items.push(OVER_WARN.calories);
    else if (t && key !== "calories" && c > t) items.push(OVER_WARN[key]);
  });

  // 不足アドバイス
  Object.keys(ADVICE_FOOD).forEach((key) => {
    const c = consumed[key] || 0;
    const t = targets[key];
    if (t && c < t * 0.6) items.push(ADVICE_FOOD[key]);
  });

  if (items.length === 0) {
    items.push({ text: "ここまでの食事は栄養バランスが良好です。この調子で続けましょう！", iconKey: "check" });
  }
  return items.slice(0, 5);
}
