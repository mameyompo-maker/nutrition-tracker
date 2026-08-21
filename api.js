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

const ANALYSIS_PROMPT = `あなたは経験豊富な管理栄養士です。添付された画像を見て、次の手順で栄養価を求めてください。

【手順】
1. まず、画像の中に「栄養成分表示」「成分表(目安)」のような、エネルギー・たんぱく質・脂質・炭水化物・食塩相当量などの数値が印刷/表示された表やラベルが写っていないか確認してください。
   これは実際の料理の写真そのものだけでなく、宅配弁当・社食・コンビニ食品のアプリ画面やパッケージのスクリーンショットである場合も含みます。
2. そのような数値表示が見つかった場合は、あなた自身で推定するのではなく、そこに書かれている数値をできるだけ正確に読み取って使ってください。表示されていない栄養素(食物繊維・ビタミン・ミネラル類など)だけ、料理の内容から一般的な値を推定してください。この場合 "source" は "label" にしてください。
3. そのような数値表示が見つからない場合は、写っている料理・食品を特定し、写真全体（1食分）の栄養価をあなたの知識から推定してください。この場合 "source" は "estimate" にしてください。

必ず次のJSON形式のみで出力してください。前置きや説明文、コードブロックの記法(\`\`\`)は一切つけないでください。

{
  "items": [ { "name": "料理名や食品名", "amount": "推定量(例: 茶碗1杯・150g など)" } ],
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
  "note": "写真から判断しづらかった点があれば一言(なければ空文字)"
}

数値はすべて画像に対応する食事全体の合計値とし、単位はすべて上記の通りにしてください。分からない栄養素も、一般的な料理の標準的な値から最善の推定値を入れてください。null・空文字・文字列は使わず、必ず半角の数値を入れてください（0にしないでください）。`;

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
async function analyzeWithGemini({ dataUrl, apiKey, model }) {
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
            { text: ANALYSIS_PROMPT },
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
async function analyzeWithAnthropic({ dataUrl, apiKey, model }) {
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
            { type: "text", text: ANALYSIS_PROMPT },
          ],
        },
      ],
    }
  );

  const text = (data.content || []).map((b) => b.text || "").join("");
  return normalizeAnalysisResult(extractJson(text));
}

// OpenAI および OpenAI互換API (OpenRouter / Groq / ローカルサーバーなど)
async function analyzeWithOpenAiCompatible({ dataUrl, apiKey, model, baseUrl, providerId }) {
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
            { type: "text", text: ANALYSIS_PROMPT },
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

async function analyzeFoodPhoto({ dataUrl, profile }) {
  const cfg = getAiConfig(profile);
  if (!cfg.apiKey) throw new ApiKeyError("APIキーが設定されていません");
  return cfg.provider.analyze({
    dataUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    providerId: cfg.providerId,
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
        .map((it) => ({ name: String(it.name ?? ""), amount: String(it.amount ?? "") }))
    : [];

  return {
    items,
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
