// ---------------------------------------------------------------
// api.js
// 食事写真をAIに送り、栄養素を推定してもらう部分。
//
// このアプリはサーバーを持ちません。ブラウザから、利用者自身が用意した
// AIサービスのAPIを直接呼び出します（BYOK: Bring Your Own Key）。
// そのためAPIキーはこの端末のブラウザ内(localStorage)にのみ保存され、
// 開発者や第三者のサーバーには一切送信されません。
//
// ただし「ブラウザから直接APIキーを使う」方式は、そのブラウザ環境に
// アクセスできる人にはキーが見える形になります。共有PCなどでは
// 使用後にキーを削除することをおすすめします。
// ---------------------------------------------------------------

const ANALYSIS_PROMPT = `あなたは経験豊富な管理栄養士です。添付された画像から、その食事の栄養価を求めてください。

【手順1: 栄養成分表示がないか確認する】
画像の中に「栄養成分表示」「成分表(目安)」のような、エネルギー・たんぱく質・脂質・炭水化物・食塩相当量などの数値が印刷/表示された表やラベルが写っていないか確認してください。実際の料理の写真だけでなく、宅配弁当・社食・コンビニ食品のアプリ画面やパッケージのスクリーンショットである場合も含みます。
見つかった場合は、自分で推定せず、そこに書かれている数値をできるだけ正確に読み取って使ってください。表示のない栄養素(食物繊維・ビタミン・ミネラル類など)だけを料理の内容から推定します。この場合 "source" は "label" とし、手順2・3は省略してかまいません。

【手順2: 量を決める ← ここが最も重要】
栄養価の誤差は、料理の種類の取り違えよりも、量の見誤りによって生じます。「大盛りなのか、カメラを近づけただけなのか」を必ず区別してください。次の優先順位で、写っているものの実際の大きさを決めます。

(A) 別途「この写真の撮影情報」が与えられている場合は、それを最優先で使ってください。写る範囲の実寸(横◯cm)が示されていれば、料理や食器が画像の横幅の何割を占めるかを見て、実際の直径・長さをcmで求めます。
(B) 実寸が与えられていない場合は、写り込んでいる「大きさが分かっているもの」を探して基準にします。目安は次のとおりです。
    箸 21〜23cm / 割り箸 20〜21cm / ご飯茶碗 口径11〜12cm / 味噌汁椀 口径10.5〜12cm
    小皿 直径9〜12cm / 取り皿 15〜18cm / 大皿 23〜27cm / ラーメン丼 口径18〜21cm
    カレー皿 長径22〜24cm / 湯呑み 口径7〜8cm / マグカップ 口径8〜8.5cm
    500mLペットボトルと350mL缶 直径6.6cm / レンゲ 13〜15cm / カレースプーン 18〜19cm
    フォーク 19〜20cm / スマートフォン 幅7〜7.8cm / コンビニ弁当容器 20×14cm前後
    食パン6枚切り 一辺約12cm(1枚約60g) / 卵Mサイズ 長径約6cm(約60g)
(C) どちらも使えない場合に限り、一般的な一人前と仮定します。この場合 "confidence" は "low" にしてください。

決めた大きさから、料理ごとの重量(g)を見積もります。参考として、ご飯茶碗1杯(軽め120g/普通150g/大盛り250g)、食パン6枚切り1枚60g、ゆで麺1玉200〜230g、味噌汁1杯150〜180mL、鶏むね肉1枚200〜250g、生卵1個50g(可食部)。

【手順3: 栄養価を求める】
手順2で決めた重量をもとに、日本食品標準成分表の一般的な値から栄養価を計算してください。調理法(揚げる・炒める・茹でる)による油の吸収や水分の増減も考慮してください。この場合 "source" は "estimate" です。

【出力】
必ず次のJSON形式のみで出力してください。前置きや説明文、コードブロックの記法は一切つけないでください。

{
  "items": [ { "name": "料理名や食品名", "amount": "推定量(例: 茶碗1杯・直径18cmの皿に1人前 など)", "grams": 数値(その料理の推定重量g) } ],
  "portion": {
    "basis": "量をどう決めたか(例: 撮影情報の実寸から算出 / 写り込んだ箸を基準 / 一般的な一人前と仮定)",
    "reference": "基準にしたものと仮定した寸法(例: ご飯茶碗の口径を11.5cmと仮定)",
    "totalGrams": 数値(1食分の合計重量g)
  },
  "nutrients": {
    "calories": 数値(kcal),
    "protein": 数値(g),
    "fat": 数値(g),
    "carb": 数値(g),
    "fiber": 数値(g),
    "salt": 数値(g、食塩相当量),
    "saturatedFat": 数値(g、飽和脂肪酸),
    "calcium": 数値(mg),
    "iron": 数値(mg),
    "zinc": 数値(mg、亜鉛),
    "magnesium": 数値(mg、マグネシウム),
    "potassium": 数値(mg、カリウム),
    "vitaminA": 数値(µgRAE),
    "vitaminC": 数値(mg),
    "vitaminD": 数値(µg),
    "vitaminE": 数値(mg),
    "vitaminB1": 数値(mg),
    "vitaminB2": 数値(mg),
    "vitaminB6": 数値(mg),
    "vitaminB12": 数値(µg),
    "folate": 数値(µg、葉酸)
  },
  "source": "label" または "estimate",
  "confidence": "high" または "medium" または "low",
  "note": "量の判断で迷った点があれば一言(なければ空文字)"
}

数値はすべて画像に写っている食事全体の合計値とし、単位は上記のとおりにしてください。分からない栄養素も、その料理の標準的な値から最善の推定値を入れてください。null・空文字・文字列は使わず、必ず半角の数値を入れてください。`;

