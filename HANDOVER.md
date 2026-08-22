# HANDOVER — 食事栄養トラッカー

最終更新: 2026-08-22(v3.0 大改修まで反映)

## 目的

食事の写真を撮ると、AIが栄養素を推定し、その日に必要な栄養量と比較してくれるPWA。
**絶対に無料で運用する**ことが Kazさんの最優先条件。

## 現在の状態: 公開済み・動作確認済み(v3.0)

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
4. **外部ライブラリを一切読み込まない。** グラフも自前のインラインSVG(`charts.js`)。
   Webフォントも無し。CDNに依存しないので、外部の課金・障害・追跡が入り込まない。

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

## 画面設計

Appleのヒューマンインターフェイスの考え方に寄せてある。

- 面はほぼ無彩色(`#F5F5F7` / `#FFFFFF`、ダークは `#000` / `#1C1C1E`)。
  アクセントはこのアプリの緑(`--accent`)。
- **色を足してよいのはデータだけ。** たんぱく質=systemBlue / 脂質=systemYellow /
  炭水化物=systemTeal を `--c-protein` などのトークンで持ち、**グラフ・バー・ドットにのみ**
  使う。画面の飾りに使わないこと。状態色は超過(オレンジ)と破壊的操作(赤)だけ。
- ダークモード対応。`prefers-color-scheme` でトークンを差し替える
  (`#3F6B42` は黒背景では暗すぎて読めないので明るい緑にする)。
- Webフォントは読み込まない。SF Pro → Inter → ヒラギノ角ゴ の順に落ちる。
  大きな数値だけ New York(`--font-serif`)。**日本語には serif を当てない**
  (明朝になってAppleらしさから外れる)。
- 角丸は 10 / 12 / 16 / 22px のみ。`@supports (corner-shape: squircle)` で本物にしている。
- **区切り線は `.list > *:not(:first-child)::before` の1本のルールで引く。**
  行の種類の組み合わせごとに `+` セレクタを書くと必ず抜けが出る(一度それで失敗した)。
  行の先頭にアイコンがある場合だけ `--sep-inset` を上書きする(`.with-icon` 60px /
  `.with-thumb` 76px)。続きものの行には `.no-sep` を付ける。
  食事区分の小見出しの直下だけは `.list-subhead + .no-sep-wrap::before` で線を消す。

### 気をつける点

- **オンボーディングの手順送り(`gotoObStep`)は再描画しない。** `render()` を呼ぶと
  入力途中の値が消えるため、DOMのクラス付け替えだけで切り替えている。
- `applyProviderUi()` は `[data-role=provider-select]` を目印に動く。
  **`selectRow()` に `data-role` を渡し忘れると、ラベルもモデル名も空のまま無言で壊れる**
  (実際に一度やった)。
- 行の中身は `<span>` なので、`.row-label` / `.row-sub` / `.feature .ft` などには
  `display: block` が要る。付け忘れると1行に繋がって出る。
- **セグメントコントロールの選択中の面は `--seg-on` トークンで持つ。**
  ダークで `var(--surface)` を使うと、黒い画面の上ではトラックと同色になって選択が
  消え、パネルの上では逆にトラックより暗く沈む。不透明の `#636366` で両方解決している。
- **ボタンを横に2つ並べるときは、390px幅でラベルが折り返さないか必ず確認する。**
  「写真なしで記録」は2行になったので「手入力」に縮め、説明は下の脚注に逃がした。

## ファイルの役割

- `api.js` — **プロバイダ定義(`PROVIDERS`)と手順書(`PROVIDER_GUIDES`)はここ。**
  AIを追加/変更するならこのファイル。
  `analyzeWithGemini` / `analyzeWithAnthropic` / `analyzeWithOpenAiCompatible` の3系統。
- `app.js` — 画面描画とイベント。`applyProviderUi()` が、選ばれたAIに応じて
  ラベル・プレースホルダ・キー発行リンク・モデル候補・ベースURL欄の出し分けをする。
  `formScratch` は、AIサービスを切り替えたときに入力途中の値を失わないための一時置き場。
- `nutrition.js` — 必要栄養量の計算(食事摂取基準2025年版)と `NUTRIENT_META`(21項目)。
- `charts.js` — グラフ。外部ライブラリを使わず、viewBox 320 基準のインラインSVGを
  文字列で組む。色はCSSクラス(`.ch-bar` など)に委ねてライト/ダークをCSS側で切り替える。
- `storage.js` — localStorage。プロフィール `nutriapp_profile_v1`、記録 `nutriapp_logs_v1`、
  体重 `nutriapp_weights_v1`、よく食べるもの `nutriapp_favs_v1`。日付ヘルパーもここ。
- `exif.js` — 撮影情報の読み取りと、写る範囲の実寸の計算。
- `sw.js` — **アセットを追加したら `ASSETS` と `CACHE_NAME` のバージョンを必ず更新する。**
  忘れると利用者に古いファイルが残る。現在 `nutriapp-shell-v7`。

## データ構造

### プロフィール(v2)

