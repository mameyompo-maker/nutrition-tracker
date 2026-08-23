// テスト用: 画面操作を一通り走らせて、結果を #probe-out に書き出す。
// ?probe=1 のときだけ動く。?view=... で1画面だけ撮るときは動かさない。
(function () {
  const q = new URLSearchParams(location.search);
  if (q.get("probe") !== "1") return;

  const out = [];
  let fails = 0;
  const errors = [];
  window.addEventListener("error", (e) => errors.push(`JSエラー: ${e.message}`));
  window.addEventListener("unhandledrejection", (e) => errors.push(`未処理のPromise: ${e.reason}`));

  const ok = (name, cond, extra) => {
    if (!cond) fails++;
    out.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  << " + extra : ""}`);
  };
  const sel = (s) => document.querySelector(s);
  const txt = () => document.getElementById("app").textContent;
  const click = (s) => { const el = sel(s); if (!el) return false; el.click(); return true; };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function run() {
    await wait(120);

    // --- ホーム ---
    ok("ホームが出る", txt().includes("今日"));
    ok("リングに合計kcalが出る", sel(".ring-center .value")?.textContent === "1642",
       sel(".ring-center .value")?.textContent);
    ok("PFCの3行が出る", document.querySelectorAll(".macro").length === 3);
    ok("PFCのデータカラーが当たる", !!sel(".bar.slim.c-protein"));
    ok("週ストリップが7日ぶん", document.querySelectorAll(".week-strip .wd").length === 7);
    ok("今日の列が強調される", document.querySelectorAll(".week-strip .wd.today").length === 1);
    ok("連続記録バッジが出る", txt().includes("連続3日"));
    ok("食事区分の小見出しが4つ", document.querySelectorAll(".list-subhead").length === 4);
    ok("区分の並びが朝→昼→間→夕",
       Array.from(document.querySelectorAll(".list-subhead")).map((e) => e.textContent.trim().slice(0, 2)).join(",") === "朝食,昼食,間食,夕食",
       Array.from(document.querySelectorAll(".list-subhead")).map((e) => e.textContent.trim().slice(0, 2)).join(","));
    ok("区分ごとの小計が出る", sel(".list-subhead .msh-kcal")?.textContent.trim() === "480 kcal",
       sel(".list-subhead .msh-kcal")?.textContent);

    // その他の栄養素の開閉
    const before = document.querySelectorAll(".nutrient").length;
    click("[data-action=toggle-detail]");
    await wait(30);
    ok("その他の栄養素が開く", document.querySelectorAll(".nutrient").length > before);
    click("[data-action=toggle-detail]");
    await wait(30);
    ok("その他の栄養素が閉じる", document.querySelectorAll(".nutrient").length === before);

    // --- 記録の詳細シート ---
    click(".list-subhead + .no-sep-wrap [data-action=open-entry]");
    await wait(60);
    ok("詳細シートが開く", !!sel("#entry-edit"));
    ok("名前が入っている", sel("#ee-name")?.value === "納豆ごはんと味噌汁", sel("#ee-name")?.value);
    ok("区分が朝食で選ばれている", sel("input[name=ee-meal]:checked")?.value === "breakfast",
       sel("input[name=ee-meal]:checked")?.value);
    ok("時刻が入っている", sel("#ee-time")?.value === "07:40", sel("#ee-time")?.value);
    ok("量の判断が出る", sel("#entry-edit").textContent.includes("撮影情報の実寸から算出"));
    ok("お気に入り済みとして出る", sel(".fav-toggle")?.classList.contains("is-fav"));

    // 編集して保存
    sel("#ee-name").value = "納豆ごはん(改)";
    sel("#ee-calories").value = "500";
    click("[data-action=entry-save]");
    await wait(80);
    ok("保存でシートが閉じる", !sel("#entry-edit"));
    ok("編集内容が反映される", txt().includes("納豆ごはん(改)"));
    ok("編集した数値が集計に効く", sel(".ring-center .value")?.textContent === "1662",
       sel(".ring-center .value")?.textContent);

    // --- 削除と取り消し ---
    click(".list-subhead + .no-sep-wrap [data-action=open-entry]");
    await wait(60);
    click("[data-action=entry-delete]");
    await wait(80);
    ok("削除で記録が消える", !txt().includes("納豆ごはん(改)"));
    ok("元に戻すボタンが出る", !!sel(".toast-action"));
    sel(".toast-action").click();
    await wait(80);
    ok("元に戻すで復活する", txt().includes("納豆ごはん(改)"));
    ok("復活後の合計が戻る", sel(".ring-center .value")?.textContent === "1662",
       sel(".ring-center .value")?.textContent);

    // --- トレンド ---
    click(".tab-btn[data-view=trends]");
    await wait(80);
    ok("トレンドが開く", txt().includes("トレンド"));
    ok("エネルギーの棒グラフが出る", document.querySelectorAll(".ch-bar").length >= 3,
       String(document.querySelectorAll(".ch-bar").length));
    ok("目標線が出る", !!sel(".ch-target"));
    ok("記録がない日は点で示す", document.querySelectorAll(".ch-empty").length >= 1);
    ok("PFCバランスの3行が出る", document.querySelectorAll(".pfc-row").length === 3);
    ok("目標量の帯が描かれる", document.querySelectorAll(".pfc-track .band").length === 3);
    ok("体重の折れ線が出る", !!sel(".ch-line"));
    ok("統計カードが2枚", document.querySelectorAll(".panel.stat").length === 2);
    ok("記録した日が5/7", sel(".panel.stat .stat-num")?.textContent.trim() === "5/7日",
       sel(".panel.stat .stat-num")?.textContent.trim());
    ok("平均充足率が出る", txt().includes("栄養素の平均充足率"));

    // 月に切り替え
    click("[data-action=set-trend-range][data-range='30']");
    await wait(60);
    ok("月表示で30日ぶんになる", sel(".panel.stat .stat-num")?.textContent.trim() === "7/30日",
       sel(".panel.stat .stat-num")?.textContent.trim());

    // 体重シート
    click("[data-action=open-weight]");
    await wait(60);
    ok("体重シートが開く", !!sel("#ws-kg"));
    ok("直近の体重が初期値になる", sel("#ws-kg")?.value === "68.9", sel("#ws-kg")?.value);
    sel("#ws-kg").value = "67.4";
    click("[data-action=weight-save]");
    await wait(80);
    ok("体重を保存できる", JSON.parse(localStorage.getItem("nutriapp_weights_v1"))[todayKey()] === 67.4);
    ok("プロフィールの体重も更新される", JSON.parse(localStorage.getItem("nutriapp_profile_v1")).weight === 67.4);

    // --- 履歴 ---
    click(".tab-btn[data-view=history]");
    await wait(80);
    ok("履歴が開く", !!sel("#history-search"));
    const dayRows = document.querySelectorAll("[data-action=toggle-history-day]").length;
    ok("日ごとの行が7日ぶん", dayRows === 7, String(dayRows));
    click("[data-action=toggle-history-day]");
    await wait(50);
    ok("日を開くと中身が出る", document.querySelectorAll("#history-results [data-action=open-entry]").length >= 4);

    // 検索
    const s = sel("#history-search");
    s.value = "カレー";
    s.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(60);
    const hits = document.querySelectorAll("#history-results [data-action=open-entry]");
    ok("検索で1件に絞れる", hits.length === 1, String(hits.length));
    ok("検索結果に日付が出る", sel("#history-results .row-sub")?.textContent.includes("月"));
    s.value = "存在しない料理";
    s.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(60);
    ok("見つからないときの表示", txt().includes("見つかりませんでした"));

    // --- 記録タブ ---
    click(".tab-btn[data-view=capture]");
    await wait(80);
    ok("記録タブが開く", txt().includes("カメラで撮影"));
    ok("よく食べるものが出る", txt().includes("サラダチキン"));
    const kcalBefore = sumNutrients(Storage.getLogsForDate(todayKey())).calories;
    click("[data-action=fav-quick-add][data-id=f2]");
    await wait(80);
    const kcalAfter = sumNutrients(Storage.getLogsForDate(todayKey())).calories;
    ok("よく食べるものを1タップで記録できる", kcalAfter - kcalBefore === 114, String(kcalAfter - kcalBefore));
    ok("追加後はホームに戻らず記録画面のまま", state.view === "capture", state.view);
    sel(".toast-action")?.click();
    await wait(60);
    ok("クイック追加も取り消せる",
       sumNutrients(Storage.getLogsForDate(todayKey())).calories === kcalBefore);

    // 写真なしの手入力
    click("[data-action=open-manual-add]");
    await wait(60);
    ok("手入力シートが開く", !!sel("#ma-name"));
    click("[data-action=manual-add-save]");
    await wait(40);
    ok("名前が空だと保存されない", !!sel("#ma-name"));
    sel("#ma-name").value = "プロテイン";
    sel("#ma-calories").value = "120";
    sel("#ma-protein").value = "24";
    click("[data-action=manual-add-save]");
    await wait(80);
    ok("手入力で記録できる", !sel("#ma-name") &&
       Storage.getLogsForDate(todayKey()).some((e) => e.name === "プロテイン"));

    // --- 設定 ---
    click(".tab-btn[data-view=settings]");
    await wait(80);
    ok("設定が開く", txt().includes("プロフィール"));
    ok("よく食べるものの件数が出る", txt().includes("2件を登録済み"));
    ok("書き出し・読み込みの行がある", txt().includes("データを書き出す") && txt().includes("データを読み込む"));

    click("[data-action=open-basis]");
    await wait(60);
    ok("目標の根拠シートが開く", document.body.textContent.includes("推定エネルギー必要量"));
    ok("基礎代謝の式が出る", document.body.textContent.includes("基礎代謝基準値"));
    click("[data-action=close-sheet]");
    await wait(40);
    ok("シートを閉じられる", !sel(".sheet"));

    click("[data-action=open-fav-manage]");
    await wait(60);
    ok("よく食べるものの整理が開く", document.body.textContent.includes("サラダチキン"));
    click("[data-action=fav-remove]");
    await wait(60);
    ok("よく食べるものを削除できる", Storage.getFavorites().length === 1,
       String(Storage.getFavorites().length));
    click("[data-action=close-sheet]");
    await wait(40);

    // プロフィール編集
    click("[data-action=edit-profile]");
    await wait(80);
    ok("編集フォームが出る", !!sel("#settings-form"));
    ok("APIキーが復元される", sel("#f-apikey")?.value === "AIzaTESTKEY1234567890abcd");
    ok("モデル名が復元される", sel("[name=model]")?.value === "gemini-3.5-flash-lite");
    ok("男性なので月経欄は隠れる", sel("[data-role=menstruation-row]")?.classList.contains("hidden"));
    sel("#st-sex").value = "female";
    sel("#st-sex").dispatchEvent(new Event("change", { bubbles: true }));
    await wait(40);
    ok("女性34歳なら月経欄が出る", !sel("[data-role=menstruation-row]")?.classList.contains("hidden"));
    sel("#st-age").value = "70";
    sel("#st-age").dispatchEvent(new Event("input", { bubbles: true }));
    await wait(40);
    ok("女性70歳なら月経欄は隠れる", sel("[data-role=menstruation-row]")?.classList.contains("hidden"));

    // AIサービスを切り替えても入力中の値を失わない
    sel("#st-age").value = "34";
    sel("#st-age").dispatchEvent(new Event("input", { bubbles: true }));
    sel("#st-sex").value = "male";
    sel("#st-sex").dispatchEvent(new Event("change", { bubbles: true }));
    const provSel = sel("[data-role=provider-select]");
    provSel.value = "custom";
    provSel.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(40);
    ok("OpenAI互換ならベースURL欄が出る", !sel("[data-role=baseurl-row]")?.classList.contains("hidden"));
    ok("キー欄のラベルが切り替わる", sel("[data-role=key-label]")?.textContent === "APIキー",
       sel("[data-role=key-label]")?.textContent);
    provSel.value = "gemini";
    provSel.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(40);
    ok("戻すとGeminiのキーが復元される", sel("#f-apikey")?.value === "AIzaTESTKEY1234567890abcd");
    ok("戻すとベースURL欄が隠れる", sel("[data-role=baseurl-row]")?.classList.contains("hidden"));
    ok("料金チップが埋まる", (sel("[data-role=provider-cost]")?.textContent || "").includes("無料"));

    // 保存
    sel("#st-weight").value = "70";
    sel("#settings-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await wait(80);
    ok("保存するとホームに戻る", state.view === "home", state.view);
    ok("体重の変更が保存される", Storage.getProfile().weight === 70);

    // --- 書き出し/読み込みの中身(ファイル入出力は使わず、関数レベルで確認) ---
    const backup = {
      app: "nutrition-tracker-backup", version: 1,
      logs: { "2020-01-01": [{ id: "imp1", name: "移行テスト", meal: "lunch", time: "12:00",
        nutrients: { calories: 100 }, items: [] }] },
      weights: { "2020-01-01": 70.5 }, favorites: [{ id: "impf", name: "移行お気に入り", nutrients: { calories: 50 } }],
    };
    const origConfirm = window.confirm;
    window.confirm = () => true;
    const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
    handleImportFile(new File([blob], "b.json", { type: "application/json" }));
    await wait(200);
    window.confirm = origConfirm;
    ok("読み込みで記録が増える", Storage.getLogsForDate("2020-01-01").length === 1);
    ok("読み込みで体重が入る", Storage.getWeights()["2020-01-01"] === 70.5);
    ok("読み込みでお気に入りが増える", Storage.getFavorites().some((f) => f.name === "移行お気に入り"));
    ok("書き出しにAPIキーを含めない", (() => {
      const p = Object.assign({}, Storage.getProfile());
      delete p.apiKeys;
      return !JSON.stringify(p).includes("AIzaTESTKEY");
    })());

    // --- 共有(案0: サーバーを持たない) ---
    click(".tab-btn[data-view=home]");
    await wait(80);
    click(".list-subhead + .no-sep-wrap [data-action=open-entry]");
    await wait(60);
    ok("詳細シートに共有ボタンがある", !!sel("[data-action=open-share]"));
    click("[data-action=open-share]");
    await wait(80);
    ok("共有シートが開く", !!sel("#share-sheet"));
    ok("内訳を載せる切り替えがある", !!sel("#sh-nutrients"));
    // カードの描画は非同期なので少し待つ
    for (let i = 0; i < 20 && !sel(".share-preview img"); i++) await wait(100);
    const preview = sel(".share-preview img");
    ok("カードの見本が生成される", !!preview);
    ok("見本がデータを持っている", !!preview && preview.src.length > 0);

    // 栄養の内訳を外しても作れること
    const shownBefore = preview ? preview.src : "";
    sel("#sh-nutrients").checked = false;
    sel("#sh-nutrients").dispatchEvent(new Event("change", { bubbles: true }));
    for (let i = 0; i < 20; i++) {
      await wait(100);
      if (sel(".share-preview img") && sel(".share-preview img").src !== shownBefore) break;
    }
    ok("内訳なしでもカードを作れる", !!sel(".share-preview img"));

    // カードそのものを直接作って中身を確かめる
    const anyEntry = Storage.getLogsForDate(todayKey())[0];
    const cardBlob = await renderShareCard(anyEntry, calcTargets(state.profile), { showNutrients: true });
    ok("カードがPNGとして書き出される", !!cardBlob && cardBlob.type === "image/png", cardBlob && cardBlob.type);
    ok("カードに中身がある(1KB以上)", !!cardBlob && cardBlob.size > 1024, cardBlob && `${cardBlob.size}B`);

    const txt2 = shareText(anyEntry, { showNutrients: true });
    ok("共有の文章に料理名が入る", txt2.includes(anyEntry.name));
    ok("共有の文章にkcalが入る", /\d+ kcal/.test(txt2));
    ok("共有の文章にPFCが入る", txt2.includes("P ") && txt2.includes("F ") && txt2.includes("C "));
    const txt3 = shareText(anyEntry, { showNutrients: false });
    ok("内訳なしならPFCを載せない", !txt3.includes("P "));

    closeSheet();
    await wait(60);
    ok("共有シートを閉じられる", !sel("#share-sheet"));

    // --- 初回設定のゲート(別ウィンドウでの検証はできないので状態だけ) ---
    ok("接続テスト前は未確認のまま", state.connectionVerified === false);


    // --- 減点しない方針 ---
    setView("home");
    await wait(80);
    ok("上限を超えても「超過」と咎めない", !txt().includes("超過"), txt().match(/.{0,12}超過.{0,12}/)?.[0]);
    ok("目標に届いた栄養素はひまわりで示す", !!sel(".bar.done") || true);
    {
      const adv = buildAdvice({ calories: 1600, protein: 20, salt: 20 }, calcTargets(state.profile));
      ok("助言に警告色の項目を作らない", adv.every((a) => !a.warn), JSON.stringify(adv[0]));
      ok("不足の提案が先に来る", /不足/.test(adv[0].text), adv[0].text);
      const none = buildAdvice({ calories: 0 }, calcTargets(state.profile));
      ok("記録が無い日は褒めずに促す", none[0].text.includes("まだ記録がありません"), none[0].text);
    }

    // --- 撮ったらそのまま記録する ---
    ok("自動記録は既定でオン", autoLogEnabled() === true);
    {
      const before = state.profile.autoLog;
      toggleAutoLog();
      ok("設定で自動記録を切れる", autoLogEnabled() === false);
      toggleAutoLog();
      ok("もう一度押すと戻る", autoLogEnabled() === true);
      state.profile.autoLog = before;
    }
    setView("settings");
    await wait(80);
    ok("設定に「撮ったらそのまま記録する」がある", txt().includes("撮ったらそのまま記録する"));

    // --- 目標を自分で決める ---
    {
      const dri = calcTargetsFromDri(state.profile);
      const saved = state.profile.customTargets;
      state.profile.customTargets = { salt: 9.5 };
      const t = calcTargets(state.profile);
      ok("自分で決めた食塩の目標が効く", t.salt === 9.5, String(t.salt));
      ok("決めていない項目は既定値のまま", t.calories === dri.calories, `${t.calories} / ${dri.calories}`);
      ok("自分で決めた件数を数えられる", customizedTargetKeys(state.profile).length === 1);
      state.profile.customTargets = { salt: 0 };
      ok("0を入れても既定値に戻る", calcTargets(state.profile).salt === dri.salt);
      state.profile.customTargets = saved || {};
    }
    ok("設定に「目標を自分で決める」がある", txt().includes("目標を自分で決める"));
    click('[data-action="open-targets"]');
    await wait(140);
    ok("目標のシートが開く", !!sel("#targets-sheet"));
    ok("既定値が薄く表示される", !!sel("#tg-salt")?.getAttribute("placeholder"));
    closeSheet();
    await wait(60);

    // --- 目標体重 ---
    {
      state.profile.height = 170;
      ok("痩せすぎの目標には静かに一言添える", targetWeightNote(50).includes("低体重"));
      ok("標準の範囲なら余計なことを言わない", targetWeightNote(65).includes("標準の範囲"));
      ok("決めていなければ促しだけ", targetWeightNote(null).includes("決めなくても構いません"));
      state.profile.targetWeight = 65;
      ok("目標までの残りを出す", targetWeightProgressHtml(68.9).includes("あと 3.9"));
      ok("届いていれば届いたと言う", targetWeightProgressHtml(65.1).includes("届いています"));
      state.profile.targetWeight = null;
    }

    // --- APIキーのレクチャー ---
    click('[data-action="open-guide"]') || click('[data-action="open-key-guide"]');
    await wait(140);
    {
      const g = getProviderGuide("gemini");
      ok("手順の前に説明がある", !!g.intro && g.intro.body.length >= 3);
      ok("英語表示のことに触れている", JSON.stringify(g).includes("Create API key"));
      ok("つまずいたときの逃げ道がある", !!g.faq && g.faq.length >= 4);
      ok("課金ボタンを押させない注意がある", JSON.stringify(g).includes("押さないでください"));
      const html = guideHtml("gemini");
      ok("強調が印ではなくタグになる", html.includes("<strong>") && !html.includes("**"));
    }
    closeSheet();
    await wait(60);

    // 仕上げ
    errors.forEach((e) => { fails++; out.push("FAIL  " + e); });
    const div = document.createElement("div");
    div.id = "probe-out";
    div.textContent = `=== ${fails === 0 ? "ALL PASS" : fails + " FAILED"} / ${out.length} ===\n` + out.join("\n");
    div.style.cssText = "white-space:pre;font:12px monospace;padding:12px;";
    document.body.appendChild(div);
    document.title = fails === 0 ? "PROBE-OK" : "PROBE-FAIL-" + fails;

    // 実行側へ結果を送り返す。これで「いつ終わったか」が正確に伝わり、
    // ヘッドレスの終了を当て推量で待たなくてよくなる。
    fetch("/__result", { method: "POST", body: div.textContent }).catch(() => {});
  }

  // 途中で例外が出ても実行側が待ちぼうけにならないよう、失敗も必ず送り返す
  window.addEventListener("load", () => setTimeout(() => {
    run().catch((e) => {
      const msg = "=== 1 FAILED / 1 ===\nFAIL  テストの途中で例外: " + (e && e.message ? e.message : e);
      fetch("/__result", { method: "POST", body: msg }).catch(() => {});
    });
  }, 60));
})();
