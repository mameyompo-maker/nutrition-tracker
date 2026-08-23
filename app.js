// ---------------------------------------------------------------
// app.js
// 画面の描画・状態管理・イベント処理
// ---------------------------------------------------------------

const APP_VERSION = "3.0";

// 旧バージョン(Anthropic固定)のプロフィールを、複数AI対応の形に読み替える
function loadProfile() {
  const p = Storage.getProfile();
  if (!p) return null;
  if (!p.provider) {
    p.provider = p.apiKey ? "anthropic" : DEFAULT_PROVIDER;
    p.apiKeys = { anthropic: p.apiKey || "" };
    p.models = { anthropic: p.model || PROVIDERS.anthropic.defaultModel };
    p.baseUrls = {};
  }
  return p;
}

const state = {
  profile: loadProfile(),
  view: null,
  capture: { file: null, dataUrl: null, analyzing: false, result: null, error: null, showManual: false, captureInfo: null, captureText: "" },
  showDetail: false,
  historyOpenDate: null,
  historyQuery: "",
  historyLimit: 30,
  trendRange: 7,
  editingProfile: false,
  obStep: 0,
  sheet: null,
  // 初回設定では、AIにつながることを確かめるまで先に進めない
  connectionVerified: false,
  // 新しい記録をどの日に入れるか。null なら今日。
  // 撮り忘れた日を後から埋めるときだけ、ここに過去の日付が入る。
  logDate: null,
};

// いま記録を入れる先の日付
function activeLogDate() {
  return state.logDate || todayKey();
}

// 過去の日を埋めている最中かどうか
function isBackfilling() {
  return !!state.logDate && state.logDate !== todayKey();
}

// 設定フォームでAIサービスを切り替えたとき、入力途中の値を失わないための一時置き場
const formScratch = { apiKeys: {}, models: {}, baseUrls: {} };

function scratchValue(mapName, providerId, fallback) {
  const typed = formScratch[mapName][providerId];
  if (typed !== undefined) return typed;
  const saved = state.profile?.[mapName]?.[providerId];
  return saved === undefined || saved === null ? fallback : saved;
}

function clearFormScratch() {
  formScratch.apiKeys = {};
  formScratch.models = {};
  formScratch.baseUrls = {};
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// 対応端末では、操作の節目に短い振動を返す(iOSでは無視されるだけ)
function buzz(ms = 8) {
  try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* ignore */ }
}

// トースト。actionLabel を渡すと「元に戻す」のような操作ボタン付きになる
function showToast(msg, opts = {}) {
  const el = $("#toast");
  clearTimeout(showToast._t);
  if (opts.actionLabel) {
    el.innerHTML = `<span>${escapeHtml(msg)}</span><button type="button" class="toast-action">${escapeHtml(opts.actionLabel)}</button>`;
    el.classList.add("has-action");
    const btn = $(".toast-action", el);
    btn.addEventListener("click", () => {
      el.classList.remove("show", "has-action");
      if (opts.onAction) opts.onAction();
    }, { once: true });
  } else {
    el.textContent = msg;
    el.classList.remove("has-action");
  }
  el.classList.add("show");
  showToast._t = setTimeout(() => el.classList.remove("show", "has-action"), opts.duration || (opts.actionLabel ? 5000 : 2400));
}

const CAPTURE_INITIAL = () => ({
  file: null, dataUrl: null, analyzing: false, result: null, error: null, showManual: false,
  captureInfo: null, captureText: "",
});

// ---------------- 食事の区分 ----------------

const MEALS = {
  breakfast: { label: "朝食", icon: "breakfast" },
  lunch:     { label: "昼食", icon: "lunch" },
  snack:     { label: "間食", icon: "snack" },
  dinner:    { label: "夕食", icon: "dinner" },
};
const MEAL_ORDER = ["breakfast", "lunch", "snack", "dinner"];

// 時刻からの推測。あくまで初期値で、記録時にいつでも変えられる
function guessMeal(hour) {
  if (hour >= 4 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 15) return "lunch";
  if (hour >= 15 && hour < 18) return "snack";
  return "dinner";
}

function nowTimeStr() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function newEntryId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------- 初期化・ルーティング ----------------

const TAB_ICONS = { home: "home", capture: "camera", trends: "trend", history: "calendar", settings: "settings" };
const VIEW_TITLES = { home: "今日", capture: "記録", trends: "トレンド", history: "履歴", settings: "設定" };
const ALL_VIEWS = ["home", "capture", "trends", "history", "settings"];

function init() {
  const params = new URLSearchParams(location.search);
  const wanted = params.get("view");
  state.view = state.profile ? (ALL_VIEWS.includes(wanted) ? wanted : "home") : "onboarding";

  $$(".tab-btn").forEach((btn) => {
    const wrap = $(".ic-wrap", btn);
    if (wrap) wrap.innerHTML = iconHtml(TAB_ICONS[btn.dataset.view], 22);
  });

  render();

  // アプリのショートカット(アイコン長押し)から体重記録を直接開く
  if (state.profile && params.get("sheet") === "weight") {
    setTimeout(openWeightSheet, 80);
  }

  // 写真アプリの「共有」からこのアプリを選んだとき。
  // サービスワーカーが受け取って置いておいた写真を、ここで拾う。
  if (state.profile && params.has("shared")) {
    pickUpSharedPhoto();
  }

  document.body.addEventListener("click", onBodyClick);
  document.body.addEventListener("change", onBodyChange);
  document.body.addEventListener("input", onBodyInput);
  document.body.addEventListener("submit", onBodySubmit);
  document.addEventListener("paste", onPaste);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.sheet) closeSheet();
  });

  // スクロールで小さなタイトルバーを出す(ネイティブのナビゲーションバーの挙動)
  let navTick = false;
  window.addEventListener("scroll", () => {
    if (navTick) return;
    navTick = true;
    requestAnimationFrame(() => {
      navTick = false;
      $("#small-nav").classList.toggle("visible", window.scrollY > 46 && state.view !== "onboarding");
    });
  }, { passive: true });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  // 過去に保存した大きなサムネイルを、裏で小さく作り直す(容量対策)
  setTimeout(migrateThumbs, 1600);
}

function setView(view) {
  // 別の画面へ移ったら、過去の日を埋めるモードは解除する。
  // 解除し忘れると、後日の記録がその日付へ入ってしまう。
  if (view !== "capture") state.logDate = null;
  closeSheet();
  const changed = state.view !== view;
  state.view = view;
  if (view === "capture") state.capture = CAPTURE_INITIAL();
  if (view === "history") { state.historyQuery = ""; state.historyLimit = 30; }
  if (changed) buzz(4);
  render(changed);
  window.scrollTo(0, 0);
}

function render(animate = false) {
  const app = $("#app");
  const tabbar = $("#tabbar");
  const showTabs = state.view !== "onboarding";
  tabbar.classList.toggle("hidden", !showTabs);

  $$(".tab-btn").forEach((btn) => {
    const active = btn.dataset.view === state.view;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-current", active ? "page" : "false");
  });

  const title = $("#small-nav-title");
  if (title) title.textContent = VIEW_TITLES[state.view] || "";
  $("#small-nav").classList.toggle("visible", window.scrollY > 46 && showTabs);

  switch (state.view) {
    case "onboarding": app.innerHTML = renderOnboarding(); break;
    case "home": app.innerHTML = renderHome(); break;
    case "capture": app.innerHTML = renderCapture(); break;
    case "trends": app.innerHTML = renderTrends(); break;
    case "history": app.innerHTML = renderHistory(); break;
    case "settings": app.innerHTML = renderSettings(); break;
    default: app.innerHTML = renderHome();
  }

  if (animate) {
    app.classList.remove("view-anim");
    void app.offsetWidth;
    app.classList.add("view-anim");
  }

  // 設定フォームが出ているときは、選択中のAIサービスに合わせて中身を整える
  const profileForm = $("#onboarding-form") || $("#settings-form");
  if (profileForm) {
    applyProviderUi(profileForm);
    updateProfileFormUi(profileForm);
  }
}

// ---------------- シート(重ねて開く画面) ----------------

function openSheet(title, bodyHtml) {
  state.sheet = { title, body: bodyHtml };
  renderSheet();
}

function closeSheet() {
  if (!state.sheet) return;
  state.sheet = null;
  renderSheet();
}

function renderSheet() {
  const root = $("#sheet-root");
  if (!state.sheet) {
    root.innerHTML = "";
    root.classList.add("hidden");
    document.body.classList.remove("sheet-open");
    return;
  }
  root.classList.remove("hidden");
  document.body.classList.add("sheet-open");
  root.innerHTML = `
    <button class="sheet-backdrop" data-action="close-sheet" aria-label="閉じる"></button>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(state.sheet.title)}">
      <div class="sheet-grabber"></div>
      <div class="sheet-head">
        <h2>${escapeHtml(state.sheet.title)}</h2>
        <button class="icon-btn" data-action="close-sheet" aria-label="閉じる">${iconHtml("close", 14)}</button>
      </div>
      <div class="sheet-body">${state.sheet.body}</div>
    </div>
  `;
  attachSheetDrag($(".sheet", root));
}

// シートをつかんで下に払うと閉じる(ネイティブのシートと同じ操作感)
function attachSheetDrag(sheet) {
  if (!sheet || !("ontouchstart" in window)) return;
  const head = $(".sheet-head", sheet);
  const grabber = $(".sheet-grabber", sheet);
  let startY = null;
  let delta = 0;
  const onStart = (e) => {
    startY = e.touches[0].clientY;
    delta = 0;
    sheet.style.transition = "none";
  };
  const onMove = (e) => {
    if (startY == null) return;
    delta = Math.max(0, e.touches[0].clientY - startY);
    sheet.style.transform = `translateY(${delta}px)`;
  };
  const onEnd = () => {
    if (startY == null) return;
    sheet.style.transition = "";
    if (delta > 90) {
      closeSheet();
    } else {
      sheet.style.transform = "";
    }
    startY = null;
  };
  [head, grabber].forEach((el) => {
    if (!el) return;
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd, { passive: true });
  });
}

// ---------------- イベントハンドラ ----------------

function onBodyClick(e) {
  const tab = e.target.closest(".tab-btn");
  if (tab) {
    setView(tab.dataset.view);
    // 記録タブを押したら、そのままカメラを出す設定のとき。
    // ここは押した流れの中で呼ばないと、ブラウザに「勝手に開いた」と見なされて弾かれる。
    // setTimeout を挟んではいけない。
    if (tab.dataset.view === "capture" && instantCameraEnabled() && !state.capture.dataUrl) {
      const input = $("#file-camera");
      if (input) input.click();
    }
    return;
  }

  const actionEl = e.target.closest("[data-action]");
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  switch (action) {
    case "close-sheet": closeSheet(); break;
    case "open-key-guide": openKeyGuide(actionEl); break;
    case "open-about": openAboutSheet(); break;
    case "open-capture-info": openCaptureInfoSheet(); break;
    case "open-basis": openBasisSheet(); break;
    case "open-camera": $("#file-camera").click(); break;
    case "open-library": $("#file-library").click(); break;
    case "retake": state.capture = CAPTURE_INITIAL(); render(); break;
    case "analyze": doAnalyze(); break;
    case "toggle-manual": state.capture.showManual = !state.capture.showManual; render(); break;
    case "copy-prompt": doCopyPrompt(); break;
    case "parse-manual": doParseManual(); break;
    case "add-log": doAddLog(); break;
    case "toggle-detail": state.showDetail = !state.showDetail; render(); break;
    case "ob-next": gotoObStep(state.obStep + 1); break;
    case "ob-back": gotoObStep(state.obStep - 1); break;
    case "goto-trends": setView("trends"); break;
    case "set-trend-range": {
      state.trendRange = Number(actionEl.dataset.range) || 7;
      render();
      break;
    }
    case "toggle-history-day": {
      const d = actionEl.dataset.date;
      state.historyOpenDate = state.historyOpenDate === d ? null : d;
      updateHistoryResults();
      break;
    }
    case "history-more": state.historyLimit += 30; updateHistoryResults(); break;
    case "open-entry": openEntrySheet(actionEl.dataset.date, actionEl.dataset.id); break;
    case "entry-save": saveEntrySheet(actionEl.dataset.date, actionEl.dataset.id); break;
    case "entry-delete": deleteEntry(actionEl.dataset.date, actionEl.dataset.id); break;
    case "entry-fav": toggleEntryFavorite(actionEl); break;
    case "open-manual-add": openManualAddSheet(); break;
    case "manual-add-save": saveManualAdd(); break;
    case "open-weight": openWeightSheet(); break;
    case "weight-save": saveWeightSheet(); break;
    case "fav-quick-add": quickAddFavorite(actionEl.dataset.id); break;
    case "backfill":
      setView("capture");
      state.logDate = actionEl.dataset.date;
      render();
      break;
    case "backfill-cancel": state.logDate = null; render(); break;
    case "repeat-add": repeatAdd(actionEl); break;
    case "toggle-instant-camera": toggleInstantCamera(); break;
    case "open-targets": openTargetsSheet(); break;
    case "targets-save": saveTargetsSheet(); break;
    case "targets-reset": resetTargetsSheet(); break;
    case "toggle-autolog": toggleAutoLog(); break;
    case "open-share": openShareSheet(actionEl.dataset.date, actionEl.dataset.id); break;
    case "do-share": doShare(actionEl); break;
    case "open-fav-manage": openFavManageSheet(); break;
    case "fav-remove": {
      Storage.removeFavorite(actionEl.dataset.id);
      openFavManageSheet();
      break;
    }
    case "export-data": doExportData(); break;
    case "import-data": $("#file-import").click(); break;
    case "edit-profile": state.editingProfile = true; render(); window.scrollTo(0, 0); break;
    case "cancel-edit": state.editingProfile = false; clearFormScratch(); render(); break;
    case "clear-logs": {
      if (confirm("すべての食事記録を削除します。よろしいですか？(元に戻せません)")) {
        Storage.clearAllLogs();
        showToast("記録を削除しました");
        render();
      }
      break;
    }
    case "toggle-key-visibility": {
      const input = $("#f-apikey");
      input.type = input.type === "password" ? "text" : "password";
      actionEl.textContent = input.type === "password" ? "表示" : "隠す";
      break;
    }
    case "test-connection": doTestConnection(actionEl); break;
  }
}

function onBodyChange(e) {
  if (e.target.id === "file-camera" || e.target.id === "file-library") {
    handleFileSelected(e.target.files[0]);
    return;
  }
  if (e.target.id === "file-import") {
    handleImportFile(e.target.files[0]);
    e.target.value = "";
    return;
  }
  if (e.target.dataset && e.target.dataset.role === "provider-select") {
    onProviderChange(e.target);
    return;
  }
  // 食事区分などのセグメント選択の見た目を切り替える
  if (e.target.matches(".segmented input")) {
    const seg = e.target.closest(".segmented");
    $$("label.seg", seg).forEach((l) => l.classList.toggle("on", $("input", l).checked));
    return;
  }
  if (e.target.name === "sex" || e.target.name === "age" || e.target.name === "activity") {
    updateProfileFormUi(e.target.closest("form"));
  }
}

