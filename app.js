// ---------------------------------------------------------------
// app.js
// 画面の描画・状態管理・イベント処理
// ---------------------------------------------------------------

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
  editingProfile: false,
  obStep: 0,
  sheet: null,
  // 初回設定では、AIにつながることを確かめるまで先に進めない
  connectionVerified: false,
};

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

function showToast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove("show"), 2400);
}

const CAPTURE_INITIAL = () => ({
  file: null, dataUrl: null, analyzing: false, result: null, error: null, showManual: false,
  captureInfo: null, captureText: "",
});

// ---------------- 初期化・ルーティング ----------------

const TAB_ICONS = { home: "home", capture: "camera", history: "calendar", settings: "settings" };

function init() {
  const wanted = new URLSearchParams(location.search).get("view");
  state.view = state.profile ? (["home", "capture", "history", "settings"].includes(wanted) ? wanted : "home") : "onboarding";

  $$(".tab-btn").forEach((btn) => {
    const wrap = $(".ic-wrap", btn);
    if (wrap) wrap.innerHTML = iconHtml(TAB_ICONS[btn.dataset.view], 22);
  });

  render();

  document.body.addEventListener("click", onBodyClick);
  document.body.addEventListener("change", onBodyChange);
  document.body.addEventListener("input", onBodyInput);
  document.body.addEventListener("submit", onBodySubmit);
  document.addEventListener("paste", onPaste);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.sheet) closeSheet();
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function setView(view) {
  closeSheet();
  state.view = view;
  if (view === "capture") state.capture = CAPTURE_INITIAL();
  render();
  window.scrollTo(0, 0);
}

function render() {
  const app = $("#app");
  const tabbar = $("#tabbar");
  const showTabs = state.view !== "onboarding";
  tabbar.classList.toggle("hidden", !showTabs);

  $$(".tab-btn").forEach((btn) => {
    const active = btn.dataset.view === state.view;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-current", active ? "page" : "false");
  });

  switch (state.view) {
    case "onboarding": app.innerHTML = renderOnboarding(); break;
    case "home": app.innerHTML = renderHome(); break;
    case "capture": app.innerHTML = renderCapture(); break;
    case "history": app.innerHTML = renderHistory(); break;
    case "settings": app.innerHTML = renderSettings(); break;
    default: app.innerHTML = renderHome();
  }

  // 設定フォームが出ているときは、選択中のAIサービスに合わせて中身を整える
  const profileForm = $("#onboarding-form") || $("#settings-form");
  if (profileForm) {
    applyProviderUi(profileForm);
    updateProfileFormUi(profileForm);
  }
}

// ---------------- シート(手順書などを重ねて開く) ----------------

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
}

// ---------------- イベントハンドラ ----------------

function onBodyClick(e) {
  const tab = e.target.closest(".tab-btn");
  if (tab) { setView(tab.dataset.view); return; }

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
    case "delete-log": doDeleteLog(actionEl.dataset.date, actionEl.dataset.id); break;
    case "toggle-detail": state.showDetail = !state.showDetail; render(); break;
    case "ob-next": gotoObStep(state.obStep + 1); break;
    case "ob-back": gotoObStep(state.obStep - 1); break;
    case "toggle-history-day": {
      const d = actionEl.dataset.date;
      state.historyOpenDate = state.historyOpenDate === d ? null : d;
      render();
      break;
    }
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
  if (e.target.dataset && e.target.dataset.role === "provider-select") {
    onProviderChange(e.target);
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
  return escapeHtml(text).replace(
    /(https?:\/\/[^\s、。]+|sk-ant-|sk-|AIza|:free)/g,
    "<code>$1</code>"
  );
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

  return `
    <p class="guide-lead">${formatGuideText(g.lead)}</p>
    <div style="margin-bottom:22px;"><span class="chip ${g.cost.tone === "paid" ? "paid" : ""}">${iconHtml(g.cost.tone === "paid" ? "info" : "check", 13)} ${escapeHtml(g.cost.text)}</span></div>
    <ol class="steps">${steps}</ol>
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
      <div class="guide-note">${iconHtml("database", 15)}<span>食事の記録・プロフィール・APIキーは、この端末のブラウザ内(localStorage)にのみ保存されます。開発者のサーバーには送信されません。端末やブラウザを変えると引き継がれません。</span></div>
      <div class="guide-note">${iconHtml("sparkle", 15)}<span>写真解析のときだけ、写真とAPIキーが、あなたが選んだAIサービスに直接送信されます。経由するサーバーはありません。</span></div>
      <div class="guide-note warn">${iconHtml("shield", 15)}<span>APIキーはブラウザ内に保存されるため、その端末を使える人には見える形になります。共有の端末では、使い終わったらキーを消してください。</span></div>
      <div class="guide-note">${iconHtml("info", 15)}<span>表示される1日の必要量やAIの推定値は一般的な目安であり、医学的な助言ではありません。妊娠・授乳中の方、成長期のお子様、持病のある方は、医師や管理栄養士にご相談ください。18歳以上の方を対象としています。</span></div>
    </div>
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
  } catch (e) {
    showToast("写真を読み込めませんでした");
  }
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

function doAddLog() {
  const form = $("#result-form");
  const fd = new FormData(form);
  const nutrients = {};
  Object.keys(NUTRIENT_META).forEach((k) => {
    nutrients[k] = Math.round((parseFloat(fd.get(k)) || 0) * 10) / 10;
  });
  const name = (fd.get("mealName") || "食事").trim() || "食事";
  const note = (fd.get("memo") || "").trim();

  const now = new Date();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`,
    name,
    items: state.capture.result?.items || [],
    nutrients,
    note,
    thumb: state.capture.dataUrl,
  };
  Storage.addLog(todayKey(), entry);
  showToast("記録に追加しました");
  setView("home");
}

