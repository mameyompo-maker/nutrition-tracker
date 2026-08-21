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
  capture: { file: null, dataUrl: null, analyzing: false, result: null, error: null, note: "", showManual: false },
  showDetail: false,
  historyOpenDate: null,
  editingProfile: false,
};

// 設定フォームでAIサービスを切り替えたとき、入力途中の値を失わないための一時置き場
const formScratch = { apiKeys: {}, models: {}, baseUrls: {} };

function scratchValue(mapName, providerId, fallback) {
  const typed = formScratch[mapName][providerId];
  if (typed !== undefined) return typed;
  const saved = state.profile?.[mapName]?.[providerId];
  return saved === undefined || saved === null ? fallback : saved;
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
  showToast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

// ---------------- 初期化・ルーティング ----------------

const TAB_ICONS = { home: "home", capture: "camera", history: "calendar", settings: "settings" };

function init() {
  state.view = state.profile ? "home" : "onboarding";

  // タブバーのアイコンを絵文字からSVGに差し替え
  $$(".tab-btn").forEach((btn) => {
    const wrap = $(".ic-wrap", btn);
    if (wrap) wrap.innerHTML = iconHtml(TAB_ICONS[btn.dataset.view], 17);
  });

  render();

  // イベント委譲（1回だけ登録）
  document.body.addEventListener("click", onBodyClick);
  document.body.addEventListener("change", onBodyChange);
  document.body.addEventListener("submit", onBodySubmit);
  document.addEventListener("paste", onPaste);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

function setView(view) {
  state.view = view;
  if (view === "capture") {
    state.capture = { file: null, dataUrl: null, analyzing: false, result: null, error: null, note: "", showManual: false };
  }
  render();
  window.scrollTo(0, 0);
}

function render() {
  const app = $("#app");
  const tabbar = $("#tabbar");
  const showTabs = state.view !== "onboarding";
  tabbar.classList.toggle("hidden", !showTabs);

  $$(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === state.view);
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
  if (profileForm) applyProviderUi(profileForm);
}

// ---------------- イベントハンドラ ----------------

function onBodyClick(e) {
  const tab = e.target.closest(".tab-btn");
  if (tab) { setView(tab.dataset.view); return; }

  const actionEl = e.target.closest("[data-action]");
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  switch (action) {
    case "open-camera": $("#file-camera").click(); break;
    case "open-library": $("#file-library").click(); break;
    case "retake": state.capture = { file: null, dataUrl: null, analyzing: false, result: null, error: null, note: "", showManual: false }; render(); break;
    case "analyze": doAnalyze(); break;
    case "toggle-manual": state.capture.showManual = !state.capture.showManual; render(); break;
    case "copy-prompt": doCopyPrompt(); break;
    case "parse-manual": doParseManual(); break;
    case "add-log": doAddLog(); break;
    case "delete-log": doDeleteLog(actionEl.dataset.date, actionEl.dataset.id); break;
    case "toggle-detail": state.showDetail = !state.showDetail; render(); break;
    case "toggle-history-day": {
      const d = actionEl.dataset.date;
      state.historyOpenDate = state.historyOpenDate === d ? null : d;
      render();
      break;
    }
    case "edit-profile": state.editingProfile = true; render(); break;
    case "clear-logs": {
      if (confirm("すべての食事記録を削除します。よろしいですか？（元に戻せません）")) {
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

function submitProfileForm(form, isOnboarding) {
  const p = readProfileForm(form);
  const err = validateProfile(p);
  const errBox = $("#form-error", form);
  if (err) {
    if (errBox) { errBox.textContent = err; errBox.classList.remove("hidden"); }
    return;
  }
  state.profile = p;
  state.editingProfile = false;
  formScratch.apiKeys = {};
  formScratch.models = {};
  formScratch.baseUrls = {};
  Storage.saveProfile(p);
  showToast(isOnboarding ? "設定を保存しました" : "プロフィールを更新しました");
  setView("home");
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
    render();
  } catch (e) {
    showToast("画像の読み込みに失敗しました");
  }
}

async function doAnalyze() {
  if (!state.capture.dataUrl) return;
  const cfg = getAiConfig(state.profile);
  if (!cfg.apiKey) {
    state.capture.error = `APIキーが未設定です。「設定」タブで${cfg.provider.keyLabel}を登録するか、下の「無料の手動方式」をお使いください。`;
    state.capture.showManual = true;
    render();
    return;
  }
  state.capture.analyzing = true;
  state.capture.error = null;
  render();
  try {
    const result = await analyzeFoodPhoto({
      dataUrl: state.capture.dataUrl,
      profile: state.profile,
    });
    state.capture.result = result;
  } catch (e) {
    state.capture.error = e.message || "解析中にエラーが発生しました";
  } finally {
    state.capture.analyzing = false;
    render();
  }
}

async function doCopyPrompt() {
  try {
    await navigator.clipboard.writeText(ANALYSIS_PROMPT);
    showToast("指示文をコピーしました");
  } catch (e) {
    showToast("コピーに失敗しました。手動で選択してコピーしてください。");
  }
}

function doParseManual() {
  const input = $("#manual-json-input");
  const text = input ? input.value : "";
  try {
    state.capture.result = parseManualAnalysisText(text);
    state.capture.error = null;
  } catch (e) {
    state.capture.error = e.message || "貼り付けた内容の読み取りに失敗しました";
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

// ---------------- 描画: オンボーディング / 設定フォーム ----------------

function profileFormFields(p, prefix) {
  p = p || { age: "", sex: "", height: "", weight: "", activity: "normal", goal: "maintain" };
  const activityOptions = Object.entries(ACTIVITY_LEVELS)
    .map(([k, v]) => `<option value="${k}" ${p.activity === k ? "selected" : ""}>${v.label} — ${v.desc}</option>`)
    .join("");
  const goalOptions = Object.entries(GOALS)
    .map(([k, v]) => `<option value="${k}" ${(p.goal || "maintain") === k ? "selected" : ""}>${v.label} — ${v.desc}</option>`)
    .join("");
  const currentProvider = p.provider || DEFAULT_PROVIDER;
  const providerOptions = Object.entries(PROVIDERS)
    .map(([k, v]) => `<option value="${k}" ${currentProvider === k ? "selected" : ""}>${v.label}</option>`)
    .join("");

  return `
    <div id="form-error" class="notice hidden"></div>
    <div class="row">
      <div class="col">
        <label for="${prefix}-age">年齢</label>
        <input type="number" id="${prefix}-age" name="age" min="18" max="120" placeholder="例: 30" value="${p.age ?? ""}" required>
      </div>
      <div class="col">
        <label for="${prefix}-sex">性別(計算に使用)</label>
        <select id="${prefix}-sex" name="sex" required>
          <option value="">選択</option>
          <option value="male" ${p.sex === "male" ? "selected" : ""}>男性</option>
          <option value="female" ${p.sex === "female" ? "selected" : ""}>女性</option>
        </select>
      </div>
    </div>
    <div class="row">
      <div class="col">
        <label for="${prefix}-height">身長(cm)</label>
        <input type="number" id="${prefix}-height" name="height" min="100" max="230" step="0.1" placeholder="例: 165" value="${p.height ?? ""}" required>
      </div>
      <div class="col">
        <label for="${prefix}-weight">体重(kg)</label>
        <input type="number" id="${prefix}-weight" name="weight" min="25" max="300" step="0.1" placeholder="例: 58" value="${p.weight ?? ""}" required>
      </div>
    </div>
    <label for="${prefix}-activity">日常の活動レベル</label>
    <select id="${prefix}-activity" name="activity" required>${activityOptions}</select>

    <label for="${prefix}-goal">目標</label>
    <select id="${prefix}-goal" name="goal">${goalOptions}</select>
    <p class="muted">増量・減量を選ぶと、カロリーとたんぱく質の目標量が調整されます。トレーニング内容や体質によって適切な量は変わるため、あくまで一般的な目安としてご利用ください。</p>

    <div class="section-title">写真解析に使うAI(任意)</div>
    <p class="muted">このアプリは専用のサーバーを持ちません。あなた自身のAIサービスのAPIキーを登録すると、ブラウザから直接そのAIに写真を送り、栄養素を自動で読み取れるようになります。キーはこの端末のブラウザ内にのみ保存され、開発者には送信されません。</p>
    <p class="muted">登録しなくてもアプリは使えます(記録画面の「無料の手動方式」または手入力)。</p>

    <label for="${prefix}-provider">使うAIサービス</label>
    <select id="${prefix}-provider" name="provider" data-role="provider-select">${providerOptions}</select>
    <p class="muted" data-role="provider-help"></p>

    <label for="f-apikey" data-role="key-label">APIキー</label>
    <div class="row">
      <div class="col"><input type="password" id="f-apikey" name="apiKey" value="" autocomplete="off" spellcheck="false"></div>
      <button type="button" class="btn btn-outline btn-sm" data-action="toggle-key-visibility" style="width:auto;">表示</button>
    </div>
    <p class="muted">キーの発行: <a data-role="key-link" href="#" target="_blank" rel="noopener noreferrer"></a></p>

    <div data-role="baseurl-row" class="hidden">
      <label for="${prefix}-baseurl">APIのベースURL</label>
      <input type="text" id="${prefix}-baseurl" name="baseUrl" value="" autocomplete="off" spellcheck="false" placeholder="https://openrouter.ai/api/v1">
      <p class="muted">末尾の <code>/chat/completions</code> は不要です。</p>
    </div>

    <label for="${prefix}-model">解析に使うモデル</label>
    <input type="text" id="${prefix}-model" name="model" value="" list="model-suggestions" autocomplete="off" spellcheck="false">
    <datalist id="model-suggestions"></datalist>
    <p class="muted">候補から選ぶか、直接入力できます。各社のモデルは入れ替わりが速いため、うまく動かないときは最新のモデル名を入れてください。</p>

    <div class="row" style="align-items:center; gap:10px;">
      <button type="button" class="btn btn-outline btn-sm" data-action="test-connection" style="width:auto;">接続テスト</button>
      <span class="muted" data-role="test-result"></span>
    </div>
  `;
}

// 選ばれているAIサービスに合わせて、フォームの表示内容と値を切り替える
function applyProviderUi(form) {
  if (!form) return;
  const sel = $("[data-role=provider-select]", form);
  if (!sel) return;
  const id = sel.value || DEFAULT_PROVIDER;
  const meta = getProvider(id);
  sel.dataset.current = id;

  const help = $("[data-role=provider-help]", form);
  if (help) help.textContent = meta.help;

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

  const keyLink = $("[data-role=key-link]", form);
  if (keyLink) {
    keyLink.href = meta.keyUrl;
    keyLink.textContent = meta.keyUrlLabel;
  }

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
  if (testResult) testResult.textContent = "";
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
async function doTestConnection(btn) {
  const form = btn.closest("form");
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

  btn.disabled = true;
  if (out) out.textContent = "確認中…";
  try {
    await testAiConnection(probe);
    if (out) out.textContent = "✓ 接続できました";
  } catch (e) {
    if (out) out.textContent = "✗ " + (e.message || "接続できませんでした");
  } finally {
    btn.disabled = false;
  }
}

function renderOnboarding() {
  return `
    <div class="card" style="text-align:center; padding:28px 16px;">
      <div style="width:56px;height:56px;border-radius:18px;background:var(--green-light);display:flex;align-items:center;justify-content:center;margin:0 auto 14px;color:var(--green-deep);">${iconHtml("meal", 26)}</div>
      <h1>ようこそ</h1>
      <p class="muted">まずはあなたに合った1日の必要栄養量を計算するために、いくつか教えてください。</p>
    </div>
    <form id="onboarding-form" class="card" novalidate>
      ${profileFormFields(null, "ob")}
      <button type="submit" class="btn btn-primary" style="margin-top:16px;">はじめる</button>
    </form>
    <p class="footer-note">本アプリの目安摂取量やAIによる栄養推定は一般的な参考値であり、医学的なアドバイスではありません。妊娠・授乳中の方や持病のある方は医師・管理栄養士にご相談ください。</p>
  `;
}

function renderSettings() {
  const p = state.profile;
  if (state.editingProfile) {
    return `
      <div class="top-header"><h1>プロフィール編集</h1></div>
      <form id="settings-form" class="card" novalidate>
        ${profileFormFields(p, "st")}
        <button type="submit" class="btn btn-primary" style="margin-top:16px;">保存する</button>
      </form>
    `;
  }

  const t = calcTargets(p);
  const cfg = getAiConfig(p);
  return `
    <div class="top-header"><h1>設定</h1></div>
    <div class="card">
      <h2>プロフィール</h2>
      <p class="muted">${p.age}歳・${p.sex === "male" ? "男性" : "女性"}・身長${p.height}cm・体重${p.weight}kg・活動レベル「${ACTIVITY_LEVELS[p.activity].label}」・目標「${(GOALS[p.goal] || GOALS.maintain).label}」</p>
      <p class="muted">1日の目標エネルギー: <strong>${t.calories} kcal</strong>(たんぱく質 ${t.protein}g)</p>
      <button class="btn btn-secondary" data-action="edit-profile">編集する</button>
    </div>
    <div class="card">
      <h2>写真解析に使うAI</h2>
      <p class="muted">サービス: <strong>${escapeHtml(cfg.provider.label)}</strong></p>
      <p class="muted">${cfg.apiKey
        ? `APIキーは設定済みです(末尾 ${escapeHtml(cfg.apiKey.slice(-4))})。`
        : "APIキーが未設定です。写真の自動解析にはAPIキーが必要です。"}</p>
      <p class="muted">使用モデル: ${escapeHtml(cfg.model || "(未設定)")}</p>
      ${cfg.provider.needsBaseUrl ? `<p class="muted">接続先: ${escapeHtml(cfg.baseUrl || "(未設定)")}</p>` : ""}
      <button class="btn btn-secondary" data-action="edit-profile">変更する</button>
    </div>
    <div class="card">
      <h2>データ管理</h2>
      <p class="muted">記録はすべてこの端末のブラウザ内(localStorage)に保存されています。開発者のサーバーには送信されません(写真解析のときだけ、写真とAPIキーがあなたが選んだAIサービスに送られます)。</p>
      <button class="btn btn-danger" data-action="clear-logs">すべての食事記録を削除</button>
    </div>
    <p class="footer-note">栄養の目安値・AIによる推定値は一般的な参考情報です。医療・栄養に関する専門的な判断が必要な場合は、医師や管理栄養士にご相談ください。</p>
  `;
}

// ---------------- 描画: ホーム ----------------

function nutrientBar(key, consumed, target) {
  const meta = NUTRIENT_META[key];
  const pct = target > 0 ? Math.min(100, Math.round((consumed / target) * 100)) : 0;
  const over = consumed > target;
  const remain = Math.max(0, Math.round((target - consumed) * 10) / 10);
  const remainLabel = meta.isLimit
    ? (over ? `${Math.round((consumed - target) * 10) / 10}${meta.unit} 超過` : `あと${remain}${meta.unit}`)
    : (over ? "達成" : `あと${remain}${meta.unit}`);
  return `
    <div class="nutrient-row">
      <div class="nutrient-head">
        <span class="label">${nutrientIconHtml(key)} ${meta.label}</span>
        <span class="val">${Math.round(consumed * 10) / 10}/${target}${meta.unit} ・ ${remainLabel}</span>
      </div>
      <div class="bar ${over ? "over" : ""}"><div style="width:${pct}%"></div></div>
    </div>
  `;
}

function renderHome() {
  const p = state.profile;
  const targets = calcTargets(p);
  const logs = Storage.getLogsForDate(todayKey());
  const consumed = sumNutrients(logs);
  const kcalPct = Math.round((consumed.calories / targets.calories) * 100);
  const kcalOver = consumed.calories > targets.calories;

  const advice = buildAdvice(consumed, targets);

  const mealsHtml = logs.length
    ? logs.map((e) => `
        <div class="meal-item">
          ${e.thumb ? `<img class="meal-thumb" src="${e.thumb}" alt="">` : `<div class="meal-thumb">${iconHtml("meal", 18)}</div>`}
          <div class="meal-info">
            <div class="name">${escapeHtml(e.name)}</div>
            <div class="meta">${e.time} ・ ${Math.round(e.nutrients.calories)} kcal</div>
          </div>
          <button class="del" data-action="delete-log" data-date="${todayKey()}" data-id="${e.id}">${iconHtml("close")}</button>
        </div>
      `).join("")
    : `<p class="muted">まだ今日の記録はありません。「記録」タブから食事の写真を撮ってみましょう。</p>`;

  const detailHtml = state.showDetail
    ? SECONDARY_NUTRIENTS.map((k) => nutrientBar(k, consumed[k], targets[k])).join("")
    : "";

  return `
    <div class="top-header">
      <h1>今日の栄養</h1>
      <span class="date">${formatDateLabel(todayKey())}</span>
    </div>

    <div class="card">
      <div class="calorie-hero">
        <div class="num ${kcalOver ? "over" : ""}">${Math.round(consumed.calories)}</div>
        <div class="label">/ ${targets.calories} kcal (${kcalPct}%)</div>
      </div>
      <div class="bar ${kcalOver ? "over" : ""}" style="margin-top:8px;"><div style="width:${Math.min(100, kcalPct)}%"></div></div>
    </div>

    <div class="card">
      <h2>主要な栄養素</h2>
      ${PRIMARY_NUTRIENTS.filter((k) => k !== "calories").map((k) => nutrientBar(k, consumed[k], targets[k])).join("")}
      <button class="link-btn" data-action="toggle-detail">${state.showDetail ? "▲ その他の栄養素を隠す" : "▼ その他の栄養素も見る"}</button>
      ${detailHtml}
    </div>

    <div class="card">
      <h2>アドバイス</h2>
      ${advice.map((a) => `<div class="advice-item ${a.warn ? "warn" : ""}"><span class="ic-chip">${nutrientIconHtml(a.iconKey)}</span><span>${a.text}</span></div>`).join("")}
    </div>

    <div class="card">
      <h2>今日の記録</h2>
      ${mealsHtml}
    </div>
  `;
}

// ---------------- 描画: 撮影・解析 ----------------

function renderCapture() {
  const c = state.capture;

  let previewInner = `<div class="placeholder">${iconHtml("camera", 40)}写真を撮る、選ぶ、または貼り付け(⌘V)</div>`;
  if (c.dataUrl) previewInner = `<img src="${c.dataUrl}" alt="撮影した写真">`;

  let actionArea = "";
  if (!c.dataUrl) {
    actionArea = `
      <div class="stack">
        <button class="btn btn-primary" data-action="open-camera">${iconHtml("camera", 17)} カメラで撮影</button>
        <button class="btn btn-outline" data-action="open-library">${iconHtml("gallery", 17)} ライブラリから選ぶ</button>
      </div>
      <p class="muted" style="text-align:center; margin-top:12px;">スマホやカメラで撮った写真は、コピーしてこの画面で<strong>⌘V(Ctrl+V)</strong>で貼り付けもできます。</p>
      <input type="file" id="file-camera" accept="image/*" capture="environment">
      <input type="file" id="file-library" accept="image/*">
    `;
  } else if (c.analyzing) {
    actionArea = `
      <div class="row" style="align-items:center; justify-content:center; padding:14px 0;">
        <div class="spinner"></div>
        <span style="margin-left:10px;">AIが解析中です…</span>
      </div>
    `;
  } else if (c.result) {
    const r = c.result;
    const itemsHtml = r.items.length
      ? `<p class="muted">${r.items.map((it) => `${escapeHtml(it.name)}(${escapeHtml(it.amount || "")})`).join("・")}</p>`
      : "";
    const sourceBadge = r.source === "label"
      ? `<span class="badge">${iconHtml("label", 13)} 成分表示を読み取りました</span>`
      : (r.confidence === "low"
          ? `<span class="badge warn">推定の確度: 低め</span>`
          : `<span class="badge">推定の確度: ${r.confidence === "high" ? "高い" : "普通"}</span>`);

    actionArea = `
      <form id="result-form" class="stack">
        <div class="row" style="align-items:center; justify-content:space-between;">
          ${sourceBadge}
          <button type="button" class="link-btn" data-action="retake">撮り直す</button>
        </div>
        ${r.source === "label" ? `<p class="muted">写真の中の成分表示(パッケージ・アプリ画面など)の数値を使いました。表示のない栄養素はおおよその推定値です。</p>` : ""}
        ${itemsHtml}
        ${r.note ? `<p class="muted">${escapeHtml(r.note)}</p>` : ""}

        <label for="mealName">食事の名前</label>
        <input type="text" id="mealName" name="mealName" value="${escapeHtml(r.items[0]?.name || "食事")}">

        <div class="section-title">栄養素(必要に応じて修正できます)</div>
        ${Object.keys(NUTRIENT_META).map((k) => `
          <div class="result-item">
            <label class="label">${nutrientIconHtml(k)} ${NUTRIENT_META[k].label}</label>
            <input type="number" step="0.1" name="${k}" value="${r.nutrients[k]}"> <span class="muted">${NUTRIENT_META[k].unit}</span>
          </div>
        `).join("")}

        <label for="memo">メモ(任意)</label>
        <input type="text" id="memo" name="memo" placeholder="例: 外食・自炊など">

        <button type="button" class="btn btn-primary" data-action="add-log" style="margin-top:6px;">記録に追加</button>
      </form>
    `;
  } else {
    const manualOpen = c.showManual;
    actionArea = `
      ${c.error ? `<div class="notice">${escapeHtml(c.error)}</div>` : ""}
      <div class="stack">
        <button class="btn btn-primary" data-action="analyze">この写真を解析する</button>
        <button class="btn btn-outline" data-action="retake">撮り直す</button>
      </div>
      <button class="link-btn" data-action="toggle-manual" style="margin-top:14px;">${manualOpen ? "▲ 無料の手動方式を隠す" : "▼ 無料の手動方式を使う(APIキー不要)"}</button>
      ${manualOpen ? `
        <div class="card" style="margin-top:10px;">
          <h2>無料で解析する(APIキー不要)</h2>
          <p class="muted">① 下のボタンで解析用の指示文をコピーします。</p>
          <button type="button" class="btn btn-outline btn-sm" data-action="copy-prompt" style="width:auto;">指示文をコピー</button>
          <p class="muted" style="margin-top:12px;">② この写真とコピーした指示文を、お使いのAIチャット(ChatGPT・Claude・Gemini など)に貼り付けて送信してください。無料プランのままで構いません。</p>
          <p class="muted">③ 返ってきたJSON形式の回答をコピーして、下に貼り付けてください。</p>
          <label for="manual-json-input">回答を貼り付け</label>
          <textarea id="manual-json-input" rows="6" placeholder='{ "items": [...], "nutrients": {...}, ... }' style="width:100%; padding:11px 12px; border:1px solid var(--border); border-radius:12px; font-family:inherit; font-size:14px; resize:vertical;"></textarea>
          <button type="button" class="btn btn-primary" data-action="parse-manual" style="margin-top:10px;">貼り付けた内容を読み込む</button>
        </div>
      ` : ""}
    `;
  }

  return `
    <div class="top-header"><h1>食事を記録</h1></div>
    <div class="photo-preview" tabindex="0">${previewInner}</div>
    ${actionArea}
  `;
}

// ---------------- 描画: 履歴 ----------------

function renderHistory() {
  const all = Storage.getAllLogs();
  const dates = Object.keys(all).sort((a, b) => (a < b ? 1 : -1));

  if (dates.length === 0) {
    return `
      <div class="top-header"><h1>履歴</h1></div>
      <div class="card"><p class="muted">まだ記録がありません。</p></div>
    `;
  }

  const targets = calcTargets(state.profile);

  const daysHtml = dates.map((d) => {
    const entries = all[d];
    const sum = sumNutrients(entries);
    const open = state.historyOpenDate === d;
    const mealsHtml = entries.map((e) => `
      <div class="meal-item">
        ${e.thumb ? `<img class="meal-thumb" src="${e.thumb}" alt="">` : `<div class="meal-thumb"></div>`}
        <div class="meal-info">
          <div class="name">${escapeHtml(e.name)}</div>
          <div class="meta">${e.time} ・ ${Math.round(e.nutrients.calories)} kcal</div>
        </div>
        <button class="del" data-action="delete-log" data-date="${d}" data-id="${e.id}">${iconHtml("close")}</button>
      </div>
    `).join("");

    return `
      <div class="history-day" data-action="toggle-history-day" data-date="${d}">
        <span class="d">${formatDateLabel(d)}</span>
        <span class="kcal">${Math.round(sum.calories)} / ${targets.calories} kcal ${open ? "▲" : "▼"}</span>
      </div>
      ${open ? `<div>${mealsHtml}</div>` : ""}
    `;
  }).join("");

  return `
    <div class="top-header"><h1>履歴</h1></div>
    <div class="card">${daysHtml}</div>
  `;
}

document.addEventListener("DOMContentLoaded", init);