// キーやモデル名を書き換えたら、確認済みの状態は取り消す
function onBodyInput(e) {
  const name = e.target.name;
  if (name === "apiKey" || name === "model" || name === "baseUrl") {
    if (state.connectionVerified) setConnectionVerified(false);
    const out = $("[data-role=test-result]", e.target.closest("form") || document);
    if (out) { out.textContent = "キーとモデル名が正しいか確かめます"; out.style.color = ""; }
  }
  if (name === "age") updateProfileFormUi(e.target.closest("form"));
  if (e.target.id === "history-search") {
    state.historyQuery = e.target.value;
    state.historyLimit = 30;
    updateHistoryResults();
  }
}

// 性別・年齢・活動レベルに応じて、フォームの補足表示を切り替える
function updateProfileFormUi(form) {
  if (!form) return;
  const fd = new FormData(form);
  const age = parseInt(fd.get("age"), 10);
  const sex = fd.get("sex");
  // 鉄の推奨量は月経の有無で変わる。65歳以上には「月経あり」の値が設定されていない。
  const row = $("[data-role=menstruation-row]", form);
  if (row) row.classList.toggle("hidden", !(sex === "female" && Number.isFinite(age) && age >= 18 && age < 65));
  const desc = $("[data-role=activity-desc]", form);
  if (desc) {
    const lv = ACTIVITY_LEVELS[fd.get("activity")] || ACTIVITY_LEVELS.normal;
    desc.textContent = `${lv.label}: ${lv.desc}`;
  }
}

// 外部(スマホのカメラ・スクリーンショットなど)で撮った写真をクリップボードから貼り付け
function onPaste(e) {
  if (state.view !== "capture") return;
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        handleFileSelected(file);
      }
      return;
    }
  }
}

function onBodySubmit(e) {
  if (e.target.id === "onboarding-form") {
    e.preventDefault();
    submitProfileForm(e.target, true);
  } else if (e.target.id === "settings-form") {
    e.preventDefault();
    submitProfileForm(e.target, false);
  }
}

// ---------------- プロフィール ----------------

function readProfileForm(form) {
  const fd = new FormData(form);
  const provider = fd.get("provider") || DEFAULT_PROVIDER;
  const meta = getProvider(provider);
  const prev = state.profile || {};

  // いま画面に出ていないAIサービスのキー・モデルも消さずに引き継ぐ
  const apiKeys = Object.assign({}, prev.apiKeys, formScratch.apiKeys);
  const models = Object.assign({}, prev.models, formScratch.models);
  const baseUrls = Object.assign({}, prev.baseUrls, formScratch.baseUrls);

  apiKeys[provider] = (fd.get("apiKey") || "").trim();
  models[provider] = (fd.get("model") || "").trim() || meta.defaultModel;
  baseUrls[provider] = (fd.get("baseUrl") || "").trim() || meta.baseUrl || "";

  return {
    // 設定フォームに出ていない項目(自分で決めた目標・自動記録の可否・目標体重)は
    // ここで引き継がないと、プロフィールを保存し直したときに消えてしまう
    customTargets: prev.customTargets || {},
    autoLog: prev.autoLog,
    instantCamera: prev.instantCamera,
    targetWeight: prev.targetWeight,
    age: parseInt(fd.get("age"), 10),
    sex: fd.get("sex"),
    height: parseFloat(fd.get("height")),
    weight: parseFloat(fd.get("weight")),
    activity: fd.get("activity"),
    goal: fd.get("goal") || "maintain",
    menstruation: fd.get("menstruation") === "no" ? "no" : "yes",
    provider,
    apiKeys,
    models,
    baseUrls,
  };
}

function validateProfile(p) {
  if (!Number.isFinite(p.age) || p.age < 18 || p.age > 120) {
    return "本アプリは18歳以上の成人を対象としています。年齢を正しく入力してください。";
  }
  if (!p.sex) return "性別を選択してください。";
  if (!Number.isFinite(p.height) || p.height < 100 || p.height > 230) return "身長を正しく入力してください(100〜230cm)。";
  if (!Number.isFinite(p.weight) || p.weight < 25 || p.weight > 300) return "体重を正しく入力してください(25〜300kg)。";
  if (!p.activity) return "活動レベルを選択してください。";
  return null;
}

function showFormError(form, message) {
  const box = $("[data-role=form-error]", form);
  if (!box) return;
  if (!message) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = `${iconHtml("info", 16)}<span>${escapeHtml(message)}</span>`;
}

function submitProfileForm(form, isOnboarding) {
  const p = readProfileForm(form);
  const err = validateProfile(p);
  if (err) {
    showFormError(form, err);
    if (isOnboarding && state.obStep !== 1) gotoObStep(1);
    return;
  }
  if (isOnboarding && !state.connectionVerified) {
    showFormError(form, "「接続テスト」でAIにつながることを確認してから進んでください。");
    if (state.obStep !== OB_LAST_STEP) gotoObStep(OB_LAST_STEP);
    return;
  }
  showFormError(form, null);
  state.profile = p;
  state.editingProfile = false;
  clearFormScratch();
  Storage.saveProfile(p);
  buzz();
  showToast(isOnboarding ? "準備ができました" : "変更を保存しました");
  setView("home");
}

// ---------------- 初回設定: AIにつながることを確かめるまで進ませない ----------------

function setConnectionVerified(ok) {
  state.connectionVerified = ok;
  updateObGate();
}

function updateObGate() {
  const form = $("#onboarding-form");
  if (!form) return;
  const btn = $("[data-role=ob-actions] button[type=submit]", form);
  if (btn) btn.disabled = !state.connectionVerified;
  const hint = $("[data-role=ob-gate]", form);
  if (hint) hint.classList.toggle("hidden", state.connectionVerified);
  const done = $("[data-role=ob-gate-done]", form);
  if (done) done.classList.toggle("hidden", !state.connectionVerified);
}

// ---------------- オンボーディングの手順送り ----------------

const OB_LAST_STEP = 2;

function obFooterHtml(step) {
  if (step === 0) {
    return `<button type="button" class="btn btn-primary" data-action="ob-next">はじめる</button>`;
  }
  if (step === OB_LAST_STEP) {
    return `
      <button type="submit" class="btn btn-primary" disabled>この内容ではじめる</button>
      <button type="button" class="btn btn-plain" data-action="ob-back">戻る</button>
    `;
  }
  return `
    <button type="button" class="btn btn-primary" data-action="ob-next">次へ</button>
    <button type="button" class="btn btn-plain" data-action="ob-back">戻る</button>
  `;
}