// 撮影情報が読み取れた場合は、指示文の末尾に付け足して渡す
function buildAnalysisPrompt(captureText) {
  if (!captureText) return ANALYSIS_PROMPT;
  return ANALYSIS_PROMPT +
    "\n\n【この写真の撮影情報】\n" +
    "写真そのものに記録されていた情報です。手順2でこれを最優先の手がかりにしてください。\n" +
    captureText;
}

class ApiKeyError extends Error {}
class ApiRequestError extends Error {}
class ApiParseError extends Error {}

// ---------------------------------------------------------------
// 対応プロバイダ定義
//
// モデル名は「候補」であり、入力欄は自由入力にしてあります。
// 各社のモデルは入れ替わりが速いため、候補が古くなった場合でも
// 利用者が最新のモデル名を直接入力すればそのまま動きます。
// ---------------------------------------------------------------

const PROVIDERS = {
  gemini: {
    label: "Google Gemini(無料枠あり・おすすめ)",
    shortLabel: "Google Gemini",
    keyLabel: "Google AI Studio APIキー",
    keyPlaceholder: "AIza...",
    keyUrl: "https://aistudio.google.com/apikey",
    keyUrlLabel: "aistudio.google.com/apikey",
    help: "Google AI Studio で無料のAPIキーを発行できます(クレジットカード不要)。無料枠のまま写真解析に使えます。無料枠では Flash Lite の方が混雑に強く、安定して動きます。",
    free: true,
    needsBaseUrl: false,
    defaultModel: "gemini-3.5-flash-lite",
    models: [
      "gemini-3.5-flash-lite",
      "gemini-3.5-flash",
      "gemini-flash-lite-latest",
      "gemini-flash-latest",
    ],
    analyze: analyzeWithGemini,
  },
  anthropic: {
    label: "Claude(Anthropic)",
    shortLabel: "Claude",
    keyLabel: "Anthropic APIキー",
    keyPlaceholder: "sk-ant-...",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyUrlLabel: "console.anthropic.com",
    help: "利用には事前のクレジット購入が必要です(無料枠はありません)。写真1枚あたりのコストはごく小さい程度です。",
    free: false,
    needsBaseUrl: false,
    defaultModel: "claude-sonnet-5",
    models: ["claude-sonnet-5", "claude-haiku-4-5", "claude-opus-5"],
    analyze: analyzeWithAnthropic,
  },
  openai: {
    label: "OpenAI(ChatGPT)",
    shortLabel: "OpenAI",
    keyLabel: "OpenAI APIキー",
    keyPlaceholder: "sk-...",
    keyUrl: "https://platform.openai.com/api-keys",
    keyUrlLabel: "platform.openai.com",
    help: "利用には事前のクレジット購入が必要です(無料枠はありません)。画像を読めるモデル名を入力してください。",
    free: false,
    needsBaseUrl: false,
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
    analyze: analyzeWithOpenAiCompatible,
  },
  custom: {
    label: "その他(OpenAI互換のサービス)",
    shortLabel: "OpenAI互換のサービス",
    keyLabel: "APIキー",
    keyPlaceholder: "sk-or-v1-... など",
    keyUrl: "https://openrouter.ai/keys",
    keyUrlLabel: "openrouter.ai/keys",
    help: "OpenRouter・Groq など、OpenAI互換のAPIを持つサービスに接続できます。OpenRouterにはモデル名の末尾が :free の無料モデルもあります。",
    free: true,
    needsBaseUrl: true,
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "",
    models: [],
    analyze: analyzeWithOpenAiCompatible,
  },
};