```js
{ age, sex, height, weight, activity, goal, menstruation,
  provider: "gemini",                        // gemini | anthropic | openai | custom
  apiKeys:  { gemini: "...", anthropic: "..." },   // プロバイダごとに保持
  models:   { gemini: "gemini-3.5-flash-lite" },
  baseUrls: { custom: "https://openrouter.ai/api/v1" } }
```

旧版(`apiKey` / `model` がトップレベル)は `app.js` の `loadProfile()` が自動で読み替える。

### 記録(1件)

```js
{ id, time: "07:40", name, meal: "breakfast|lunch|snack|dinner",
  items: [...], nutrients: {...21項目...}, note, thumb: "data:image/jpeg;base64,...",
  portion: { basis, reference, totalGrams }, source: "label|estimate", confidence }
```

`meal` は v3.0 で追加。**無い古い記録は `guessMeal(時刻)` で振り分けて表示する**ので、
移行処理は要らない(表示のたびに推測し、編集して保存すると `meal` が入る)。

## 容量の話(v3.0で対処済み)

localStorage はおよそ5MBしかなく、**写真をそのまま入れると数十件で溢れる**。

- 記録に残すサムネイルは `makeThumb()` で **最大360px・品質0.72** に縮めてから保存する。
  解析に送る画像(1024px)とは別物であることに注意。
- それでも `setItem` が失敗したときは、`Storage.setAllLogs()` が
  **古い日付の記録からサムネイルだけを外して**本文を守る。戻り値は
  `"ok" | "shed" | "fail"` で、`notifySaveResult()` が利用者に知らせる。
- 旧版が保存した大きなサムネイルは、起動1.6秒後に `migrateThumbs()` が裏で作り直す。

## 動作確認のやり方

構文チェックだけなら `node --check *.js`。
画面と操作までまとめて確かめるには、**プロジェクトを一時フォルダにコピーして
テスト用スクリプトを足す**(プロジェクト本体は汚さない)。

```bash
# 1) コピー先に seed.js(localStorageを仕込む)/ probe.js(操作を走らせて結果をDOMに書く)
#    / sheet.js(シートを開いた状態を作る)/ theme.js を置き、index.html に読み込ませる
# 2) 簡易サーバを立てる
python -m http.server 8903 --bind 127.0.0.1 &
# 3) ヘッドレスChromeで叩く
"C:/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu \
  --no-first-run --user-data-dir=<毎回新しい一時ディレクトリ> --hide-scrollbars \
  --window-size=560,1500 --virtual-time-budget=8000 --force-prefers-reduced-motion \
  --screenshot=<出力.png> "http://127.0.0.1:8903/index.html?view=trends"
```

踏んだ罠(繰り返さないこと):

- **`--user-data-dir` を必ず指定し、しかも毎回新しいディレクトリにする。**
  付けないと無言で何も出力しない。使い回すと前回のプロファイルと競合して固まる。
- **`--virtual-time-budget` を大きくしすぎるとChromeが終了しなくなる。**
  20000 では固まり、8000 なら安定して終わる(2026-08-22 に実測)。
- **テスト用コピーではサービスワーカーの登録を潰しておく**
  (`navigator.serviceWorker.register = () => Promise.resolve(null)`)。
  でないと前回キャッシュした古い `app.js` / `style.css` を返してきて、
  直したはずの不具合が直っていないように見える。
- **ウィンドウ幅には下限(およそ500px)があり、`--window-size=390` を指定しても
  レイアウトは約500px幅で組まれる。** 実機幅で見たいときは、幅390pxの `<iframe>` に
  アプリを読み込む `shot.html` を置いて、そちらを撮る。
- アニメーションの途中が写り込むので `--force-prefers-reduced-motion` を付ける。
- **ダークは `--force-dark-mode` でよい。** これで `prefers-color-scheme: dark` が
  真になり、こちらのトークンが正しく効くことを算出値で確認済み(2026-08-22)。

v3.0 では上記の仕組みで **80項目の操作テストを全通**させてある(ホーム表示・区分ごとの
小計・記録の編集/削除/取り消し・トレンドの各グラフ・週月切替・体重・履歴の検索・
よく食べるものの追加と取り消し・手入力・書き出し/読み込み・プロバイダ切替など)。

## 栄養の基準値

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

## 量の判定に撮影情報を使う

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

## アイコン

`scratchpad/make_icons.py` 相当のスクリプトをPILで書いて生成した(リング=達成率)。
再生成するときの注意: **PILの `arc(box, width=w)` は外接矩形から内側へ描くので、
線の中心は「外半径 - 幅/2」にある。** ここを取り違えると、端を丸めるために置く円が
リングから飛び出す(実際に一度やった)。
`icon-maskable-512.png` は角丸を付けず全面を塗り、リングを中央80%の安全領域に収める。

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
- **写真をIndexedDBへ**: localStorage の5MB制限を外せる。いまはサムネイルを縮めて
  凌いでいるが、記録が数百件を超えるなら移行を検討する。
- **通知**: 「昼食を記録しませんか」等のリマインダー。iOSのPWAでも通知は使えるが、
  利用者に許可を求めることになるので、要否から相談したい。