// 画面を作り直すと入力途中の値が消えるので、手順送りはDOMの表示切り替えだけで行う
function gotoObStep(n) {
  const form = $("#onboarding-form");
  if (!form) return;
  const step = Math.max(0, Math.min(OB_LAST_STEP, n));

  if (step > state.obStep && state.obStep === 1) {
    const err = validateProfile(readProfileForm(form));
    if (err) { showFormError(form, err); return; }
  }
  showFormError(form, null);

  state.obStep = step;
  $$(".ob-step", form).forEach((sec) => sec.classList.toggle("on", Number(sec.dataset.step) === step));
  $$(".ob-progress i", form).forEach((dot, i) => dot.classList.toggle("on", i === step));
  const footer = $("[data-role=ob-actions]", form);
  if (footer) footer.innerHTML = obFooterHtml(step);
  updateObGate();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------------- AI接続まわりのUI ----------------

// 選ばれているAIサービスに合わせて、フォームの表示内容と値を切り替える
function applyProviderUi(form) {
  if (!form) return;
  const sel = $("[data-role=provider-select]", form);
  if (!sel) return;
  const id = sel.value || DEFAULT_PROVIDER;
  const meta = getProvider(id);
  const guide = getProviderGuide(id);
  sel.dataset.current = id;

  const help = $("[data-role=provider-help]", form);
  if (help) help.textContent = meta.help;

  const cost = $("[data-role=provider-cost]", form);
  if (cost) {
    cost.className = `chip ${guide.cost.tone === "paid" ? "paid" : ""}`;
    cost.innerHTML = `${iconHtml(guide.cost.tone === "paid" ? "info" : "check", 13)} ${escapeHtml(guide.cost.text)}`;
  }

  const keyLabel = $("[data-role=key-label]", form);
  if (keyLabel) keyLabel.textContent = meta.keyLabel;

  const keyInput = $("#f-apikey", form);
  if (keyInput) {
    keyInput.placeholder = meta.keyPlaceholder;
    keyInput.value = scratchValue("apiKeys", id, "");
    keyInput.type = "password";
  }
  const toggleBtn = $("[data-action=toggle-key-visibility]", form);
  if (toggleBtn) toggleBtn.textContent = "表示";

  const baseRow = $("[data-role=baseurl-row]", form);
  if (baseRow) baseRow.classList.toggle("hidden", !meta.needsBaseUrl);
  const baseInput = $("[name=baseUrl]", form);
  if (baseInput) baseInput.value = scratchValue("baseUrls", id, meta.baseUrl || "");

  const modelInput = $("[name=model]", form);
  if (modelInput) {
    modelInput.placeholder = meta.defaultModel || "モデル名を入力";
    modelInput.value = scratchValue("models", id, meta.defaultModel || "");
  }
  const datalist = $("#model-suggestions", form);
  if (datalist) {
    datalist.innerHTML = meta.models.map((m) => `<option value="${escapeHtml(m)}"></option>`).join("");
  }

  const testResult = $("[data-role=test-result]", form);
  if (testResult) {
    testResult.textContent = "キーとモデル名が正しいか確かめます";
    testResult.style.color = "";
  }
  setConnectionVerified(false);
}

// AIサービスを切り替える前に、いま入力されている値を一時保存しておく
function onProviderChange(sel) {
  const form = sel.closest("form");
  const prevId = sel.dataset.current;
  if (form && prevId) {
    const keyInput = $("#f-apikey", form);
    const modelInput = $("[name=model]", form);
    const baseInput = $("[name=baseUrl]", form);
    if (keyInput) formScratch.apiKeys[prevId] = keyInput.value;
    if (modelInput) formScratch.models[prevId] = modelInput.value;
    if (baseInput) formScratch.baseUrls[prevId] = baseInput.value;
  }
  applyProviderUi(form);
}

// 入力されたキー・モデル名で実際にAPIを1回叩いて、つながるか確かめる
async function doTestConnection(rowEl) {
  const form = rowEl.closest("form");
  if (!form) return;
  const out = $("[data-role=test-result]", form);
  const fd = new FormData(form);
  const providerId = fd.get("provider") || DEFAULT_PROVIDER;
  const meta = getProvider(providerId);
  const probe = {
    provider: providerId,
    apiKeys: { [providerId]: (fd.get("apiKey") || "").trim() },
    models: { [providerId]: (fd.get("model") || "").trim() || meta.defaultModel },
    baseUrls: { [providerId]: (fd.get("baseUrl") || "").trim() || meta.baseUrl || "" },
  };

  rowEl.disabled = true;
  if (out) { out.textContent = "確認しています…"; out.style.color = ""; }
  try {
    await testAiConnection(probe);
    if (out) { out.textContent = "接続できました"; out.style.color = "var(--accent)"; }
    buzz();
    setConnectionVerified(true);
  } catch (e) {
    if (out) { out.textContent = e.message || "接続できませんでした"; out.style.color = "var(--danger)"; }
    setConnectionVerified(false);
  } finally {
    rowEl.disabled = false;
  }
}

// APIキーの取得手順を、画面を離れずに読めるようにシートで開く
function openKeyGuide(el) {
  const form = el.closest("form");
  const sel = form ? $("[data-role=provider-select]", form) : null;
  const id = (sel && sel.value) || state.profile?.provider || DEFAULT_PROVIDER;
  openSheet(`${getProvider(id).keyLabel}の取得`, guideHtml(id));
}

// URLやキーの接頭辞だけ等幅にする(1回の置換で済ませ、入れ子にならないようにする)
function formatGuideText(text) {
  // 先に安全化してから、**強調** と URL・キーの体裁を整える。
  // 順番が逆だと、タグが打ち消されたり二重に囲まれたりする。
  return escapeHtml(text)
    .replace(/(https?:\/\/[^\s、。]+|sk-ant-|sk-|AIza|:free)/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function guideHtml(providerId) {
  const g = getProviderGuide(providerId);
  const steps = g.steps
    .map((s) => `<li>${formatGuideText(s.text)}${
      s.link
        ? `<a class="step-link" href="${escapeHtml(s.link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.link.label)}${iconHtml("external", 12)}</a>`
        : ""
    }</li>`)
    .join("");
  const notes = g.notes
    .map((n) => `<div class="guide-note ${n.tone === "warn" ? "warn" : ""}">${iconHtml(n.tone === "warn" ? "shield" : "info", 15)}<span>${formatGuideText(n.text)}</span></div>`)
    .join("");

  // 手順に入る前の説明。ここで不安を解いておかないと、
  // 手順がいくら丁寧でも「なんだか怖い」で離れてしまう。
  const intro = g.intro
    ? `<div class="guide-intro">
         <h3>${escapeHtml(g.intro.title)}</h3>
         ${g.intro.body.map((t) => `<p>${formatGuideText(t)}</p>`).join("")}
       </div>`
    : "";

  // つまずいたときの逃げ道。詰まった人がここで戻ってこられるようにする。
  const faq = g.faq
    ? `<div class="guide-faq">
         <div class="group-title">うまくいかないとき</div>
         ${g.faq.map((f) => `
           <details class="faq-item">
             <summary>${escapeHtml(f.q)}</summary>
             <div class="faq-a">${formatGuideText(f.a)}</div>
           </details>`).join("")}
       </div>`
    : "";

  return `
    <p class="guide-lead">${formatGuideText(g.lead)}</p>
    <div style="margin-bottom:22px;"><span class="chip ${g.cost.tone === "paid" ? "paid" : ""}">${iconHtml(g.cost.tone === "paid" ? "info" : "check", 13)} ${escapeHtml(g.cost.text)}</span></div>
    ${intro}
    <div class="group-title" style="padding-left:0;">手順</div>
    <ol class="steps">${steps}</ol>
    ${faq}
    <div class="guide-notes">${notes}</div>
  `;
}

// 1日の目標値がどう出ているかを、計算式ごと見せる
function openBasisSheet() {
  const p = state.profile;
  const b = targetBasis(p);
  const t = calcTargets(p);
  const goal = GOALS[p.goal] || GOALS.maintain;
  const eer = Math.round(b.bmr * b.pal);
  const rows = Object.keys(NUTRIENT_META)
    .map((k) => `
      <div class="row">
        <span class="row-main">
          <span class="row-label" style="font-size:15px;">${NUTRIENT_META[k].label}</span>
          <span class="row-sub">${NUTRIENT_META[k].basis}</span>
        </span>
        <span class="row-value" style="font-size:15px;">${t[k]} ${NUTRIENT_META[k].unit}</span>
      </div>`)
    .join("");

  openSheet("1日の目標の求め方", `
    <p class="guide-lead">厚生労働省「日本人の食事摂取基準(2025年版)」の値を、あなたの年齢区分・性別・体重にあてはめて計算しています。</p>

    <div class="group">
      <div class="group-title">あてはめた区分</div>
      <div class="list">
        <div class="row"><span class="row-main"><span class="row-label" style="font-size:15px;">年齢区分</span></span><span class="row-value" style="font-size:15px;">${b.bandLabel}・${b.sexLabel}</span></div>
        <div class="row"><span class="row-main"><span class="row-label" style="font-size:15px;">身体活動レベル</span></span><span class="row-value" style="font-size:15px;">${b.activityLabel}(${b.pal})</span></div>
      </div>
      ${b.palIsSubstituted ? `<div class="group-note">75歳以上には「高い」が設定されていないため、「ふつう」の値を用いています。</div>` : ""}
    </div>

    <div class="group">
      <div class="group-title">エネルギー</div>
      <div class="list">
        <div class="row"><span class="row-main"><span class="row-label" style="font-size:15px;">基礎代謝量</span><span class="row-sub">基礎代謝基準値 ${b.bmrPerKg} kcal/kg × 体重 ${p.weight} kg</span></span><span class="row-value" style="font-size:15px;">${b.bmr} kcal</span></div>
        <div class="row"><span class="row-main"><span class="row-label" style="font-size:15px;">推定エネルギー必要量</span><span class="row-sub">${b.bmr} kcal × 身体活動レベル ${b.pal}</span></span><span class="row-value" style="font-size:15px;">${eer} kcal</span></div>
        ${goal.calorieAdjust !== 0 ? `<div class="row"><span class="row-main"><span class="row-label" style="font-size:15px;">目標「${goal.label}」による調整</span><span class="row-sub">食事摂取基準の範囲外の一般的な目安</span></span><span class="row-value" style="font-size:15px;">${goal.calorieAdjust > 0 ? "+" : ""}${goal.calorieAdjust} kcal</span></div>` : ""}
        <div class="row"><span class="row-main"><span class="row-label" style="font-size:15px;">1日の目標</span><span class="row-sub">50 kcal 単位に丸めた値</span></span><span class="row-value" style="font-size:15px;">${t.calories} kcal</span></div>
      </div>
    </div>

    <div class="group">
      <div class="group-title">栄養素ごとの目標</div>
      <div class="list">${rows}</div>
      <div class="group-note">
        たんぱく質・脂質・炭水化物は、目標量(%エネルギー)の範囲に収まるように配分しています。
        出典: <a href="https://www.mhlw.go.jp/stf/newpage_44138.html" target="_blank" rel="noopener noreferrer">厚生労働省「日本人の食事摂取基準(2025年版)」策定検討会報告書</a>
      </div>
    </div>
  `);
}

function openAboutSheet() {
  openSheet("このアプリについて", `
    <p class="guide-lead">写真から栄養を読み取り、あなたに必要な量と比べるためのアプリです。専用のサーバーを持たず、すべてこの端末の中で完結します。</p>
    <div class="guide-notes">
      <div class="guide-note">${iconHtml("database", 15)}<span>食事の記録・プロフィール・APIキーは、この端末のブラウザ内(localStorage)にのみ保存されます。開発者のサーバーには送信されません。端末を変えるときは、設定の「データを書き出す」で引き継げます。</span></div>
      <div class="guide-note">${iconHtml("sparkle", 15)}<span>写真解析のときだけ、写真とAPIキーが、あなたが選んだAIサービスに直接送信されます。経由するサーバーはありません。</span></div>
      <div class="guide-note warn">${iconHtml("shield", 15)}<span>APIキーはブラウザ内に保存されるため、その端末を使える人には見える形になります。共有の端末では、使い終わったらキーを消してください。</span></div>
      <div class="guide-note">${iconHtml("info", 15)}<span>表示される1日の必要量やAIの推定値は一般的な目安であり、医学的な助言ではありません。妊娠・授乳中の方、成長期のお子様、持病のある方は、医師や管理栄養士にご相談ください。18歳以上の方を対象としています。</span></div>
    </div>
    <p class="footnote" style="text-align:center;margin-top:20px;">バージョン ${APP_VERSION}</p>
  `);
}

// ---------------- 写真解析 ----------------

async function handleFileSelected(file) {
  if (!file) return;
  try {
    const dataUrl = await resizeImageToBase64(file, 1024, 0.82);
    state.capture.file = file;
    state.capture.dataUrl = dataUrl;
    state.capture.result = null;
    state.capture.error = null;
    // 量の判定に使うため、写真に埋め込まれた撮影情報を読み取る(位置情報は読まない)
    try {
      const info = await readCaptureInfo(file);
      state.capture.captureInfo = info;
      state.capture.captureText = captureInfoText(info);
    } catch (e) {
      state.capture.captureInfo = null;
      state.capture.captureText = "";
    }
    render();
    // ここが「ズボラでも続く」の要。撮った時点で人の仕事は終わりにする。
    // 確認したい人は設定で止められるが、既定では自分から解析へ進む。
    if (autoLogEnabled() && getAiConfig(state.profile).apiKey) doAnalyze();
  } catch (e) {
    showToast("写真を読み込めませんでした");
  }
}

// 共有シートから渡された写真を拾って、そのまま記録の流れに載せる。
// 写真アプリで「共有 → このアプリ」を選ぶだけで記録が終わるので、
// アプリを開いてカメラを出す手間がまるごと消える。
// (Android の Chrome で動く。iOS の Safari は共有先になれないため、
//  そちらでは何も起きない。有効な端末でだけ効く作りにしてある。)
async function pickUpSharedPhoto() {
  // 履歴に ?shared=1 を残すと、再読み込みのたびに拾いにいってしまう
  try { history.replaceState(null, "", location.pathname); } catch (e) {}
  if (!("caches" in window)) return;
  try {
    const cache = await caches.open("nutriapp-share");
    const res = await cache.match("./__shared-photo");
    if (!res) return;
    await cache.delete("./__shared-photo");
    const blob = await res.blob();
    if (!blob || !blob.size) return;
    const file = new File([blob], "shared.jpg", { type: blob.type || "image/jpeg" });
    setView("capture");
    await handleFileSelected(file);
  } catch (e) {
    showToast("共有された写真を読み込めませんでした");
  }
}

// 撮ったら自動で記録するか。設定が無い間は「する」を既定にする。
function autoLogEnabled() {
  const p = state.profile || {};
  return p.autoLog !== false;
}

async function doAnalyze() {
  if (!state.capture.dataUrl) return;
  const cfg = getAiConfig(state.profile);
  if (!cfg.apiKey) {
    state.capture.error = `${cfg.provider.keyLabel}が未設定です。「設定」タブで登録するか、下の「APIキーを使わない方法」をお使いください。`;
    state.capture.showManual = true;
    render();
    return;
  }
  state.capture.analyzing = true;
  state.capture.error = null;
  render();
  try {
    state.capture.result = await analyzeFoodPhoto({
      dataUrl: state.capture.dataUrl,
      profile: state.profile,
      captureText: state.capture.captureText,
    });
    buzz();
    if (autoLogEnabled()) {
      state.capture.analyzing = false;
      await doAddLog({ auto: true });
      return;
    }
  } catch (e) {
    state.capture.error = e.message || "解析中にエラーが発生しました";
  } finally {
    state.capture.analyzing = false;
    render();
  }
}

async function doCopyPrompt() {
  try {
    await navigator.clipboard.writeText(buildAnalysisPrompt(state.capture.captureText));
    showToast("指示文をコピーしました");
  } catch (e) {
    showToast("コピーできませんでした。手動で選択してコピーしてください");
  }
}

function doParseManual() {
  const input = $("#manual-json-input");
  const text = input ? input.value : "";
  try {
    state.capture.result = parseManualAnalysisText(text);
    state.capture.error = null;
  } catch (e) {
    state.capture.error = e.message || "貼り付けた内容を読み取れませんでした";
  }
  render();
}

// 記録用の小さなサムネイルを作る(容量を使い切らないための要)
function makeThumb(dataUrl, maxDim = 360, quality = 0.72) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(null);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
        else { width = Math.round((width * maxDim) / height); height = maxDim; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.src = dataUrl;
  });
}

// 以前の版が保存した大きなサムネイルを、裏で小さく作り直す
async function migrateThumbs() {
  const all = Storage.getAllLogs();
  let changed = false;
  for (const d of Object.keys(all)) {
    for (const e of all[d]) {
      if (e.thumb && e.thumb.length > 90000) {
        const small = await makeThumb(e.thumb);
        if (small && small.length < e.thumb.length) {
          e.thumb = small;
          changed = true;
        }
      }
    }
  }
  if (changed) Storage.setAllLogs(all);
}

function notifySaveResult(status) {
  if (status === "shed") {
    showToast("空き容量が少ないため、古い記録の写真を一部手放しました");
  } else if (status === "fail") {
    showToast("保存できませんでした。ブラウザの空き容量をご確認ください");
  }
}

async function doAddLog(opts = {}) {
  const auto = opts.auto === true;
  const r = state.capture.result || {};
  // 自動記録のときは画面にフォームがまだ無いので、解析結果をそのまま使う。
  // 手で確認する設定のときは、利用者が直した値を使う。
  const form = auto ? null : $("#result-form");
  const fd = form ? new FormData(form) : null;

  const nutrients = {};
  Object.keys(NUTRIENT_META).forEach((k) => {
    const v = fd ? parseFloat(fd.get(k)) : (r.nutrients || {})[k];
    nutrients[k] = Math.round((parseFloat(v) || 0) * 10) / 10;
  });

  const rawName = fd ? fd.get("mealName") : (r.items && r.items[0] && r.items[0].name);
  const name = (rawName || "食事").trim() || "食事";
  const note = fd ? (fd.get("memo") || "").trim() : "";
  const mealRaw = fd ? fd.get("meal") : null;
  const meal = MEALS[mealRaw] ? mealRaw : guessMeal(new Date().getHours());

  const thumb = state.capture.dataUrl ? await makeThumb(state.capture.dataUrl) : null;
  const entry = {
    id: newEntryId(),
    time: nowTimeStr(),
    name,
    meal,
    items: r.items || [],
    nutrients,
    note,
    thumb,
    portion: r.portion || null,
    source: r.source || null,
    confidence: r.confidence || null,
  };
  const status = Storage.addLog(activeLogDate(), entry);
  notifySaveResult(status);

  if (fd && fd.get("saveFav")) {
    Storage.addFavorite({ id: newEntryId(), name, meal, nutrients, thumb, items: r.items || [] });
  }
  buzz();
  state.capture = CAPTURE_INITIAL();
  setView("home");

  if (auto) {
    // 勝手に保存した以上、直す手段が同じ場所に無いと不安にさせる。
    // 「間違っていたら直せる」と分かることが、自動記録を受け入れてもらう条件。
    showToast(`${name} を記録しました`, {
      actionLabel: "確認",
      onAction: () => openEntrySheet(activeLogDate(), entry.id),
    });
  } else {
    showToast("記録に追加しました", {
      actionLabel: "共有",
      onAction: () => openShareSheet(activeLogDate(), entry.id),
    });
  }
}

// ---------------- 記録の詳細(閲覧・編集・削除) ----------------

function segmentedHtml(name, selected) {
  return `
    <div class="segmented" role="radiogroup" aria-label="食事の区分">
      ${MEAL_ORDER.map((m) => `
        <label class="seg ${selected === m ? "on" : ""}">
          <input type="radio" name="${name}" value="${m}" ${selected === m ? "checked" : ""}>
          ${MEALS[m].label}
        </label>`).join("")}
    </div>
  `;
}

function findEntry(dateKey, id) {
  return Storage.getLogsForDate(dateKey).find((e) => e.id === id) || null;
}

function openEntrySheet(dateKey, id) {
  const e = findEntry(dateKey, id);
  if (!e) return;
  const meal = MEALS[e.meal] ? e.meal : guessMeal(parseInt(e.time, 10) || 12);
  const isFav = !!Storage.findFavoriteByName(e.name);
  const portion = e.portion || {};
  const mainKeys = ["calories", "protein", "fat", "carb"];
  const restKeys = Object.keys(NUTRIENT_META).filter((k) => !mainKeys.includes(k));

  const numRow = (k) => `
    <div class="field-row">
      <label class="field-label" for="ee-${k}" style="display:flex;align-items:center;gap:9px;min-width:130px;font-size:15px;">
        ${nutrientIconHtml(k)} ${NUTRIENT_META[k].label}
      </label>
      <input type="number" step="0.1" id="ee-${k}" name="${k}" value="${e.nutrients?.[k] ?? 0}" inputmode="decimal">
      <span class="field-unit">${NUTRIENT_META[k].unit}</span>
    </div>`;

  openSheet(formatDateLabel(dateKey), `
    <div id="entry-edit" data-date="${dateKey}" data-id="${e.id}">
      ${e.thumb ? `<img class="entry-photo" src="${e.thumb}" alt="" decoding="async">` : ""}

      <div class="group">
        <div class="list">
          <div class="field-stack">
            <div class="field-caption"><span>名前</span></div>
            <input type="text" id="ee-name" value="${escapeHtml(e.name)}">
          </div>
          <div class="field-stack">
            <div class="field-caption"><span>区分</span></div>
            ${segmentedHtml("ee-meal", meal)}
          </div>
          <div class="field-row">
            <label class="field-label" for="ee-time">時刻</label>
            <input type="time" id="ee-time" value="${escapeHtml(e.time || "12:00")}">
          </div>
          <div class="field-stack">
            <div class="field-caption"><span>メモ</span></div>
            <input type="text" id="ee-memo" value="${escapeHtml(e.note || "")}" placeholder="外食・自炊 など">
          </div>
        </div>
      </div>

      ${portion.totalGrams || portion.basis ? `
      <div class="group">
        <div class="group-title">量の判断</div>
        <div class="list">
          ${portion.totalGrams ? `<div class="row"><span class="row-main"><span class="row-label" style="font-size:15px;">推定した合計重量</span></span><span class="row-value" style="font-size:15px;">${portion.totalGrams} g</span></div>` : ""}
          ${portion.basis ? `<div class="row"><span class="row-main"><span class="row-label" style="font-size:15px;">判断のしかた</span><span class="row-sub">${escapeHtml(portion.basis)}</span></span></div>` : ""}
        </div>
      </div>` : ""}

      <div class="group">
        <div class="group-title">栄養素</div>
        <div class="list">
          ${mainKeys.map(numRow).join("")}
        </div>
        <details class="more-nutrients">
          <summary>すべての栄養素を編集</summary>
          <div class="list" style="margin-top:10px;">${restKeys.map(numRow).join("")}</div>
        </details>
      </div>

      <div class="actions" style="margin-top:20px;">
        <button type="button" class="btn btn-primary" data-action="entry-save" data-date="${dateKey}" data-id="${e.id}">変更を保存</button>
        <button type="button" class="btn btn-tinted" data-action="open-share" data-date="${dateKey}" data-id="${e.id}">
          ${iconHtml("share", 16)} この食事を共有
        </button>
        <button type="button" class="btn btn-gray fav-toggle ${isFav ? "is-fav" : ""}" data-action="entry-fav" data-name="${escapeHtml(e.name)}" data-date="${dateKey}" data-id="${e.id}">
          <span class="fav-ic">${iconHtml(isFav ? "starFill" : "star", 16)}</span>
          <span class="fav-tx">${isFav ? "よく食べるものから外す" : "よく食べるものに追加"}</span>
        </button>
        <button type="button" class="btn btn-danger" data-action="entry-delete" data-date="${dateKey}" data-id="${e.id}">この記録を削除</button>
      </div>
    </div>
  `);
}

function saveEntrySheet(dateKey, id) {
  const root = $("#entry-edit");
  if (!root) return;
  const nutrients = {};
  Object.keys(NUTRIENT_META).forEach((k) => {
    const input = $(`#ee-${k}`, root);
    nutrients[k] = Math.round((parseFloat(input?.value) || 0) * 10) / 10;
  });
  const patch = {
    name: ($("#ee-name", root)?.value || "食事").trim() || "食事",
    meal: $("input[name=ee-meal]:checked", root)?.value || "lunch",
    time: $("#ee-time", root)?.value || "12:00",
    note: ($("#ee-memo", root)?.value || "").trim(),
    nutrients,
  };
  const status = Storage.updateLog(dateKey, id, patch);
  notifySaveResult(status);
  buzz();
  closeSheet();
  showToast("変更を保存しました");
  render();
}

function deleteEntry(dateKey, id) {
  const removed = Storage.deleteLog(dateKey, id);
  closeSheet();
  render();
  if (!removed) return;
  buzz(12);
  showToast("記録を削除しました", {
    actionLabel: "元に戻す",
    onAction: () => {
      Storage.restoreLog(dateKey, removed.entry, removed.index);
      render();
    },
  });
}

function toggleEntryFavorite(btn) {
  const name = btn.dataset.name;
  const existing = Storage.findFavoriteByName(name);
  if (existing) {
    Storage.removeFavorite(existing.id);
    btn.classList.remove("is-fav");
    $(".fav-ic", btn).innerHTML = iconHtml("star", 16);
    $(".fav-tx", btn).textContent = "よく食べるものに追加";
    showToast("よく食べるものから外しました");
  } else {
    const e = findEntry(btn.dataset.date, btn.dataset.id);
    if (!e) return;
    Storage.addFavorite({ id: newEntryId(), name: e.name, meal: e.meal, nutrients: e.nutrients, thumb: e.thumb, items: e.items || [] });
    btn.classList.add("is-fav");
    $(".fav-ic", btn).innerHTML = iconHtml("starFill", 16);
    $(".fav-tx", btn).textContent = "よく食べるものから外す";
    buzz();
    showToast("よく食べるものに追加しました");
  }
}

// ---------------- 人に見せる(共有) ----------------
//
// サーバーを持たず、カード画像を端末で描いて端末の共有メニューへ渡すだけ。
// どこにも送信しないので、費用も預かる責任も発生しない。

function openShareSheet(dateKey, id) {
  const e = findEntry(dateKey, id);
  if (!e) return;
  const targets = calcTargets(state.profile);

  openSheet("この食事を共有", `
    <div id="share-sheet" data-date="${dateKey}" data-id="${id}">
      <p class="guide-lead">写真と栄養を1枚のカードにして、お使いのアプリへ渡します。
      カードはこの端末の中で作られ、開発者のサーバーには送信されません。</p>

      <div class="share-preview"><div class="spinner"></div></div>

      <div class="group">
        <div class="list">
          <label class="check-row no-sep">
            <input type="checkbox" id="sh-nutrients" checked>
            <span>栄養の内訳(たんぱく質・脂質・炭水化物)も載せる</span>
          </label>
        </div>
        <div class="group-note">外すと、料理名とエネルギーだけのカードになります。</div>
      </div>

      <div class="actions" style="margin-top:18px;">
        <button type="button" class="btn btn-primary" data-action="do-share" data-date="${dateKey}" data-id="${id}">
          ${iconHtml("share", 17)} <span class="sh-label">共有する</span>
        </button>
      </div>
      <p class="footnote" style="text-align:center;margin-top:14px;">
        いいねやコメントは、渡した先のアプリでやり取りされます。
      </p>
    </div>
  `);

  refreshSharePreview(e, targets);
  // 内訳の有無を切り替えたら、見本を作り直す
  const cb = $("#sh-nutrients");
  if (cb) cb.addEventListener("change", () => refreshSharePreview(e, targets));
}

async function refreshSharePreview(entry, targets) {
  const box = $(".share-preview");
  if (!box) return;
  const showNutrients = $("#sh-nutrients")?.checked !== false;
  try {
    const blob = await renderShareCard(entry, targets, { showNutrients });
    if (!blob || !$(".share-preview")) return;
    const url = URL.createObjectURL(blob);
    box.innerHTML = `<img src="${url}" alt="共有するカードの見本">`;
    $("img", box).addEventListener("load", () => URL.revokeObjectURL(url), { once: true });
  } catch (e) {
    box.innerHTML = `<p class="muted" style="padding:20px;text-align:center;">見本を作れませんでした</p>`;
  }
}

async function doShare(btn) {
  const e = findEntry(btn.dataset.date, btn.dataset.id);
  if (!e) return;
  const showNutrients = $("#sh-nutrients")?.checked !== false;
  const label = $(".sh-label", btn);
  btn.disabled = true;
  if (label) label.textContent = "準備しています…";

  const result = await shareEntry(e, calcTargets(state.profile), { showNutrients });

  btn.disabled = false;
  if (label) label.textContent = "共有する";

  if (result === "shared") {
    buzz();
    closeSheet();
    showToast("共有しました");
  } else if (result === "downloaded") {
    closeSheet();
    showToast("カードを画像として保存しました");
  } else if (result === "failed") {
    showToast("カードを作れませんでした");
  }
  // "cancelled"(利用者が閉じた)は何も言わない
}

// ---------------- よく食べるもの ----------------

function quickAddFavorite(favId) {
  const fav = Storage.getFavorites().find((f) => f.id === favId);
  if (!fav) return;
  const entry = {
    id: newEntryId(),
    time: nowTimeStr(),
    name: fav.name,
    meal: guessMeal(new Date().getHours()),
    items: fav.items || [],
    nutrients: fav.nutrients,
    note: "",
    thumb: fav.thumb || null,
  };
  const status = Storage.addLog(activeLogDate(), entry);
  notifySaveResult(status);
  buzz();
  render();
  showToast(`「${fav.name}」を記録しました`, {
    actionLabel: "元に戻す",
    onAction: () => {
      Storage.deleteLog(todayKey(), entry.id);
      render();
    },
  });
}

function openFavManageSheet() {
  const favs = Storage.getFavorites();
  const rows = favs.length
    ? favs.map((f) => `
        <div class="row with-thumb">
          ${f.thumb ? `<img class="thumb" src="${f.thumb}" alt="" decoding="async">` : `<span class="thumb">${iconHtml("meal", 18)}</span>`}
          <span class="row-main">
            <span class="row-label ellipsis">${escapeHtml(f.name)}</span>
            <span class="row-sub">${Math.round(f.nutrients?.calories || 0)} kcal</span>
          </span>
          <button class="icon-btn" data-action="fav-remove" data-id="${f.id}" aria-label="削除">${iconHtml("close", 13)}</button>
        </div>`).join("")
    : `<div class="empty">${iconHtml("star", 30)}<div class="title">まだ登録がありません</div><div class="body">解析結果や記録の詳細から「よく食べるもの」に追加すると、写真なしで1タップで記録できるようになります。</div></div>`;
  openSheet("よく食べるもの", `<div class="list">${rows}</div>`);
}

// ---------------- 写真なしの手入力 ----------------

function openManualAddSheet() {
  const meal = guessMeal(new Date().getHours());
  const fields = [
    ["calories", "エネルギー", "kcal"], ["protein", "たんぱく質", "g"],
    ["fat", "脂質", "g"], ["carb", "炭水化物", "g"], ["salt", "食塩相当量", "g"],
  ];
  openSheet("写真なしで記録", `
    <div id="manual-add">
      <div class="group">
        <div class="list">
          <div class="field-stack">
            <div class="field-caption"><span>名前</span></div>
            <input type="text" id="ma-name" placeholder="例: おにぎり(鮭)・コーヒー">
          </div>
          <div class="field-stack">
            <div class="field-caption"><span>区分</span></div>
            ${segmentedHtml("ma-meal", meal)}
          </div>
          ${fields.map(([k, label, unit]) => `
            <div class="field-row">
              <label class="field-label" for="ma-${k}" style="display:flex;align-items:center;gap:9px;min-width:130px;font-size:15px;">${nutrientIconHtml(k)} ${label}</label>
              <input type="number" step="0.1" id="ma-${k}" inputmode="decimal" placeholder="0">
              <span class="field-unit">${unit}</span>
            </div>`).join("")}
        </div>
        <div class="group-note">分かる項目だけで構いません。あとから記録を開けば、すべての栄養素を直せます。</div>
      </div>
      <div class="actions" style="margin-top:16px;">
        <button type="button" class="btn btn-primary" data-action="manual-add-save">${iconHtml("plus", 16)} 記録に追加</button>
      </div>
    </div>
  `);
}

function saveManualAdd() {
  const root = $("#manual-add");
  if (!root) return;
  const name = ($("#ma-name", root)?.value || "").trim();
  if (!name) { showToast("名前を入力してください"); return; }
  const nutrients = {};
  Object.keys(NUTRIENT_META).forEach((k) => {
    const input = $(`#ma-${k}`, root);
    nutrients[k] = input ? Math.round((parseFloat(input.value) || 0) * 10) / 10 : 0;
  });
  const entry = {
    id: newEntryId(),
    time: nowTimeStr(),
    name,
    meal: $("input[name=ma-meal]:checked", root)?.value || guessMeal(new Date().getHours()),
    items: [],
    nutrients,
    note: "",
    thumb: null,
  };
  const status = Storage.addLog(activeLogDate(), entry);
  notifySaveResult(status);
  buzz();
  closeSheet();
  render();
  showToast("記録に追加しました");
}

// ---------------- 体重 ----------------

function latestWeight() {
  const w = Storage.getWeights();
  const keys = Object.keys(w).sort();
  return keys.length ? w[keys[keys.length - 1]] : state.profile?.weight || null;
}

function openWeightSheet() {
  const current = latestWeight();
  openSheet("体重を記録", `
    <div id="weight-sheet">
      <div class="weight-input-wrap">
        <input type="number" id="ws-kg" step="0.1" min="25" max="300" inputmode="decimal" value="${current ?? ""}" placeholder="60.0">
        <span class="weight-unit">kg</span>
      </div>
      <label class="check-row">
        <input type="checkbox" id="ws-update-profile" checked>
        <span>プロフィールの体重も更新する(1日の目標に反映されます)</span>
      </label>
      <div class="group" style="margin-top:22px;">
        <div class="group-title">目指す体重(任意)</div>
        <div class="list">
          <div class="field-row">
            <span class="field-label">目標</span>
            <input type="number" id="ws-target" step="0.1" min="25" max="300" inputmode="decimal"
                   value="${state.profile?.targetWeight ?? ""}" placeholder="決めていない">
            <span class="field-unit">kg</span>
          </div>
        </div>
        <div class="group-note" id="ws-target-note">${targetWeightNote(state.profile?.targetWeight)}</div>
      </div>
      <div class="actions" style="margin-top:18px;">
        <button type="button" class="btn btn-primary" data-action="weight-save">保存する</button>
      </div>
      <p class="footnote" style="text-align:center;margin-top:14px;">${formatDateLabel(todayKey())} の記録として保存します。同じ日に保存し直すと上書きされます。</p>
    </div>
  `);
  setTimeout(() => { const i = $("#ws-kg"); if (i) { i.focus(); i.select(); } }, 120);
}

function saveWeightSheet() {
  const v = parseFloat($("#ws-kg")?.value);
  if (!Number.isFinite(v) || v < 25 || v > 300) { showToast("体重を正しく入力してください(25〜300kg)"); return; }
  const kg = Math.round(v * 10) / 10;
  Storage.setWeight(todayKey(), kg);
  if (state.profile) {
    if ($("#ws-update-profile")?.checked) state.profile.weight = kg;
    const tRaw = ($("#ws-target")?.value || "").trim();
    const t = parseFloat(tRaw);
    state.profile.targetWeight = tRaw === "" ? null : (Number.isFinite(t) && t >= 25 && t <= 300 ? Math.round(t * 10) / 10 : state.profile.targetWeight);
    Storage.saveProfile(state.profile);
  }
  buzz();
  closeSheet();
  render();
  showToast(`体重 ${kg} kg を記録しました`);
}

// 目指す体重についての一言。
// 目標を持つこと自体は止めない(それは本人が決めることなので)。
// ただし、痩せすぎにあたる値のときだけ、責めない言い方で一度だけ伝える。
// 咎めるためではなく、知らずに設定している場合があるため。
function targetWeightNote(target) {
  const p = state.profile;
  const t = parseFloat(target);
  if (!Number.isFinite(t) || !p || !p.height) {
    return "決めなくても構いません。決めると「トレンド」の体重に目安の線が出ます。";
  }
  const m = p.height / 100;
  const bmi = t / (m * m);
  const bmiText = `目標のBMIは ${Math.round(bmi * 10) / 10} です。`;
  if (bmi < 18.5) {
    return `${bmiText}<strong>これは「低体重(やせ)」にあたる範囲です。</strong>
      目標を変えてほしいという意味ではありませんが、この範囲では月経が止まる、
      骨が弱くなる、疲れやすくなるといったことが起こりやすくなります。
      体調に変わったことがあれば、早めに医療機関にご相談ください。`;
  }
  if (bmi >= 25) {
    return `${bmiText}無理のない範囲で、少しずつ進めてください。`;
  }
  return `${bmiText}標準の範囲(18.5〜25)に収まっています。`;
}

// 目標体重までの残りを、責めない言い方で返す
function targetWeightProgressHtml(latest) {
  const p = state.profile;
  const t = parseFloat(p && p.targetWeight);
  if (!Number.isFinite(t) || !Number.isFinite(latest)) return "";
  const diff = Math.round((latest - t) * 10) / 10;
  const abs = Math.abs(diff);
  let text;
  if (abs < 0.3) text = `目標の ${t} kg に届いています。`;
  else if (diff > 0) text = `目標 ${t} kg まで あと ${abs} kg。`;
  else text = `目標 ${t} kg まで あと ${abs} kg(増やす方向)。`;
  return `<p class="muted" style="margin:10px 0 0;">${text}</p>`;
}

// ---------------- 撮り忘れた日を、後から埋める ----------------

// ズボラな人が記録をやめる一番の理由は「その場で撮り忘れて、そのまま放置する」こと。
// 空いた日を責めずに見せて、いつでも埋められるようにしておく。
// 責める言い方をしないことと、埋めるのが1タップで始まることの両方が要る。
function missingDaysHtml() {
  // 今日は「まだ」なので数えない。直近6日のうち、記録が1件も無い日を見る。
  const days = lastNDates(7).slice(0, 6);
  const missing = days.filter((k) => Storage.getLogsForDate(k).length === 0);
  if (!missing.length) return "";

  // 何日も空いていると、全部並べたら責められている感じになる。新しい方から2日だけ。
  const show = missing.slice(-2).reverse();
  return `
    <div class="group">
      <div class="group-title">まだ入れられます</div>
      <div class="list">
        ${show.map((k) => `
          <button type="button" class="row with-icon tappable" data-action="backfill" data-date="${k}">
            <span class="row-icon">${iconHtml("camera", 16)}</span>
            <span class="row-main">
              <span class="row-label">${formatDateLabel(k)}</span>
              <span class="row-sub">この日の記録を入れる</span>
            </span>
            <span class="row-chevron">${iconHtml("chevron", 14)}</span>
          </button>`).join("")}
      </div>
      <div class="group-note">思い出したときで構いません。写真が無くても「手入力」で入れられます。</div>
    </div>
  `;
}

// 前の日に食べたものを、そのまま今日に写す。
// 毎日だいたい同じものを食べる人には、これが最短の記録になる。
function repeatYesterdayHtml() {
  const base = new Date();
  const y = dateKeyOf(new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1));
  const entries = Storage.getLogsForDate(y);
  if (!entries.length) return "";
  const already = Storage.getLogsForDate(activeLogDate()).map((e) => e.name);
  // すでに同じ名前を入れてある分は出さない(二重に入れてしまう事故を防ぐ)
  const rest = entries.filter((e) => !already.includes(e.name)).slice(0, 4);
  if (!rest.length) return "";

  return `
    <div class="group" style="margin-top:24px;">
      <div class="group-title">昨日と同じ</div>
      <div class="list">
        ${rest.map((e) => `
          <div class="row with-thumb">
            ${e.thumb ? `<img class="thumb" src="${e.thumb}" alt="" decoding="async">` : `<span class="thumb">${iconHtml("meal", 18)}</span>`}
            <span class="row-main">
              <span class="row-label ellipsis">${escapeHtml(e.name)}</span>
              <span class="row-sub">${MEALS[e.meal]?.label || ""} ・ ${Math.round(e.nutrients?.calories || 0)} kcal</span>
            </span>
            <button type="button" class="quick-add" data-action="repeat-add" data-date="${y}" data-id="${e.id}" aria-label="${escapeHtml(e.name)}を記録">${iconHtml("plus", 15)}</button>
          </div>`).join("")}
      </div>
      <div class="group-note">＋を押すと、同じ内容を今の時刻で記録します。</div>
    </div>
  `;
}