const DEFAULT_PROVIDER = "gemini";

function getProvider(id) {
  return PROVIDERS[id] || PROVIDERS[DEFAULT_PROVIDER];
}

// ---------------------------------------------------------------
// APIキーの取得手順(設定画面の「取得のしかた」から開く手順書)
//
// APIキーの取得は、初めての人がいちばんつまずくところなので、
// 画面を離れずに読める手順書をアプリの中に持たせている。
// ---------------------------------------------------------------

const PROVIDER_GUIDES = {
  gemini: {
    lead: "Googleアカウントがあれば、3分ほどで取得できます。クレジットカードの登録は必要ありません。",
    cost: { tone: "good", text: "無料。カード登録不要" },
    steps: [
      { text: "下のボタンから Google AI Studio のAPIキー画面を開きます。", link: { url: "https://aistudio.google.com/apikey", label: "APIキー画面を開く" } },
      { text: "Googleアカウントでログインします。普段お使いのアカウントで構いません。" },
      { text: "初回は利用規約の同意画面が出ます。内容を確認して同意してください。" },
      { text: "「APIキーを作成」(英語表示なら Create API key)を押します。" },
      { text: "プロジェクトを選ぶ画面が出たら、「新しいプロジェクトでAPIキーを作成」でかまいません。" },
      { text: "AIza で始まる長い文字列が表示されます。コピーボタンでコピーしてください。" },
      { text: "この画面に戻り、「APIキー」欄に貼り付けて「接続テスト」を押します。「接続できました」と出れば完了です。" },
    ],
    notes: [
      { tone: "warn", text: "「課金を有効にする / Set up Billing」は押さないでください。有効にするとそのプロジェクトの無料枠が無くなり、以後はすべて従量課金になります。" },
      { tone: "info", text: "無料枠には1日あたりの回数制限があります(Flash系でおおむね1日1,500回程度)。食事の記録に使う分には十分です。" },
      { tone: "info", text: "無料枠では、送信した内容がGoogleのサービス改善に使われる場合があります。食事の写真を送るのが気になる場合は、記録画面の「APIキーを使わない方法」をお使いください。" },
      { tone: "warn", text: "APIキーは他人に見せないでください。万一漏れたときは、同じ画面からそのキーを削除すれば無効にできます。" },
    ],
  },
  anthropic: {
    lead: "Claudeを提供するAnthropicのAPIです。無料枠は無く、先にクレジットを購入する必要があります。",
    cost: { tone: "paid", text: "有料。事前にクレジット購入が必要" },
    steps: [
      { text: "Anthropicのコンソールにアクセスし、アカウントを作成またはログインします。", link: { url: "https://console.anthropic.com/settings/keys", label: "APIキー画面を開く" } },
      { text: "「Create Key」でキーを作成します。" },
      { text: "sk-ant- で始まる文字列が表示されるのでコピーします。この画面を閉じると二度と表示されません。" },
      { text: "「Billing」からクレジットを購入します。これをしないとキーがあっても解析できません。" },
      { text: "この画面に戻り、「APIキー」欄に貼り付けて「接続テスト」を押します。" },
    ],
    notes: [
      { tone: "info", text: "写真1枚あたりの費用はごく小さい程度ですが、使った分だけ課金されます。" },
      { tone: "warn", text: "APIキーは他人に見せないでください。漏れたときは同じ画面から失効させてください。" },
    ],
  },
  openai: {
    lead: "ChatGPTを提供するOpenAIのAPIです。ChatGPTの有料プランとは別に、API用の支払い登録が必要です。",
    cost: { tone: "paid", text: "有料。事前にクレジット購入が必要" },
    steps: [
      { text: "OpenAIのプラットフォームにアクセスし、ログインします。", link: { url: "https://platform.openai.com/api-keys", label: "APIキー画面を開く" } },
      { text: "「Create new secret key」でキーを作成します。" },
      { text: "sk- で始まる文字列をコピーします。この画面を閉じると二度と表示されません。" },
      { text: "「Billing」から支払い方法を登録し、クレジットを購入します。" },
      { text: "この画面に戻り、「APIキー」欄に貼り付け、画像を読めるモデル名を入れて「接続テスト」を押します。" },
    ],
    notes: [
      { tone: "warn", text: "ChatGPT Plus の月額とAPIの料金は別会計です。Plusに入っていてもAPIは使えません。" },
      { tone: "warn", text: "APIキーは他人に見せないでください。漏れたときは同じ画面から失効させてください。" },
    ],
  },
  custom: {
    lead: "OpenAI互換のAPIを持つサービスなら、どれでも接続できます。ここでは無料モデルのある OpenRouter を例に説明します。",
    cost: { tone: "good", text: "サービス次第。OpenRouterには無料モデルあり" },
    steps: [
      { text: "OpenRouter のキー画面を開き、Googleアカウントなどでログインします。", link: { url: "https://openrouter.ai/keys", label: "APIキー画面を開く" } },
      { text: "「Create Key」でキーを作成し、表示された文字列をコピーします。" },
      { text: "「APIのベースURL」は https://openrouter.ai/api/v1 のままで構いません。" },
      { text: "モデル一覧から使いたいモデル名をコピーします。画像を読めるモデル(vision対応)を選んでください。", link: { url: "https://openrouter.ai/models", label: "モデル一覧を開く" } },
      { text: "この画面に戻り、キーとモデル名を貼り付けて「接続テスト」を押します。" },
    ],
    notes: [
      { tone: "info", text: "モデル名の末尾が :free のものは無料で使えます(1日の回数制限あり)。" },
      { tone: "info", text: "Groqやローカルで動かしているサーバーを使う場合は、ベースURLをそのサービスのものに変えてください。" },
      { tone: "warn", text: "画像に対応していないモデルを選ぶと、写真解析は失敗します。" },
    ],
  },
};

