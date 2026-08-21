# HANDOVER — 食事栄養トラッカー

最終更新: 2026-08-21(UI刷新まで反映)

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

## 画面設計(2026-08-21に全面刷新)

Appleのヒューマンインターフェイスの考え方に寄せてある。**色と機能は据え置き**で、
組み方・余白・字組み・部品だけを入れ替えた、というのが刷新の趣旨。

- アクセントはこのアプリの緑ただ一色(`--accent`)。面はほぼ無彩色(`#F5F5F7` / `#FFFFFF`)。
  **色数を増やさないこと。** 状態を示すのは超過(オレンジ)と破壊的操作(赤)だけ。
- ダークモード対応。`prefers-color-scheme` で `--accent` を明るい緑に差し替える
  (`#3F6B42` は黒背景では暗すぎて読めないため)。
- Webフォントは読み込まない。SF Pro → Inter → ヒラギノ角ゴ の順に落ちる。
  大きな数値だけ New York(`--font-serif`)。**日本語には serif を当てない**
  (明朝になってAppleらしさから外れる)。
- 角丸は 10 / 12 / 16 / 22px のみ。`@supports (corner-shape: squircle)` で本物にしている。
- **区切り線は `.list > *:not(:first-child)::before` の1本のルールで引く。**
  行の種類の組み合わせごとに `+` セレクタを書くと必ず抜けが出る(一度それで失敗した)。
  行の先頭にアイコンがある場合だけ `--sep-inset` を上書きする(`.with-icon` 60px /
  `.with-thumb` 76px)。続きものの行には `.no-sep` を付ける。

### APIキーの手順書

初めての人がいちばんつまずくのがキーの取得なので、画面を離れずに読める手順書を
アプリの中に持たせてある。

- 文言は `api.js` の `PROVIDER_GUIDES`(サービスごと)。**画面側ではなくここを直す。**
- キー入力欄の右の「取得のしかた」と、設定タブの行から開く。中身はシート(`openSheet`)。
- `formatGuideText()` が URL とキーの接頭辞を `<code>` にする。**1回の置換で処理している**
  ので、`sk-ant-` を `sk-` より先に並べる順序を崩さないこと(崩すと入れ子になる)。

### 気をつける点

- **オンボーディングの手順送り(`gotoObStep`)は再描画しない。** `render()` を呼ぶと
  入力途中の値が消えるため、DOMのクラス付け替えだけで切り替えている。
- `applyProviderUi()` は `[data-role=provider-select]` を目印に動く。
  **`selectRow()` に `data-role` を渡し忘れると、ラベルもモデル名も空のまま無言で壊れる**
  (実際に一度やった)。
- 行の中身は `<span>` なので、`.row-label` / `.row-sub` / `.feature .ft` などには
  `display: block` が要る。付け忘れると1行に繋がって出る。

## ファイルの役割

- `api.js` — **プロバイダ定義(`PROVIDERS`)と手順書(`PROVIDER_GUIDES`)はここ。**
  AIを追加/変更するならこのファイル。
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
- **ウィンドウ幅には下限(およそ500px)があり、`--window-size=390` を指定しても
  レイアウトは約500px幅で組まれる。** スクリーンショットだけが390pxで切り取られるため、
  「右端が切れている」ように見えて実際は正常、という紛らわしい状態になる。
  実機幅を確かめたいときは、テスト用HTMLで `#app{max-width:390px}` を当てる。
- アニメーションの途中が写り込むので `--force-prefers-reduced-motion` を付ける。
- ダークモードは `--force-dark-mode` で確認できる。

## 栄養の基準値(2026-08-21に全面差し替え)

**目標値は厚生労働省「日本人の食事摂取基準(2025年版)」策定検討会報告書からの転記。**
概算・丸めは入れていない。`nutrition.js` の表だけを差し替えれば改定に追従できる。

- エネルギー = 基礎代謝基準値(報告書 表3) × 体重 × 身体活動レベル(表5)。
  **参照体重を入れると報告書のEER表と男女×5区分×3レベルの28通りすべてが一致する**
  ことを検算済み。表を触ったらこの検算をやり直すこと。
- 2020年版から変わっている点があるので、**古い記憶で書き換えないこと**。実測で確認した例:
  ビタミンB12は推奨量2.4µg → **目安量4.0µg**、ビタミンDは8.5µg → **9.0µg**。
- 身体活動レベルは年齢区分で違う。18〜64は1.50/1.75/2.00、65〜74は1.50/1.70/1.90、
  **75以上は「高い」が設定されていない**(1.40/1.70のみ)ので「ふつう」で代替している。
- 鉄だけ女性で月経の有無により推奨量が分かれる(65歳以上には「月経あり」の値が無い)。
  そのためプロフィールに `menstruation` を持たせ、18〜64歳の女性にのみ欄を出している。

### 一次資料の読み方(次に調べるときの近道)

- 報告書トップ: https://www.mhlw.go.jp/stf/newpage_44138.html
  各論は章ごとに分割PDFがある(エネルギーは `/content/10904750/001316461.pdf`)。
- **厚労省のPDFはテキスト抽出すると文字化けする**(ToUnicodeが壊れていて、日本語が
  Bengali系のコードポイントで出てくる)。`page.get_pixmap(dpi=150)` でPNGにして
  画像として読むこと。数値表はこれで問題なく読める。
- 一方、同文書院の早見表PDF(`https://www.dobun.co.jp/scbookdata/stofcj2025.pdf`)は
  テキストが素直に抽出でき、栄養素別の表がまとまっている。数値の転記はこちらが速い。
  ただし基礎代謝基準値は載っていないので、そこだけ公式PDFの画像から読む。

## 量の判定に撮影情報を使う(2026-08-21)

`exif.js` がJPEGのAPP1からEXIFを読み、**写る範囲の実寸まで計算して** `api.js` の
指示文に足す。ここがこのアプリの肝。

- 計算: 写る横幅 / 被写体距離 = 36mm / 35mm換算焦点距離。
  例) 35mm換算24mm・距離0.33m → 横 49.5cm。検算済み。
- **GPSのIFDは意図的に読まない。** 食事の写真から自宅が割れるため。ここは緩めないこと。
- **RATIONAL(型5)だけでなく FLOAT(11)/DOUBLE(12) にも対応させてある。**
  実機はRATIONALだが、書き出しソフトによってはDOUBLEで書く(PILがそうだった)。
  型を絞ると焦点距離と被写体距離だけ静かに読めなくなり、気づきにくい。
- キャンバスで縮小するとEXIFは消えるので、**必ず元のFileから読むこと**。
- テスト用のEXIF付きJPEGはPILで作れる。`IFDRational` を使わないとDOUBLEになる。

## 未着手・今後の候補

Kazさんとまだ協議していない拡張案。勝手に実装しないこと。

- **耐容上限量(UL)の警告**: 報告書にはビタミンA 2,700µgRAE、カルシウム2,500mgなどの
  上限がある。摂りすぎ警告に使えるが、数値の転記が追加で必要。
- **バーコード読み取り**: `BarcodeDetector` API + Open Food Facts(APIキー不要・無料)で、
  市販食品を確実な実データで登録する。AIの推定より正確。日本の商品の収録率は要確認。
- **端末内AI**: Chrome の内蔵Prompt API(Gemini Nano)。キー不要・完全無料になるが、
  対応ブラウザが限られ、iPhoneでは使えない。
- **キーの暗号化保存**: 現在は localStorage に平文。パスフレーズでの暗号化は可能だが、
  毎回入力が要る分だけ使い勝手が落ちる。
- **記録のエクスポート/インポート**: 現在は端末を変えるとデータが移らない。