function repeatAdd(btn) {
  const src = findEntry(btn.dataset.date, btn.dataset.id);
  if (!src) { showToast("元の記録が見つかりませんでした"); return; }
  const entry = {
    id: newEntryId(),
    time: nowTimeStr(),
    name: src.name,
    meal: guessMeal(new Date().getHours()),
    items: src.items || [],
    nutrients: Object.assign({}, src.nutrients),
    note: src.note || "",
    thumb: src.thumb || null,
    portion: src.portion || null,
    source: src.source || null,
    confidence: src.confidence || null,
  };
  const status = Storage.addLog(activeLogDate(), entry);
  notifySaveResult(status);
  buzz();
  render();
  showToast(`${src.name} を記録しました`, {
    actionLabel: "確認",
    onAction: () => openEntrySheet(activeLogDate(), entry.id),
  });
}

// 過去の日を埋めているときに、それと分かるように出す帯
function backfillBannerHtml() {
  if (!isBackfilling()) return "";
  return `
    <div class="notice" style="margin-bottom:16px;">
      ${iconHtml("info", 16)}
      <span><strong>${formatDateLabel(state.logDate)}</strong> の記録として保存します。
      <button type="button" class="btn btn-plain btn-sm" data-action="backfill-cancel" style="min-height:0;padding:0 0 0 6px;">今日に戻す</button></span>
    </div>
  `;
}