function getProviderGuide(id) {
  return PROVIDER_GUIDES[id] || PROVIDER_GUIDES[DEFAULT_PROVIDER];
}

// ---------------------------------------------------------------
// 画像処理
// ---------------------------------------------------------------

// 画像をリサイズ・圧縮してJPEGのbase64(データ部分のみ)を返す
function resizeImageToBase64(file, maxDim = 1024, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("画像の読み込みに失敗しました"));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve(dataUrl); // "data:image/jpeg;base64,xxxx"
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function dataUrlToParts(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (!m) throw new Error("画像形式の変換に失敗しました");
  return { mediaType: m[1], base64: m[2] };
}

// AIの返答からJSON部分だけを取り出す（前後に文章が混ざっても耐えるように）
function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new ApiParseError("AIの応答からJSONを取り出せませんでした");
  }
  const jsonStr = text.slice(start, end + 1);
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    throw new ApiParseError("AIの応答の解析に失敗しました");
  }
}

// ---------------------------------------------------------------
// 共通のHTTP処理
// ---------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 無料枠は混雑時に503を返すことがあるため、少し待って自動的に投げ直す
const RETRY_DELAYS_MS = [3000, 7000, 12000];

async function postJson(url, headers, body) {
  let resp;
  for (let attempt = 0; ; attempt++) {
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: Object.assign({ "content-type": "application/json" }, headers),
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new ApiRequestError("ネットワークエラー: APIに接続できませんでした。通信環境と、入力したURLをご確認ください。");
    }
    if (resp.status !== 503 || attempt >= RETRY_DELAYS_MS.length) break;
    await sleep(RETRY_DELAYS_MS[attempt]);
  }

  if (!resp.ok) {
    let detail = "";
    try {
      const errJson = await resp.json();
      detail = errJson?.error?.message || errJson?.message || "";
    } catch (e) {
      /* ignore */
    }
    if (resp.status === 401 || resp.status === 403) {
      throw new ApiKeyError("APIキーが正しくないか、権限がないようです。設定を確認してください。");
    }
    if (resp.status === 400 && /api.?key/i.test(detail)) {
      throw new ApiKeyError("APIキーが正しくないようです。設定を確認してください。");
    }
    if (resp.status === 404) {
      throw new ApiRequestError(`モデルが見つかりません(404)。モデル名をご確認ください。${detail ? " " + detail : ""}`);
    }
    if (resp.status === 429) {
      throw new ApiRequestError("利用上限に達しました。しばらく待つか、日をあらためてお試しください。");
    }
    if (resp.status === 503) {
      throw new ApiRequestError("AIサービスが混雑しています(何度か試しましたが応答がありません)。少し待ってからもう一度お試しください。Geminiをお使いの場合、モデルを gemini-3.5-flash-lite にすると通りやすくなります。");
    }
    throw new ApiRequestError(`APIエラー(${resp.status}): ${detail || "しばらくしてから再度お試しください"}`);
  }

  return resp.json();
}