function doDeleteLog(dateKey, id) {
  Storage.deleteLog(dateKey, id);
  showToast("記録を削除しました");
  render();
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
        <circle class="track" cx="98" cy="98" r="${R}" fill="none" stroke-width="14"/>
        <circle class="fill" cx="98" cy="98" r="${R}" fill="none" stroke-width="14"
                stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"/>
      </svg>
      <div class="ring-center">
        <span class="value">${Math.round(consumed)}</span>
        <span class="unit">KCAL</span>
      </div>
    </div>
  `;
}

function nutrientRow(key, consumed, target) {
  const meta = NUTRIENT_META[key];
  const pct = target > 0 ? Math.min(100, Math.round((consumed / target) * 100)) : 0;
  const over = consumed > target;
  const remain = Math.max(0, Math.round((target - consumed) * 10) / 10);
  const remainLabel = meta.isLimit
    ? (over ? `${Math.round((consumed - target) * 10) / 10}${meta.unit} 超過` : `あと ${remain}${meta.unit}`)
    : (over ? "達成" : `あと ${remain}${meta.unit}`);
  return `
    <div class="nutrient">
      <div class="nutrient-head">
        <span class="nutrient-name">${nutrientIconHtml(key)} ${meta.label}</span>
        <span class="nutrient-val">${Math.round(consumed * 10) / 10} / ${target}${meta.unit} ・ ${remainLabel}</span>
      </div>
      <div class="bar ${over ? "over" : ""}"><span style="width:${pct}%"></span></div>
    </div>
  `;
}

function mealRowHtml(entry, dateKey) {
  const thumb = entry.thumb
    ? `<img class="thumb" src="${entry.thumb}" alt="">`
    : `<span class="thumb">${iconHtml("meal", 18)}</span>`;
  return `
    <div class="row with-thumb">
      ${thumb}
      <span class="row-main">
        <span class="row-label" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(entry.name)}</span>
        <span class="row-sub">${entry.time} ・ ${Math.round(entry.nutrients.calories)} kcal</span>
      </span>
      <button class="icon-btn" data-action="delete-log" data-date="${dateKey}" data-id="${entry.id}" aria-label="この記録を削除">${iconHtml("close", 13)}</button>
    </div>
  `;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "こんばんは";
  if (h < 11) return "おはようございます";
  if (h < 18) return "こんにちは";
  return "こんばんは";
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
    : `目標 <strong>${targets.calories}</strong> kcal まで、あと <strong>${remainKcal}</strong> kcal`;

  const mealsHtml = logs.length
    ? logs.map((e) => mealRowHtml(e, todayKey())).join("")
    : `<div class="empty">${iconHtml("meal", 30)}<div class="title">まだ記録がありません</div><div class="body">「記録」タブから、食事の写真を撮ってみましょう。</div></div>`;

  const detailHtml = state.showDetail
    ? SECONDARY_NUTRIENTS.map((k) => nutrientRow(k, consumed[k], targets[k])).join("")
    : "";

  return `
    <div class="nav-bar">
      <div>
        <div class="footnote" style="margin-bottom:2px;">${greeting()}</div>
        <h1 class="large-title">今日</h1>
      </div>
      <span class="sub">${formatDateLabel(todayKey())}</span>
    </div>

    <div class="panel" style="padding:26px 20px 24px;">
      <div class="ring-wrap">
        ${ringHtml(consumed.calories, targets.calories)}
        <div class="ring-caption">${caption}</div>
      </div>
    </div>

    <div class="group" style="margin-top:28px;">
      <div class="group-title">主要な栄養素</div>
      <div class="list">
        ${PRIMARY_NUTRIENTS.filter((k) => k !== "calories").map((k) => nutrientRow(k, consumed[k], targets[k])).join("")}
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
      <div class="list">${mealsHtml}</div>
    </div>
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
            <div class="field-caption"><span>メモ(任意)</span></div>
            <input type="text" id="memo" name="memo" placeholder="外食・自炊 など">
          </div>
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
        <button type="button" class="btn btn-gray" data-action="open-library">${iconHtml("gallery", 17)} ライブラリから選ぶ</button>
      </div>
      <p class="footnote" style="text-align:center;margin-top:18px;">スマホで撮った写真をコピーして、この画面に貼り付けることもできます。</p>
      <input type="file" id="file-camera" accept="image/*" capture="environment">
      <input type="file" id="file-library" accept="image/*">
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
    <div class="photo-frame">${preview}</div>
    ${c.dataUrl ? captureBadgeHtml(c.captureInfo) : ""}
    ${body}
  `;
}

// ---------------- 描画: 履歴 ----------------

function renderHistory() {
  const all = Storage.getAllLogs();
  const dates = Object.keys(all).sort((a, b) => (a < b ? 1 : -1));

  if (dates.length === 0) {
    return `
      <div class="nav-bar"><h1 class="large-title">履歴</h1></div>
      <div class="list">
        <div class="empty">${iconHtml("calendar", 30)}<div class="title">まだ記録がありません</div><div class="body">食事を記録すると、ここに日ごとにまとまります。</div></div>
      </div>
    `;
  }

  const targets = calcTargets(state.profile);

  const daysHtml = dates.map((d) => {
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

  return `
    <div class="nav-bar"><h1 class="large-title">履歴</h1></div>
    <div class="list">${daysHtml}</div>
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
      <div class="group-title">データ</div>
      <div class="list">
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

    <p class="disclaimer">栄養の目安値・AIによる推定値は一般的な参考情報です。医療・栄養に関する専門的な判断が必要な場合は、医師や管理栄養士にご相談ください。</p>
  `;
}

document.addEventListener("DOMContentLoaded", init);