// 記録タブを開いたら、すぐカメラを出すか。
// 既定は「出さない」。よく食べるものや手入力を選びたいときに
// カメラが割り込むと、かえって手間が増えるため。
function instantCameraEnabled() {
  return (state.profile || {}).instantCamera === true;
}

function toggleInstantCamera() {
  state.profile.instantCamera = !instantCameraEnabled();
  Storage.saveProfile(state.profile);
  buzz();
  render();
  showToast(instantCameraEnabled() ? "記録タブでカメラをすぐ出します" : "カメラは自分で開きます");
}

function toggleAutoLog() {
  state.profile.autoLog = !autoLogEnabled();
  Storage.saveProfile(state.profile);
  buzz();
  render();
  showToast(autoLogEnabled() ? "撮ったらそのまま記録します" : "記録の前に確認します");
}

// ---------------- 目標を自分で決める ----------------

// 既定値は厚生労働省「日本人の食事摂取基準(2025年版)」から算出している。
// ここでは、それを自分の値に置き換えられるようにする。
// 既定を消すわけではなく、空欄にすればいつでも戻る。
function openTargetsSheet() {
  const p = state.profile;
  const dri = calcTargetsFromDri(p);
  const custom = p.customTargets || {};

  const rows = CUSTOMIZABLE_TARGETS.map((k) => {
    const meta = NUTRIENT_META[k];
    const v = custom[k];
    return `
      <div class="field-row">
        <span class="field-label" style="min-width:118px;">${escapeHtml(meta.label)}</span>
        <input type="number" step="0.1" min="0" id="tg-${k}" data-target-key="${k}"
               inputmode="decimal" value="${v != null && v !== "" ? v : ""}"
               placeholder="${dri[k]}">
        <span class="field-unit">${escapeHtml(meta.unit)}</span>
      </div>`;
  }).join("");

  openSheet("目標を自分で決める", `
    <div id="targets-sheet">
      <p class="guide-lead">
        薄く表示されている数値が、いまのプロフィールから求めた既定値です。
        自分で決めたい項目だけ入力してください。<strong>空欄のままなら既定値を使います。</strong>
      </p>
      <div class="group">
        <div class="list">${rows}</div>
        <div class="group-note">
          既定値は厚生労働省「日本人の食事摂取基準(2025年版)」に基づく、
          健康な人の集団に向けた目安です。持病がある、妊娠・授乳中である、
          運動量が特別に多いなど、事情がある場合はご自身の値のほうが実態に合います。
          <strong>治療のための食事制限は、必ず主治医や管理栄養士の指示に従ってください。</strong>
        </div>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-primary" data-action="targets-save">保存する</button>
        <button type="button" class="btn btn-plain" data-action="targets-reset">すべて既定値に戻す</button>
      </div>
    </div>
  `);
}

function saveTargetsSheet() {
  const custom = {};
  CUSTOMIZABLE_TARGETS.forEach((k) => {
    const el = $(`#tg-${k}`);
    const raw = el ? el.value.trim() : "";
    if (raw === "") return;
    const v = parseFloat(raw);
    if (Number.isFinite(v) && v > 0) custom[k] = Math.round(v * 10) / 10;
  });
  state.profile.customTargets = custom;
  Storage.saveProfile(state.profile);
  buzz();
  closeSheet();
  render();
  const n = Object.keys(custom).length;
  showToast(n === 0 ? "すべて既定値に戻しました" : `${n}件の目標を自分の値にしました`);
}

function resetTargetsSheet() {
  CUSTOMIZABLE_TARGETS.forEach((k) => { const el = $(`#tg-${k}`); if (el) el.value = ""; });
  showToast("入力欄を空にしました。保存すると既定値に戻ります");
}

// ---------------- データの書き出し・読み込み ----------------

