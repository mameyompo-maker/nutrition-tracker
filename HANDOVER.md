# HANDOVER — 食事栄養トラッカー

最終更新: 2026-08-21

## 目的

食事の写真を撮ると、AIが栄養素を推定し、その日に必要な栄養量と比較してくれるPWA。
**絶対に無料で運用する**ことが Kazさんの最優先条件。

## 現在の状態: 公開済み・動作確認済み

- リポジトリ: https://github.com/mameyompo-maker/nutrition-tracker (public)
- 公開URL: https://mameyompo-maker.github.io/nutrition-tracker/
- **main へ push すると GitHub Pages が自動で再ビルドされる(= push が即本番デプロイ)。**
  ビルド完了まで30秒〜1分程度かかる。

## 出自

`https://github.com/yukikdtoto/yuki.Gitbox` (別アカウント・push権限なし) にあった
Anthropic API固定版を出発点に、**利用者自身のAIに接続する方式(BYOK)** へ作り替えたもの。
元リポジトリとは無関係の新規リポジトリで、こちらが本体。元は触らない。

## 無料である根拠(実測で確認済み・再調査不要)

1. **ホスティング**: GitHub Pages。無料アカウントでは **public リポジトリのみ** Pages を
   使える(private だと有料プランが必要)。だからこのリポジトリは public にしてある。
   記録データは端末のlocalStorageにしか無いので、公開しても個人情報は出ない。
2. **AI**: 開発者のAPIキーを一切持たない。利用者が自分のキーを設定画面に入れ、
   ブラウザから直接AIサービスを叩く。したがって**利用者が何人増えても開発者側の費用は0**。
3. **利用者側も無料にできる**: Google AI Studio の無料枠(クレジットカード不要)。
   2026-08-21 に実測で、写真の栄養成分表示を正確に読み取れることを確認済み。

## 技術メモ(調べ直さなくてよい実測結果)

- **CORS**: 以下はすべてブラウザから直接叩ける(2026-08-21 に preflight で確認)。
  - `generativelanguage.googleapis.com` … `Access-Control-Allow-Headers: content-type, x-goog-api-key`
  - `api.anthropic.com` … `anthropic-dangerous-direct-browser-access: true` ヘッダが必要
  - `api.openai.com` / `openrouter.ai` / `api.groq.com` … いずれも許可
- **Gemini は `responseMimeType: "application/json"` を付けると素直にJSONだけ返す。**
  21項目の栄養素すべてに数値が入り、null は出なかった(flash / flash-lite 双方)。
- **無料枠は混雑時に 503 を返す。** `gemini-3.5-flash` は3回連続で503→4回目で成功。
  `gemini-3.5-flash-lite` は一発で通り2.2秒。**既定を flash-lite にしてある。**
  `api.js` の `RETRY_DELAYS_MS`(3秒・7秒・12秒)で503を自動リトライする。
- **`gemini-2.5-flash` は新規ユーザーには提供終了**(404が返る)。モデル名を憶測で
  書かないこと。利用可能なモデルは `tools/gemini_list_models.py` で確認できる。
- **モデル名の入力欄は自由入力(datalistは候補のみ)。** 各社のモデル交替が速いため、
  候補が古くなってもアプリを更新せずに利用者が最新名を入れれば動く、という設計。

## ファイルの役割

- `api.js` — **プロバイダ定義(`PROVIDERS`)はここ。** AIを追加/変更するならこのファイル。
  `analyzeWithGemini` / `analyzeWithAnthropic` / `analyzeWithOpenAiCompatible` の3系統。
- `app.js` — 画面描画とイベント。`applyProviderUi()` が、選ばれたAIに応じて
  ラベル・プレースホルダ・キー発行リンク・モデル候補・ベースURL欄の出し分けをする。
  `formScratch` は、AIサービスを切り替えたときに入力途中の値を失わないための一時置き場。
- `nutrition.js` — 必要栄養量の計算(Mifflin-St Jeor式)と `NUTRIENT_META`(21項目)。
- `storage.js` — localStorage。プロフィールは `nutriapp_profile_v1`、記録は `nutriapp_logs_v1`。
- `sw.js` — **アセットを追加したら `ASSETS` と `CACHE_NAME` のバージョンを必ず更新する。**
  忘れると利用者に古いファイルが残る。

## プロフィールのデータ構造(v2)

```js
{ age, sex, height, weight, activity, goal,
  provider: "gemini",                        // gemini | anthropic | openai | custom
  apiKeys:  { gemini: "...", anthropic: "..." },   // プロバイダごとに保持
  models:   { gemini: "gemini-3.5-flash-lite" },
  baseUrls: { custom: "https://openrouter.ai/api/v1" } }
```

旧版(`apiKey` / `model` がトップレベル)は `app.js` の `loadProfile()` が自動で読み替える。
この移行は動作確認済み。

## 動作確認のやり方

構文チェックだけなら `node --check api.js app.js sw.js`。
画面まで見るなら、ヘッドレスChromeでスクリーンショットが撮れる:

```bash
python -m http.server 8901 --bind 127.0.0.1 &
"C:/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --no-first-run --user-data-dir=<一時ディレクトリ> --hide-scrollbars \
  --window-size=560,1600 --virtual-time-budget=8000 \
  --screenshot=<出力先.png> "http://127.0.0.1:8901/index.html"
```

- **`--user-data-dir` を必ず指定すること。** 付けないと Chrome も Edge も無言で
  何も出力しない(2026-08-21 に踏んだ)。
- 画面遷移や設定フォームの操作を確かめたいときは、プロジェクトを一時フォルダへコピーし、
  そこに `state` を直接いじるテスト用HTMLを置いて撮る(プロジェクト本体は汚さない)。

## 未着手・今後の候補

Kazさんとまだ協議していない拡張案。勝手に実装しないこと。

- **バーコード読み取り**: `BarcodeDetector` API + Open Food Facts(APIキー不要・無料)で、
  市販食品を確実な実データで登録する。AIの推定より正確。日本の商品の収録率は要確認。
- **端末内AI**: Chrome の内蔵Prompt API(Gemini Nano)。キー不要・完全無料になるが、
  対応ブラウザが限られ、iPhoneでは使えない。
- **キーの暗号化保存**: 現在は localStorage に平文。パスフレーズでの暗号化は可能だが、
  毎回入力が要る分だけ使い勝手が落ちる。
- **記録のエクスポート/インポート**: 現在は端末を変えるとデータが移らない。