// ---------------------------------------------------------------
// プロバイダ別の呼び出し
// ---------------------------------------------------------------

// Google Gemini (Google AI Studio) — 無料枠あり
async function analyzeWithGemini({ dataUrl, apiKey, model, captureText }) {
  const { mediaType, base64 } = dataUrlToParts(dataUrl);
  const m = model || PROVIDERS.gemini.defaultModel;
  const data = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`,
    { "x-goog-api-key": apiKey },
    {
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mediaType, data: base64 } },
            { text: buildAnalysisPrompt(captureText) },
          ],
        },
      ],
      generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
    }
  );

  const cand = data?.candidates?.[0];
  if (!cand) {
    const blocked = data?.promptFeedback?.blockReason;
    throw new ApiParseError(blocked ? `AIが応答を返しませんでした(${blocked})` : "AIが応答を返しませんでした");
  }
  const text = (cand.content?.parts || []).map((p) => p.text || "").join("");
  return normalizeAnalysisResult(extractJson(text));
}

// Anthropic (Claude)
async function analyzeWithAnthropic({ dataUrl, apiKey, model, captureText }) {
  const { mediaType, base64 } = dataUrlToParts(dataUrl);
  const data = await postJson(
    "https://api.anthropic.com/v1/messages",
    {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    {
      model: model || PROVIDERS.anthropic.defaultModel,
      max_tokens: 1536,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: buildAnalysisPrompt(captureText) },
          ],
        },
      ],
    }
  );

  const text = (data.content || []).map((b) => b.text || "").join("");
  return normalizeAnalysisResult(extractJson(text));
}

// OpenAI および OpenAI互換API (OpenRouter / Groq / ローカルサーバーなど)
async function analyzeWithOpenAiCompatible({ dataUrl, apiKey, model, baseUrl, providerId, captureText }) {
  const base = (baseUrl || getProvider(providerId).baseUrl || "").replace(/\/+$/, "");
  if (!base) throw new ApiRequestError("APIのベースURLが設定されていません。設定を確認してください。");
  if (!model) throw new ApiRequestError("モデル名が設定されていません。設定を確認してください。");

  const data = await postJson(
    `${base}/chat/completions`,
    { authorization: `Bearer ${apiKey}` },
    {
      model,
      max_tokens: 1536,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: dataUrl } },
            { type: "text", text: buildAnalysisPrompt(captureText) },
          ],
        },
      ],
    }
  );

  const text = data?.choices?.[0]?.message?.content || "";
  if (!text) throw new ApiParseError("AIが応答を返しませんでした");
  return normalizeAnalysisResult(extractJson(text));
}

// ---------------------------------------------------------------
// 入口
// ---------------------------------------------------------------

// プロフィールから、いま使う接続設定を取り出す
function getAiConfig(profile) {
  const providerId = profile?.provider || DEFAULT_PROVIDER;
  const provider = getProvider(providerId);
  return {
    providerId,
    provider,
    apiKey: (profile?.apiKeys?.[providerId] || "").trim(),
    model: (profile?.models?.[providerId] || provider.defaultModel || "").trim(),
    baseUrl: (profile?.baseUrls?.[providerId] || provider.baseUrl || "").trim(),
  };
}

async function analyzeFoodPhoto({ dataUrl, profile, captureText }) {
  const cfg = getAiConfig(profile);
  if (!cfg.apiKey) throw new ApiKeyError("APIキーが設定されていません");
  return cfg.provider.analyze({
    dataUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    providerId: cfg.providerId,
    captureText,
  });
}

// 小さな画像を送って、キーとモデル名が正しいかを確かめる（接続テスト用）
const TEST_IMAGE_DATA_URL =
  "data:image/jpeg;base64," +
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdB" +
  "RkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09P" +
  "T09PT09PT09PT09PT0//wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA" +
  "AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6" +
  "Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG" +
  "x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREA" +
  "AgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5" +
  "OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPE" +
  "xcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDrKKKKAP/Z";

async function testAiConnection(profile) {
  const cfg = getAiConfig(profile);
  if (!cfg.apiKey) throw new ApiKeyError("APIキーが入力されていません");
  try {
    await cfg.provider.analyze({
      dataUrl: TEST_IMAGE_DATA_URL,
      apiKey: cfg.apiKey,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      providerId: cfg.providerId,
    });
  } catch (e) {
    // 真っ白な小さい画像なので、AIが戸惑ってJSONを崩すことがある。
    // その場合も「接続そのものはできている」ので成功扱いにする。
    if (e instanceof ApiParseError) return true;
    throw e;
  }
  return true;
}

// ---------------------------------------------------------------
// 応答の正規化
// ---------------------------------------------------------------

// APIレスポンス・手動貼り付けテキストの両方で共通して使う正規化処理
function normalizeAnalysisResult(parsed) {
  const nutrients = {};
  Object.keys(NUTRIENT_META).forEach((k) => {
    const v = Number(parsed?.nutrients?.[k]);
    nutrients[k] = Number.isFinite(v) ? Math.round(v * 10) / 10 : 0;
  });

  const items = Array.isArray(parsed?.items)
    ? parsed.items
        .filter((it) => it && typeof it === "object")
        .map((it) => {
          const g = Number(it.grams);
          return {
            name: String(it.name ?? ""),
            amount: String(it.amount ?? ""),
            grams: Number.isFinite(g) && g > 0 ? Math.round(g) : null,
          };
        })
    : [];

  const rawPortion = parsed?.portion && typeof parsed.portion === "object" ? parsed.portion : {};
  const totalGrams = Number(rawPortion.totalGrams);
  const portion = {
    basis: String(rawPortion.basis ?? ""),
    reference: String(rawPortion.reference ?? ""),
    totalGrams: Number.isFinite(totalGrams) && totalGrams > 0 ? Math.round(totalGrams) : null,
  };

  return {
    items,
    portion,
    nutrients,
    source: parsed?.source === "label" ? "label" : "estimate",
    confidence: parsed?.confidence || "medium",
    note: parsed?.note || "",
  };
}

// APIキーを使わず、ChatGPT・Claude・Geminiなどのチャット画面に手動で貼り付けて
// 得たテキスト回答からJSONを取り出して解析する(完全無料・キー不要)
function parseManualAnalysisText(text) {
  if (!text || !text.trim()) {
    throw new ApiParseError("貼り付けられたテキストが空です。");
  }
  return normalizeAnalysisResult(extractJson(text));
}