function doExportData() {
  const profile = state.profile ? Object.assign({}, state.profile) : null;
  if (profile) delete profile.apiKeys; // キーは安全のため書き出さない
  const payload = {
    app: "nutrition-tracker-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    profile,
    logs: Storage.getAllLogs(),
    weights: Storage.getWeights(),
    favorites: Storage.getFavorites(),
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `nutrition-backup-${todayKey()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  showToast("バックアップを書き出しました(APIキーは含まれません)");
}

function handleImportFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => showToast("ファイルを読み込めませんでした");
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (e) {
      showToast("このファイルは読み込めません(JSONではありません)");
      return;
    }
    if (data?.app !== "nutrition-tracker-backup" || !data.logs) {
      showToast("このアプリのバックアップファイルではないようです");
      return;
    }
    const logDays = Object.keys(data.logs || {}).length;
    const nEntries = Object.values(data.logs || {}).reduce((s, l) => s + (Array.isArray(l) ? l.length : 0), 0);
    const nWeights = Object.keys(data.weights || {}).length;
    const nFavs = (data.favorites || []).length;
    if (!confirm(`バックアップを読み込みます。\n食事の記録 ${nEntries}件(${logDays}日分)・体重 ${nWeights}件・よく食べるもの ${nFavs}件\n\n今の記録に統合されます(同じ記録は重複しません)。よろしいですか？`)) return;

    // 記録: 日付ごとに統合し、同じIDは取り込まない
    const all = Storage.getAllLogs();
    Object.entries(data.logs || {}).forEach(([d, entries]) => {
      if (!Array.isArray(entries)) return;
      if (!all[d]) all[d] = [];
      const ids = new Set(all[d].map((e) => e.id));
      entries.forEach((e) => {
        if (e && e.id && e.nutrients && !ids.has(e.id)) all[d].push(e);
      });
      all[d].sort((a, b) => ((a.time || "") < (b.time || "") ? 1 : -1));
    });
    const status = Storage.setAllLogs(all);

    // 体重: 同じ日は読み込んだ値で上書き
    Object.entries(data.weights || {}).forEach(([k, v]) => {
      const kg = Number(v);
      if (Number.isFinite(kg) && kg >= 25 && kg <= 300) Storage.setWeight(k, kg);
    });

    // よく食べるもの: 名前で重複を除いて統合
    const favs = Storage.getFavorites();
    const names = new Set(favs.map((f) => f.name));
    (data.favorites || []).forEach((f) => {
      if (f && f.name && f.nutrients && !names.has(f.name)) favs.push(f);
    });
    Storage.saveFavorites(favs.slice(0, 30));

    // プロフィール: いま無い場合のみ取り込む(APIキーは含まれていない)
    if (!state.profile && data.profile) {
      state.profile = Object.assign({ apiKeys: {}, models: {}, baseUrls: {}, provider: DEFAULT_PROVIDER }, data.profile);
      Storage.saveProfile(state.profile);
      state.view = "home";
    }

    notifySaveResult(status);
    render();
    showToast("バックアップを読み込みました");
  };
  reader.readAsText(file);
}

// ---------------- 集計ヘルパー ----------------

// 直近n日の日ごとの合計(古い→新しい)
function dailySums(n) {
  const all = Storage.getAllLogs();
  return lastNDates(n).map((key) => {
    const entries = all[key] || [];
    return { key, entries, count: entries.length, sum: sumNutrients(entries) };
  });
}

// 連続記録日数。今日まだ記録がなくても、昨日まで続いていれば継続として数える
function streakDays() {
  const all = Storage.getAllLogs();
  let streak = 0;
  const base = new Date();
  for (let i = 0; i < 3660; i++) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
    const has = (all[dateKeyOf(d)] || []).length > 0;
    if (has) streak++;
    else if (i === 0) continue; // 今日はまだこれから
    else break;
  }
  return streak;
}

// ---------------- 部品 ----------------

function selectRow(label, name, optionsHtml, id, attrs = "") {
  return `
    <div class="field-row">
      <label class="field-label" for="${id}">${label}</label>
      <select id="${id}" name="${name}" ${attrs}>${optionsHtml}</select>
    </div>
  `;
}

function numberRow(label, name, id, unit, value, attrs) {
  return `
    <div class="field-row">
      <label class="field-label" for="${id}">${label}</label>
      <input type="number" id="${id}" name="${name}" value="${value ?? ""}" ${attrs} inputmode="decimal">
      <span class="field-unit">${unit}</span>
    </div>
  `;
}

// あなたのことを尋ねる欄
function profileFieldsHtml(p, prefix) {
  const activityOptions = Object.entries(ACTIVITY_LEVELS)
    .map(([k, v]) => `<option value="${k}" ${p.activity === k ? "selected" : ""}>${v.label}</option>`)
    .join("");
  const goalOptions = Object.entries(GOALS)
    .map(([k, v]) => `<option value="${k}" ${(p.goal || "maintain") === k ? "selected" : ""}>${v.label}</option>`)
    .join("");
  const sexOptions = `
    <option value="" ${!p.sex ? "selected" : ""}>選択</option>
    <option value="male" ${p.sex === "male" ? "selected" : ""}>男性</option>
    <option value="female" ${p.sex === "female" ? "selected" : ""}>女性</option>
  `;

  const menstruationOptions = `
    <option value="yes" ${(p.menstruation || "yes") === "yes" ? "selected" : ""}>あり</option>
    <option value="no" ${p.menstruation === "no" ? "selected" : ""}>なし</option>
  `;

  return `
    <div class="group">
      <div class="group-title">からだのこと</div>
      <div class="list">
        ${numberRow("年齢", "age", `${prefix}-age`, "歳", p.age, 'min="18" max="120" placeholder="30"')}
        ${selectRow("性別", "sex", sexOptions, `${prefix}-sex`)}
        ${numberRow("身長", "height", `${prefix}-height`, "cm", p.height, 'min="100" max="230" step="0.1" placeholder="165"')}
        ${numberRow("体重", "weight", `${prefix}-weight`, "kg", p.weight, 'min="25" max="300" step="0.1" placeholder="58"')}
        <div class="field-row hidden" data-role="menstruation-row">
          <label class="field-label" for="${prefix}-menstruation">月経</label>
          <select id="${prefix}-menstruation" name="menstruation">${menstruationOptions}</select>
        </div>
      </div>
      <div class="group-note">
        年齢・性別・体重は、食事摂取基準の年齢区分と基礎代謝基準値をあてはめるために使います。
        鉄の推奨量は月経の有無で変わるため、18〜64歳の女性のみお尋ねしています。
      </div>
    </div>

    <div class="group">
      <div class="group-title">生活と目標</div>
      <div class="list">
        ${selectRow("活動レベル", "activity", activityOptions, `${prefix}-activity`)}
        ${selectRow("目標", "goal", goalOptions, `${prefix}-goal`)}
      </div>
      <div class="group-note" data-role="activity-desc"></div>
      <div class="group-note">
        増量・減量を選ぶと、エネルギーとたんぱく質の目標量が調整されます。ここだけは食事摂取基準の範囲外の、一般的な目安です。
      </div>
    </div>
  `;
}

// 写真解析に使うAIを設定する欄(手順書へのボタンを含む)
function aiFieldsHtml(p, prefix) {
  const currentProvider = p.provider || DEFAULT_PROVIDER;
  const providerOptions = Object.entries(PROVIDERS)
    .map(([k, v]) => `<option value="${k}" ${currentProvider === k ? "selected" : ""}>${v.shortLabel}</option>`)
    .join("");

  return `
    <div class="group">
      <div class="group-title">写真解析に使うAI</div>
      <div class="list">
        ${selectRow("サービス", "provider", providerOptions, `${prefix}-provider`, 'data-role="provider-select"')}

        <div class="field-stack">
          <div class="field-caption">
            <span data-role="key-label">APIキー</span>
            <button type="button" class="hint-btn" data-action="open-key-guide">
              ${iconHtml("help", 14)} 取得のしかた
            </button>
          </div>
          <div class="input-with-action">
            <input type="password" id="f-apikey" name="apiKey" value="" autocomplete="off" spellcheck="false" aria-label="APIキー">
            <button type="button" class="btn btn-gray btn-sm" data-action="toggle-key-visibility">表示</button>
          </div>
        </div>

        <div class="field-stack hidden" data-role="baseurl-row">
          <div class="field-caption"><span>APIのベースURL</span></div>
          <input type="text" name="baseUrl" value="" autocomplete="off" spellcheck="false" placeholder="https://openrouter.ai/api/v1">
        </div>

        <div class="field-stack">
          <div class="field-caption"><span>モデル</span></div>
          <input type="text" name="model" id="${prefix}-model" value="" list="model-suggestions" autocomplete="off" spellcheck="false">
          <datalist id="model-suggestions"></datalist>
        </div>

        <button type="button" class="row with-icon tappable" data-action="test-connection">
          <span class="row-icon">${iconHtml("sparkle", 16)}</span>
          <span class="row-main">
            <span class="row-label">接続テスト</span>
            <span class="row-sub" data-role="test-result">キーとモデル名が正しいか確かめます</span>
          </span>
        </button>
      </div>
      <div class="group-note" style="display:flex;justify-content:flex-end;padding-top:12px;">
        <span class="chip" data-role="provider-cost"></span>
      </div>
      <div class="group-note" data-role="provider-help"></div>
    </div>
  `;
}

function emptyProfile() {
  return { age: "", sex: "", height: "", weight: "", activity: "normal", goal: "maintain" };
}

// ---------------- 描画: オンボーディング ----------------

function renderOnboarding() {
  const p = emptyProfile();
  state.obStep = 0;

  return `
    <form id="onboarding-form" novalidate>
      <div class="ob-progress" aria-hidden="true"><i class="on"></i><i></i><i></i></div>

      <section class="ob-step on" data-step="0">
        <div class="ob-hero">
          <div class="mark">${iconHtml("meal", 30)}</div>
          <h1 class="large-title">食べたものを、<br>撮るだけ。</h1>
          <p class="lede">写真からAIが栄養素を読み取り、あなたに必要な量と比べます。</p>
        </div>
        <div class="panel">
          <div class="feature">
            <span class="fi">${iconHtml("camera", 20)}</span>
            <span><span class="ft">撮れば、記録される</span><span class="fd">料理の写真からエネルギーと栄養素を推定します。成分表示が写っていれば、その数値をそのまま読み取ります。</span></span>
          </div>
          <div class="feature">
            <span class="fi">${iconHtml("sparkle", 20)}</span>
            <span><span class="ft">あなたのAIにつなぐ</span><span class="fd">お使いのAIサービスのAPIキーを登録して使います。無料で使えるものも選べます。</span></span>
          </div>
          <div class="feature">
            <span class="fi">${iconHtml("trend", 20)}</span>
            <span><span class="ft">傾向まで見える</span><span class="fd">日々の記録から、エネルギー・栄養バランス・体重の推移をまとめて振り返れます。</span></span>
          </div>
          <div class="feature">
            <span class="fi">${iconHtml("database", 20)}</span>
            <span><span class="ft">記録は端末の中だけ</span><span class="fd">食事の記録は、この端末のブラウザにのみ保存されます。開発者には送信されません。</span></span>
          </div>
        </div>
      </section>

      <section class="ob-step" data-step="1">
        <div class="ob-hero" style="padding-bottom:24px;">
          <h1 class="large-title">あなたのこと</h1>
          <p class="lede">1日に必要な栄養量を計算します。</p>
        </div>
        ${profileFieldsHtml(p, "ob")}
      </section>

      <section class="ob-step" data-step="2">
        <div class="ob-hero" style="padding-bottom:24px;">
          <h1 class="large-title">AIにつなぐ</h1>
          <p class="lede">写真から栄養を読み取るAIを登録します。つながることを確かめてから始めます。</p>
        </div>
        ${aiFieldsHtml(p, "ob")}
        <div class="notice" data-role="ob-gate">
          ${iconHtml("info", 16)}
          <span>先に「接続テスト」を押して、AIにつながることを確認してください。確認できるまで次へ進めません。</span>
        </div>
        <div class="notice good hidden" data-role="ob-gate-done">
          ${iconHtml("check", 16)}
          <span>AIにつながることを確認しました。</span>
        </div>
      </section>

      <div class="notice hidden" data-role="form-error"></div>
      <div class="actions" data-role="ob-actions">${obFooterHtml(0)}</div>
    </form>
    <p class="disclaimer">1日の必要量やAIによる推定値は一般的な目安であり、医学的なアドバイスではありません。妊娠・授乳中の方や持病のある方は医師・管理栄養士にご相談ください。</p>
  `;
}

// ---------------- 描画: ホーム ----------------

function ringHtml(consumed, target) {
  const pct = target > 0 ? (consumed / target) * 100 : 0;
  const shown = Math.max(0, Math.min(100, pct));
  const over = consumed > target;
  const R = 84;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - shown / 100);
  return `
    <div class="ring ${over ? "over" : ""}">
      <svg viewBox="0 0 196 196" aria-hidden="true">
        <circle class="track" cx="98" cy="98" r="${R}" fill="none" stroke-width="13"/>
        <circle class="fill" cx="98" cy="98" r="${R}" fill="none" stroke-width="13"
                stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"/>
      </svg>
      <div class="ring-center">
        <span class="value">${Math.round(consumed)}</span>
        <span class="unit">/ ${target} kcal</span>
      </div>
    </div>
  `;
}

// ヒーローカードの右側: PFCの3行(データカラーで塗る)
function macroRowHtml(key, consumed, target) {
  const meta = NUTRIENT_META[key];
  const pct = target > 0 ? Math.min(100, Math.round((consumed / target) * 100)) : 0;
  return `
    <div class="macro">
      <div class="macro-head">
        <span class="macro-name"><i class="dot c-${key}"></i>${meta.label}</span>
        <span class="macro-val tnum">${Math.round(consumed)}<small> / ${target}${meta.unit}</small></span>
      </div>
      <div class="bar slim c-${key}"><span style="width:${pct}%"></span></div>
    </div>
  `;
}

function nutrientRow(key, consumed, target) {
  const meta = NUTRIENT_META[key];
  const pct = target > 0 ? Math.min(100, Math.round((consumed / target) * 100)) : 0;
  const over = consumed > target;
  const remain = Math.max(0, Math.round((target - consumed) * 10) / 10);
  // 「超過」という言い方はしない。数字は出すが、咎める言葉は使わない(減点しない方針)。
  const remainLabel = meta.isLimit
    ? (over ? `+${Math.round((consumed - target) * 10) / 10}${meta.unit}` : `あと ${remain}${meta.unit}`)
    : (over ? "達成" : `あと ${remain}${meta.unit}`);
  // 目標に届いたことは、警告ではなく達成として示す
  const barClass = meta.isLimit ? (over ? "over" : "") : (over ? "done" : "");
  return `
    <div class="nutrient">
      <div class="nutrient-head">
        <span class="nutrient-name">${nutrientIconHtml(key)} ${meta.label}</span>
        <span class="nutrient-val">${Math.round(consumed * 10) / 10} / ${target}${meta.unit} ・ ${remainLabel}</span>
      </div>
      <div class="bar ${barClass}"><span style="width:${pct}%"></span></div>
    </div>
  `;
}

function mealRowHtml(entry, dateKey) {
  const thumb = entry.thumb
    ? `<img class="thumb" src="${entry.thumb}" alt="" decoding="async">`
    : `<span class="thumb">${iconHtml(MEALS[entry.meal]?.icon || "meal", 18)}</span>`;
  return `
    <button type="button" class="row with-thumb tappable" data-action="open-entry" data-date="${dateKey}" data-id="${entry.id}">
      ${thumb}
      <span class="row-main">
        <span class="row-label ellipsis">${escapeHtml(entry.name)}</span>
        <span class="row-sub">${entry.time} ・ ${Math.round(entry.nutrients.calories)} kcal</span>
      </span>
      <span class="row-chevron">${iconHtml("chevron", 14)}</span>
    </button>
  `;
}

// 今日の食事を、朝食→昼食→間食→夕食の順に小見出し付きで並べる
function todayMealsHtml(logs, dateKey) {
  if (!logs.length) {
    return `<div class="empty">${iconHtml("meal", 30)}<div class="title">まだ記録がありません</div><div class="body">「記録」タブから、食事の写真を撮ってみましょう。</div></div>`;
  }
  const grouped = MEAL_ORDER.map((m) => ({
    meal: m,
    entries: logs
      .filter((e) => (MEALS[e.meal] ? e.meal : guessMeal(parseInt(e.time, 10) || 12)) === m)
      .sort((a, b) => (a.time > b.time ? 1 : -1)),
  })).filter((g) => g.entries.length);

  return grouped
    .map((g) => {
      const kcal = Math.round(g.entries.reduce((s, e) => s + (Number(e.nutrients?.calories) || 0), 0));
      return `
        <div class="list-subhead">
          <span class="msh-ic">${iconHtml(MEALS[g.meal].icon, 14)}</span>${MEALS[g.meal].label}
          <span class="msh-kcal tnum">${kcal} kcal</span>
        </div>
        ${g.entries.map((e) => `<div class="no-sep-wrap">${mealRowHtml(e, dateKey)}</div>`).join("")}
      `;
    })
    .join("");
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "こんばんは";
  if (h < 11) return "おはようございます";
  if (h < 18) return "こんにちは";
  return "こんばんは";
}

// この1週間のミニグラフ(タップでトレンドへ)
function weekStripHtml(targets) {
  const days = dailySums(7);
  const streak = streakDays();
  const cols = days
    .map((d) => {
      const pct = Math.min(100, Math.round(((d.sum.calories || 0) / targets.calories) * 100));
      const today = d.key === todayKey();
      return `
        <div class="wd ${today ? "today" : ""}">
          <div class="wd-bar"><span style="height:${d.count ? Math.max(pct, 6) : 0}%"></span></div>
          <span class="wd-label">${weekdayChar(d.key)}</span>
        </div>`;
    })
    .join("");

  return `
    <button type="button" class="panel week-panel tappable" data-action="goto-trends">
      <div class="panel-head" style="margin-bottom:12px;">
        <h3>この1週間</h3>
        <span class="week-side">
          ${streak >= 2 ? `<span class="badge accent">${iconHtml("flame", 12)} 連続${streak}日</span>` : ""}
          <span class="row-chevron">${iconHtml("chevron", 13)}</span>
        </span>
      </div>
      <div class="week-strip">${cols}</div>
    </button>
  `;
}

function renderHome() {
  const p = state.profile;
  const targets = calcTargets(p);
  const logs = Storage.getLogsForDate(todayKey());
  const consumed = sumNutrients(logs);
  const kcalOver = consumed.calories > targets.calories;
  const remainKcal = Math.max(0, targets.calories - Math.round(consumed.calories));
  const advice = buildAdvice(consumed, targets);

  const caption = kcalOver
    ? `目標を <strong>${Math.round(consumed.calories) - targets.calories}</strong> kcal 超えています`
    : `残り <strong>${remainKcal}</strong> kcal`;

  const detailHtml = state.showDetail
    ? SECONDARY_NUTRIENTS.map((k) => nutrientRow(k, consumed[k], targets[k])).join("")
    : "";

  return `
    <div class="nav-bar">
      <div>
        <div class="footnote" style="margin-bottom:2px;">${greeting()}・${formatDateLabel(todayKey())}</div>
        <h1 class="large-title">今日</h1>
      </div>
    </div>

    <div class="panel hero">
      <div class="hero-grid">
        <div class="hero-ring">
          ${ringHtml(consumed.calories, targets.calories)}
          <div class="ring-caption">${caption}</div>
        </div>
        <div class="macro-col">
          ${["protein", "fat", "carb"].map((k) => macroRowHtml(k, consumed[k], targets[k])).join("")}
        </div>
      </div>
    </div>

    ${weekStripHtml(targets)}

    <div class="group" style="margin-top:28px;">
      <div class="group-title">主要な栄養素</div>
      <div class="list">
        ${["fiber", "salt"].map((k) => nutrientRow(k, consumed[k], targets[k])).join("")}
        ${detailHtml}
        <button type="button" class="row tappable" data-action="toggle-detail">
          <span class="row-main"><span class="row-label" style="color:var(--accent);font-size:15px;">${state.showDetail ? "その他の栄養素を隠す" : "その他の栄養素も見る"}</span></span>
          <span class="row-chevron" style="transform:rotate(${state.showDetail ? "180deg" : "0deg"});">${iconHtml("chevronDown", 14)}</span>
        </button>
      </div>
    </div>

    <div class="group">
      <div class="group-title">アドバイス</div>
      <div class="list">
        ${advice.map((a) => `
          <div class="row with-icon">
            <span class="row-icon ${a.warn ? "warn" : ""}">${nutrientIconHtml(a.iconKey)}</span>
            <span class="row-main"><span class="row-label" style="font-size:15px;line-height:1.5;">${escapeHtml(a.text)}</span></span>
          </div>
        `).join("")}
      </div>
    </div>

    <div class="group">
      <div class="group-title">今日の記録</div>
      <div class="list">${todayMealsHtml(logs, todayKey())}</div>
    </div>

    ${missingDaysHtml()}
  `;
}

// ---------------- 描画: トレンド ----------------

function renderTrends() {
  const p = state.profile;
  const targets = calcTargets(p);
  const n = state.trendRange;
  const days = dailySums(n);
  const recorded = days.filter((d) => d.count > 0);
  const streak = streakDays();

  // エネルギーの棒グラフ
  const chartDays = days.map((d) => ({
    label: n <= 7 ? weekdayChar(d.key) : formatDateShort(d.key),
    v: Math.round(d.sum.calories || 0),
    today: d.key === todayKey(),
    // 目標より多い日を色で咎めない(減点しない方針)
    over: false,
  }));
  const avgKcal = recorded.length
    ? Math.round(recorded.reduce((s, d) => s + d.sum.calories, 0) / recorded.length)
    : 0;

  // PFCバランス(記録がある日の平均 %エネルギー)
  let pfcHtml = "";
  const daysWithKcal = recorded.filter((d) => d.sum.calories > 0);
  if (daysWithKcal.length) {
    const avgPct = (macroKey, kcalPerG) => {
      const pcts = daysWithKcal.map((d) => Math.min(100, ((d.sum[macroKey] * kcalPerG) / d.sum.calories) * 100));
      return pcts.reduce((s, v) => s + v, 0) / pcts.length;
    };
    const b = targetBasis(p);
    pfcHtml = `
      <div class="panel">
        <div class="panel-head"><h3>エネルギー産生栄養素バランス</h3></div>
        ${pfcBalanceRow("protein", "たんぱく質", avgPct("protein", 4), PROTEIN_DG[b.bandIndex])}
        ${pfcBalanceRow("fat", "脂質", avgPct("fat", 9), FAT_DG)}
        ${pfcBalanceRow("carb", "炭水化物", avgPct("carb", 4), CARB_DG)}
        <p class="footnote" style="margin-top:12px;">記録がある日の平均。帯が食事摂取基準の目標量(%エネルギー)の範囲です。</p>
      </div>`;
  }

  // 体重
  const weights = Storage.getWeights();
  const wKeys = Object.keys(weights).sort().slice(-30);
  const wPoints = wKeys.map((k) => ({ key: k, kg: Number(weights[k]) })).filter((pt) => Number.isFinite(pt.kg));
  const weightHtml = `
    <div class="panel">
      <div class="panel-head">
        <h3>体重</h3>
        ${wPoints.length ? `<span class="panel-side tnum">${wPoints[wPoints.length - 1].kg} kg</span>` : ""}
      </div>
      ${wPoints.length >= 2
        ? weightLineChart(wPoints)
        : `<p class="muted" style="margin:4px 0 14px;">${wPoints.length === 1 ? "あと1回記録すると、推移のグラフが出ます。" : "体重を記録すると、ここに推移が表示されます。"}</p>`}
      ${targetWeightProgressHtml(wPoints.length ? wPoints[wPoints.length - 1].kg : NaN)}
      <button type="button" class="btn btn-tinted btn-sm" data-action="open-weight" style="margin-top:${wPoints.length >= 2 ? "12px" : "0"};">${iconHtml("scale", 15)} 体重を記録</button>
    </div>`;

  // 栄養素ごとの平均充足率
  let fulfillHtml = "";
  if (recorded.length) {
    const avgOf = (k) => recorded.reduce((s, d) => s + (d.sum[k] || 0), 0) / recorded.length;
    const keys = ["protein", "fiber", "calcium", "iron", "zinc", "magnesium", "potassium",
      "vitaminA", "vitaminC", "vitaminD", "vitaminE", "vitaminB1", "vitaminB2", "vitaminB6", "vitaminB12", "folate"];
    const rows = keys.map((k) => {
      const avg = avgOf(k);
      const t = targets[k];
      const pct = t > 0 ? Math.round((avg / t) * 100) : 0;
      return `
        <div class="nutrient">
          <div class="nutrient-head">
            <span class="nutrient-name">${nutrientIconHtml(k)} ${NUTRIENT_META[k].label}</span>
            <span class="nutrient-val">平均 ${Math.round(avg * 10) / 10}${NUTRIENT_META[k].unit} ・ ${pct}%</span>
          </div>
          <div class="bar ${pct >= 100 ? "done" : ""}"><span style="width:${Math.min(100, pct)}%"></span></div>
        </div>`;
    }).join("");
    const limits = ["salt", "saturatedFat"].map((k) => {
      const avg = avgOf(k);
      const t = targets[k];
      const over = avg > t;
      const pct = t > 0 ? Math.min(100, Math.round((avg / t) * 100)) : 0;
      return `
        <div class="nutrient">
          <div class="nutrient-head">
            <span class="nutrient-name">${nutrientIconHtml(k)} ${NUTRIENT_META[k].label}</span>
            <span class="nutrient-val">平均 ${Math.round(avg * 10) / 10} / ${t}${NUTRIENT_META[k].unit} 以下</span>
          </div>
          <div class="bar ${over ? "over" : ""}"><span style="width:${pct}%"></span></div>
        </div>`;
    }).join("");
    fulfillHtml = `
      <div class="group">
        <div class="group-title">栄養素の平均充足率(記録がある日)</div>
        <div class="list">${rows}</div>
      </div>
      <div class="group">
        <div class="group-title">控えめにしたいもの</div>
        <div class="list">${limits}</div>
      </div>`;
  }

  return `
    <div class="nav-bar">
      <h1 class="large-title">トレンド</h1>
      <div class="segmented range">
        <button type="button" class="seg ${n === 7 ? "on" : ""}" data-action="set-trend-range" data-range="7">週</button>
        <button type="button" class="seg ${n === 30 ? "on" : ""}" data-action="set-trend-range" data-range="30">月</button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>エネルギー</h3>
        ${avgKcal ? `<span class="panel-side">平均 <strong class="tnum">${avgKcal}</strong> kcal</span>` : ""}
      </div>
      ${energyBarChart(chartDays, targets.calories)}
    </div>

    <div class="stat-grid">
      <div class="panel stat">
        <span class="stat-num tnum">${recorded.length}<small>/${n}日</small></span>
        <span class="stat-label">記録した日</span>
      </div>
      <div class="panel stat">
        <span class="stat-num tnum">${streak}<small>日</small></span>
        <span class="stat-label">連続記録</span>
      </div>
    </div>

    ${pfcHtml}
    ${weightHtml}
    ${fulfillHtml}
    ${!recorded.length ? `<div class="list" style="margin-top:20px;"><div class="empty">${iconHtml("trend", 30)}<div class="title">まだデータがありません</div><div class="body">食事を記録すると、ここに傾向が表示されます。</div></div></div>` : ""}
  `;
}

// ---------------- 描画: 記録(撮影・解析) ----------------

function renderResultForm(r) {
  const itemsText = r.items.length
    ? r.items
        .map((it) => {
          const detail = [it.amount, it.grams ? `約${it.grams}g` : ""].filter(Boolean).join(" ");
          return `${it.name}${detail ? `(${detail})` : ""}`;
        })
        .join("・")
    : "";
  const portion = r.portion || {};
  const portionHtml = portion.totalGrams || portion.basis || portion.reference
    ? `
      <div class="group">
        <div class="group-title">量の判断</div>
        <div class="list">
          ${portion.totalGrams ? `
            <div class="row">
              <span class="row-main"><span class="row-label" style="font-size:15px;">推定した合計重量</span></span>
              <span class="row-value" style="font-size:15px;">${portion.totalGrams} g</span>
            </div>` : ""}
          ${portion.basis ? `
            <div class="row">
              <span class="row-main">
                <span class="row-label" style="font-size:15px;">判断のしかた</span>
                <span class="row-sub">${escapeHtml(portion.basis)}</span>
              </span>
            </div>` : ""}
          ${portion.reference ? `
            <div class="row">
              <span class="row-main">
                <span class="row-label" style="font-size:15px;">基準にしたもの</span>
                <span class="row-sub">${escapeHtml(portion.reference)}</span>
              </span>
            </div>` : ""}
        </div>
      </div>`
    : "";
  const sourceBadge = r.source === "label"
    ? `<span class="badge accent">${iconHtml("label", 13)} 成分表示を読み取りました</span>`
    : `<span class="badge ${r.confidence === "low" ? "warn" : ""}">${iconHtml("sparkle", 13)} 推定の確度: ${r.confidence === "high" ? "高い" : r.confidence === "low" ? "低め" : "普通"}</span>`;

  return `
    <form id="result-form">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;">
        ${sourceBadge}
        <button type="button" class="btn btn-plain btn-sm" data-action="retake">撮り直す</button>
      </div>

      ${r.source === "label" ? `<p class="footnote" style="margin-bottom:14px;">写真の中の成分表示の数値を使いました。表示のない栄養素はおおよその推定値です。</p>` : ""}
      ${itemsText ? `<p class="muted" style="margin-bottom:14px;">${escapeHtml(itemsText)}</p>` : ""}
      ${r.note ? `<p class="footnote" style="margin-bottom:14px;">${escapeHtml(r.note)}</p>` : ""}

      ${portionHtml}

      <div class="group">
        <div class="group-title">この食事</div>
        <div class="list">
          <div class="field-stack">
            <div class="field-caption"><span>名前</span></div>
            <input type="text" id="mealName" name="mealName" value="${escapeHtml(r.items[0]?.name || "食事")}">
          </div>
          <div class="field-stack">
            <div class="field-caption"><span>区分</span></div>
            ${segmentedHtml("meal", guessMeal(new Date().getHours()))}
          </div>
          <div class="field-stack">
            <div class="field-caption"><span>メモ(任意)</span></div>
            <input type="text" id="memo" name="memo" placeholder="外食・自炊 など">
          </div>
          <label class="check-row">
            <input type="checkbox" name="saveFav" value="1">
            <span>よく食べるものにも追加(次から1タップで記録できます)</span>
          </label>
        </div>
      </div>

      <div class="group">
        <div class="group-title">栄養素</div>
        <div class="list">
          ${Object.keys(NUTRIENT_META).map((k) => `
            <div class="field-row">
              <label class="field-label" for="rf-${k}" style="display:flex;align-items:center;gap:9px;min-width:130px;font-size:15px;">
                ${nutrientIconHtml(k)} ${NUTRIENT_META[k].label}
              </label>
              <input type="number" step="0.1" id="rf-${k}" name="${k}" value="${r.nutrients[k]}" inputmode="decimal">
              <span class="field-unit">${NUTRIENT_META[k].unit}</span>
            </div>
          `).join("")}
        </div>
        <div class="group-note">数値は必要に応じて直せます。</div>
      </div>

      <div class="actions">
        <button type="button" class="btn btn-primary" data-action="add-log">${iconHtml("plus", 16)} 記録に追加</button>
      </div>
    </form>
  `;
}

function renderManualPanel() {
  const open = state.capture.showManual;
  return `
    <div class="group" style="margin-top:20px;">
      <div class="list">
        <button type="button" class="row with-icon tappable" data-action="toggle-manual">
          <span class="row-icon neutral">${iconHtml("key", 16)}</span>
          <span class="row-main">
            <span class="row-label" style="font-size:16px;">APIキーを使わない方法</span>
            <span class="row-sub">手持ちのAIチャットに貼って、結果を戻します</span>
          </span>
          <span class="row-chevron" style="transform:rotate(${open ? "180deg" : "0deg"});">${iconHtml("chevronDown", 14)}</span>
        </button>
        ${open ? `
          <div class="field-stack">
            <p class="footnote" style="margin-bottom:12px;">① 解析用の指示文をコピーします。</p>
            <button type="button" class="btn btn-gray btn-sm" data-action="copy-prompt">指示文をコピー</button>
            <p class="footnote" style="margin:16px 0 0;">② この写真とコピーした指示文を、お使いのAIチャット(ChatGPT・Claude・Gemini など)に貼り付けて送信します。無料プランのままで構いません。</p>
            <p class="footnote" style="margin:8px 0 0;">③ 返ってきたJSON形式の回答を、下に貼り付けてください。</p>
          </div>
          <div class="field-stack">
            <div class="field-caption"><span>回答を貼り付け</span></div>
            <textarea id="manual-json-input" rows="6" placeholder='{ "items": [...], "nutrients": {...} }'></textarea>
            <button type="button" class="btn btn-tinted btn-sm" style="margin-top:12px;" data-action="parse-manual">貼り付けた内容を読み込む</button>
          </div>
        ` : ""}
      </div>
    </div>
  `;
}

// 読み取れた撮影情報を1行にまとめる(タップすると送信内容をそのまま確認できる)
function captureBadgeHtml(info) {
  if (!info) return "";
  const g = info.geometry || {};
  let text;
  if (!info.hasExif) {
    text = "撮影情報なし・量は写り込んだものから推定";
  } else {
    const parts = [];
    if (g.focalLength35mm) parts.push(`35mm換算 ${g.focalLength35mm}mm`);
    if (g.frameWidthCm) parts.push(`写る範囲 約${g.frameWidthCm}cm`);
    if (info.model) parts.push(info.model);
    text = parts.length ? `撮影情報あり・${parts.join(" ・ ")}` : "撮影情報あり";
  }
  return `
    <button type="button" class="badge ${info.hasExif ? "accent" : ""}" data-action="open-capture-info"
            style="border:none;cursor:pointer;font-family:inherit;margin-bottom:18px;max-width:100%;">
      ${iconHtml(info.hasExif ? "camera" : "info", 13)}
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(text)}</span>
    </button>
  `;
}

function openCaptureInfoSheet() {
  const info = state.capture.captureInfo;
  const text = state.capture.captureText;
  openSheet("この写真の撮影情報", `
    <p class="guide-lead">量を正しく見積もるために、写真そのものに記録されていた情報を読み取り、AIへ写真と一緒に送ります。位置情報(GPS)は読み取らず、送信もしません。</p>
    ${text
      ? `<pre style="white-space:pre-wrap;font:13px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--fill);border-radius:var(--r-md);padding:14px;overflow-x:auto;">${escapeHtml(text)}</pre>`
      : `<p class="muted">この写真からは撮影情報を読み取れませんでした。</p>`}
    <div class="guide-notes" style="margin-top:16px;">
      <div class="guide-note">${iconHtml("info", 15)}<span>35mm換算焦点距離と被写体距離が分かると、「写真の横幅が実際の何cmか」まで計算できます。ここまで分かると、大盛りなのか近づけて撮っただけなのかを取り違えにくくなります。</span></div>
      ${info && !info.hasExif ? `<div class="guide-note warn">${iconHtml("shield", 15)}<span>スクリーンショットや、SNS・チャットを経由した画像は撮影情報が消えていることが多く、量の推定はその分あいまいになります。カメラで撮った元の写真を使うと精度が上がります。</span></div>` : ""}
    </div>
  `);
}

// 写真を選ぶ前の画面に出す「よく食べるもの」(1タップで記録)
function favoritesQuickHtml() {
  const favs = Storage.getFavorites();
  if (!favs.length) return "";
  return `
    <div class="group" style="margin-top:24px;">
      <div class="group-title">よく食べるもの</div>
      <div class="list">
        ${favs.slice(0, 6).map((f) => `
          <div class="row with-thumb">
            ${f.thumb ? `<img class="thumb" src="${f.thumb}" alt="" decoding="async">` : `<span class="thumb">${iconHtml("meal", 18)}</span>`}
            <span class="row-main">
              <span class="row-label ellipsis">${escapeHtml(f.name)}</span>
              <span class="row-sub">${Math.round(f.nutrients?.calories || 0)} kcal</span>
            </span>
            <button type="button" class="quick-add" data-action="fav-quick-add" data-id="${f.id}" aria-label="${escapeHtml(f.name)}を記録">${iconHtml("plus", 15)}</button>
          </div>`).join("")}
      </div>
      <div class="group-note">＋を押すだけで、今の時刻で記録されます。登録の整理は「設定」からできます。</div>
    </div>
  `;
}

function renderCapture() {
  const c = state.capture;

  const preview = c.dataUrl
    ? `<img src="${c.dataUrl}" alt="撮影した写真">`
    : `<div class="placeholder">${iconHtml("camera", 34)}写真を撮る、選ぶ、<br>または貼り付け(Ctrl+V)</div>`;

  let body = "";
  if (!c.dataUrl) {
    body = `
      <div class="actions" style="margin-top:0;">
        <button type="button" class="btn btn-primary" data-action="open-camera">${iconHtml("camera", 17)} カメラで撮影</button>
        <div class="actions-row">
          <button type="button" class="btn btn-gray" data-action="open-library">${iconHtml("gallery", 17)} ライブラリ</button>
          <button type="button" class="btn btn-gray" data-action="open-manual-add">${iconHtml("pencil", 16)} 手入力</button>
        </div>
      </div>
      <p class="footnote" style="text-align:center;margin-top:14px;">写真がなくても、名前と分かる数値だけで記録できます。</p>
      <input type="file" id="file-camera" accept="image/*" capture="environment">
      <input type="file" id="file-library" accept="image/*">
      ${favoritesQuickHtml()}
      ${repeatYesterdayHtml()}
    `;
  } else if (c.analyzing) {
    body = `<div class="analyzing"><div class="spinner"></div><span>AIが解析しています…</span></div>`;
  } else if (c.result) {
    body = renderResultForm(c.result);
  } else {
    body = `
      ${c.error ? `<div class="notice">${iconHtml("info", 16)}<span>${escapeHtml(c.error)}</span></div>` : ""}
      <div class="actions" style="margin-top:0;">
        <button type="button" class="btn btn-primary" data-action="analyze">${iconHtml("sparkle", 16)} この写真を解析する</button>
        <button type="button" class="btn btn-plain" data-action="retake">撮り直す</button>
      </div>
      ${renderManualPanel()}
    `;
  }

  return `
    <div class="nav-bar"><h1 class="large-title">記録</h1></div>
    ${backfillBannerHtml()}
    <div class="photo-frame">${preview}</div>
    ${c.dataUrl ? captureBadgeHtml(c.captureInfo) : ""}
    ${body}
  `;
}

// ---------------- 描画: 履歴 ----------------

function historyResultsHtml() {
  const all = Storage.getAllLogs();
  const q = state.historyQuery.trim().toLowerCase();
  const targets = calcTargets(state.profile);
  const dates = Object.keys(all).sort((a, b) => (a < b ? 1 : -1));

  if (!dates.length) {
    return `<div class="list"><div class="empty">${iconHtml("calendar", 30)}<div class="title">まだ記録がありません</div><div class="body">食事を記録すると、ここに日ごとにまとまります。</div></div></div>`;
  }

  // 検索中は、名前が一致する記録を日付をまたいで一覧にする
  if (q) {
    const hits = [];
    dates.forEach((d) => {
      all[d].forEach((e) => {
        if ((e.name || "").toLowerCase().includes(q)) hits.push({ d, e });
      });
    });
    if (!hits.length) {
      return `<div class="list"><div class="empty">${iconHtml("search", 30)}<div class="title">見つかりませんでした</div><div class="body">別の言葉で探してみてください。</div></div></div>`;
    }
    return `<div class="list">${hits.slice(0, 80).map(({ d, e }) => `
      <button type="button" class="row with-thumb tappable" data-action="open-entry" data-date="${d}" data-id="${e.id}">
        ${e.thumb ? `<img class="thumb" src="${e.thumb}" alt="" decoding="async">` : `<span class="thumb">${iconHtml(MEALS[e.meal]?.icon || "meal", 18)}</span>`}
        <span class="row-main">
          <span class="row-label ellipsis">${escapeHtml(e.name)}</span>
          <span class="row-sub">${formatDateLabel(d)} ${e.time} ・ ${Math.round(e.nutrients.calories)} kcal</span>
        </span>
        <span class="row-chevron">${iconHtml("chevron", 14)}</span>
      </button>`).join("")}</div>`;
  }

  const shown = dates.slice(0, state.historyLimit);
  const daysHtml = shown.map((d) => {
    const entries = all[d];
    const sum = sumNutrients(entries);
    const open = state.historyOpenDate === d;
    const pct = Math.min(100, Math.round((sum.calories / targets.calories) * 100));
    const over = sum.calories > targets.calories;

    return `
      <button type="button" class="row tappable" data-action="toggle-history-day" data-date="${d}">
        <span class="row-main">
          <span class="row-label">${formatDateLabel(d)}</span>
          <span class="row-sub">${entries.length}件の記録</span>
        </span>
        <span class="row-value" style="font-size:15px;">${Math.round(sum.calories)} / ${targets.calories}</span>
        <span class="row-chevron" style="transform:rotate(${open ? "180deg" : "0deg"});">${iconHtml("chevronDown", 14)}</span>
      </button>
      <div class="nutrient no-sep" style="padding-top:0;">
        <div class="bar ${over ? "over" : ""}"><span style="width:${pct}%"></span></div>
      </div>
      ${open ? entries.map((e) => mealRowHtml(e, d)).join("") : ""}
    `;
  }).join("");

  const moreBtn = dates.length > state.historyLimit
    ? `<button type="button" class="row tappable no-sep" data-action="history-more" style="justify-content:center;"><span style="color:var(--accent);font-size:15px;font-weight:600;">さらに表示(残り${dates.length - state.historyLimit}日)</span></button>`
    : "";

  return `<div class="list">${daysHtml}${moreBtn}</div>`;
}

function updateHistoryResults() {
  const box = $("#history-results");
  if (box) box.innerHTML = historyResultsHtml();
  else render();
}

function renderHistory() {
  return `
    <div class="nav-bar"><h1 class="large-title">履歴</h1></div>
    <div class="search-wrap">
      ${iconHtml("search", 15)}
      <input type="search" id="history-search" placeholder="料理名で探す" value="${escapeHtml(state.historyQuery)}" autocomplete="off">
    </div>
    <div id="history-results">${historyResultsHtml()}</div>
  `;
}

// ---------------- 描画: 設定 ----------------

function renderSettings() {
  const p = state.profile;

  if (state.editingProfile) {
    return `
      <div class="nav-compact">
        <button type="button" class="btn btn-plain btn-sm" data-action="cancel-edit">${iconHtml("chevronLeft", 14)} 設定</button>
      </div>
      <div class="nav-bar" style="padding-top:0;"><h1 class="large-title">編集</h1></div>
      <form id="settings-form" novalidate>
        ${profileFieldsHtml(p, "st")}
        ${aiFieldsHtml(p, "st")}
        <div class="notice hidden" data-role="form-error"></div>
        <div class="actions">
          <button type="submit" class="btn btn-primary">保存する</button>
          <button type="button" class="btn btn-plain" data-action="cancel-edit">キャンセル</button>
        </div>
      </form>
    `;
  }

  const t = calcTargets(p);
  const basis = targetBasis(p);
  const cfg = getAiConfig(p);
  const guide = getProviderGuide(cfg.providerId);
  const favCount = Storage.getFavorites().length;
  const customCount = customizedTargetKeys(p).length;

  return `
    <div class="nav-bar"><h1 class="large-title">設定</h1></div>

    <div class="group">
      <div class="group-title">あなたのこと</div>
      <div class="list">
        <button type="button" class="row with-icon tappable" data-action="edit-profile">
          <span class="row-icon">${iconHtml("person", 16)}</span>
          <span class="row-main">
            <span class="row-label">プロフィール</span>
            <span class="row-sub">${p.age}歳・${p.sex === "male" ? "男性" : "女性"}・${p.height}cm・${p.weight}kg</span>
          </span>
          <span class="row-chevron">${iconHtml("chevron", 14)}</span>
        </button>
        <button type="button" class="row with-icon tappable" data-action="open-weight">
          <span class="row-icon">${iconHtml("scale", 16)}</span>
          <span class="row-main">
            <span class="row-label">体重を記録</span>
            <span class="row-sub">推移は「トレンド」で見られます</span>
          </span>
          <span class="row-chevron">${iconHtml("chevron", 14)}</span>
        </button>
        <button type="button" class="row with-icon tappable" data-action="open-targets">
          <span class="row-icon">${iconHtml("sparkle", 16)}</span>
          <span class="row-main">
            <span class="row-label">目標を自分で決める</span>
            <span class="row-sub">${customCount ? `${customCount}件を自分の値にしています` : "いまは既定値を使っています"}</span>
          </span>
          <span class="row-chevron">${iconHtml("chevron", 14)}</span>
        </button>
        <button type="button" class="row with-icon tappable" data-action="open-basis">
          <span class="row-icon neutral">${iconHtml("info", 16)}</span>
          <span class="row-main">
            <span class="row-label">1日の目標の求め方</span>
            <span class="row-sub">${t.calories} kcal ・ たんぱく質 ${t.protein}g ・ ${basis.bandLabel}</span>
          </span>
          <span class="row-chevron">${iconHtml("chevron", 14)}</span>
        </button>
      </div>
      <div class="group-note">
        活動レベル「${ACTIVITY_LEVELS[p.activity].label}」・目標「${(GOALS[p.goal] || GOALS.maintain).label}」。
        目標値は厚生労働省「日本人の食事摂取基準(2025年版)」に基づいています。
      </div>
    </div>

    <div class="group">
      <div class="group-title">記録のしかた</div>
      <div class="list">
        <button type="button" class="row with-icon tappable" data-action="toggle-autolog">
          <span class="row-icon">${iconHtml("camera", 16)}</span>
          <span class="row-main">
            <span class="row-label">撮ったらそのまま記録する</span>
            <span class="row-sub">${autoLogEnabled() ? "記録まで自動で進みます" : "確かめてから記録します"}</span>
          </span>
          <span class="row-value">${autoLogEnabled() ? "オン" : "オフ"}</span>
        </button>
        <button type="button" class="row with-icon tappable" data-action="toggle-instant-camera">
          <span class="row-icon">${iconHtml("camera", 16)}</span>
          <span class="row-main">
            <span class="row-label">記録タブですぐカメラ</span>
            <span class="row-sub">${instantCameraEnabled() ? "開くと同時に起動します" : "自分でボタンを押します"}</span>
          </span>
          <span class="row-value">${instantCameraEnabled() ? "オン" : "オフ"}</span>
        </button>
      </div>
      <div class="group-note">
        オンのときも、記録したあとに出る「確認」から中身を直せます。
        間違っていてもその場で直せるので、まずはオンのままお試しください。
      </div>
    </div>

    <div class="group">
      <div class="group-title">写真解析に使うAI</div>
      <div class="list">
        <button type="button" class="row with-icon tappable" data-action="edit-profile">
          <span class="row-icon">${iconHtml("sparkle", 16)}</span>
          <span class="row-main">
            <span class="row-label">${escapeHtml(cfg.provider.shortLabel)}</span>
            <span class="row-sub">${cfg.apiKey
              ? `APIキー設定済み(末尾 ${escapeHtml(cfg.apiKey.slice(-4))})・${escapeHtml(cfg.model || "モデル未設定")}`
              : "APIキーが未設定です"}</span>
          </span>
          <span class="row-chevron">${iconHtml("chevron", 14)}</span>
        </button>
        <button type="button" class="row with-icon tappable" data-action="open-key-guide">
          <span class="row-icon neutral">${iconHtml("help", 16)}</span>
          <span class="row-main">
            <span class="row-label">APIキーの取得のしかた</span>
            <span class="row-sub">${escapeHtml(guide.cost.text)}</span>
          </span>
          <span class="row-chevron">${iconHtml("chevron", 14)}</span>
        </button>
      </div>
      ${cfg.provider.needsBaseUrl ? `<div class="group-note">接続先: ${escapeHtml(cfg.baseUrl || "(未設定)")}</div>` : ""}
    </div>

    <div class="group">
      <div class="group-title">記録とデータ</div>
      <div class="list">
        <button type="button" class="row with-icon tappable" data-action="open-fav-manage">
          <span class="row-icon">${iconHtml("star", 16)}</span>
          <span class="row-main">
            <span class="row-label">よく食べるもの</span>
            <span class="row-sub">${favCount ? `${favCount}件を登録済み` : "まだ登録がありません"}</span>
          </span>
          <span class="row-chevron">${iconHtml("chevron", 14)}</span>
        </button>
        <button type="button" class="row with-icon tappable" data-action="export-data">
          <span class="row-icon neutral">${iconHtml("export", 16)}</span>
          <span class="row-main">
            <span class="row-label">データを書き出す</span>
            <span class="row-sub">機種変更・バックアップ用(APIキーは含みません)</span>
          </span>
          <span class="row-chevron">${iconHtml("chevron", 14)}</span>
        </button>
        <button type="button" class="row with-icon tappable" data-action="import-data">
          <span class="row-icon neutral">${iconHtml("import", 16)}</span>
          <span class="row-main">
            <span class="row-label">データを読み込む</span>
            <span class="row-sub">書き出したファイルから復元・統合します</span>
          </span>
          <span class="row-chevron">${iconHtml("chevron", 14)}</span>
        </button>
        <button type="button" class="row with-icon tappable" data-action="open-about">
          <span class="row-icon neutral">${iconHtml("shield", 16)}</span>
          <span class="row-main">
            <span class="row-label">データの扱いについて</span>
            <span class="row-sub">保存先・送信先・免責</span>
          </span>
          <span class="row-chevron">${iconHtml("chevron", 14)}</span>
        </button>
        <button type="button" class="row with-icon tappable" data-action="clear-logs">
          <span class="row-icon" style="background:rgba(255,59,48,.12);color:var(--danger);">${iconHtml("trash", 16)}</span>
          <span class="row-main"><span class="row-label" style="color:var(--danger);">すべての食事記録を削除</span></span>
        </button>
      </div>
      <div class="group-note">記録はこの端末のブラウザ内にのみ保存されています。</div>
    </div>

    <input type="file" id="file-import" accept="application/json,.json">
    <p class="disclaimer">栄養の目安値・AIによる推定値は一般的な参考情報です。医療・栄養に関する専門的な判断が必要な場合は、医師や管理栄養士にご相談ください。<br>バージョン ${APP_VERSION}</p>
  `;
}

document.addEventListener("DOMContentLoaded", init);
