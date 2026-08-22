// ---------------------------------------------------------------
// storage.js
// localStorageまわりの薄いラッパー。
// このアプリはブラウザで直接開いて使う想定のため、通常の
// localStorage がそのまま使えます（データは端末内のみ）。
//
// 容量(およそ5MB)を使い切らないよう、写真は小さなサムネイルに
// 縮めてから保存する。それでも書き込みに失敗した場合は、
// 古い記録のサムネイルから順に手放して本文を守る。
// ---------------------------------------------------------------

const LS_PROFILE = "nutriapp_profile_v1";
const LS_LOGS = "nutriapp_logs_v1";
const LS_FAVS = "nutriapp_favs_v1";
const LS_WEIGHTS = "nutriapp_weights_v1";

function safeParse(json, fallback) {
  try {
    const v = JSON.parse(json);
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function writeLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

const Storage = {
  getProfile() {
    return safeParse(localStorage.getItem(LS_PROFILE), null);
  },
  saveProfile(profile) {
    writeLS(LS_PROFILE, profile);
  },
  clearProfile() {
    localStorage.removeItem(LS_PROFILE);
  },

  // ---------------- 食事の記録 ----------------

  getAllLogs() {
    return safeParse(localStorage.getItem(LS_LOGS), {});
  },
  getLogsForDate(dateKey) {
    const all = Storage.getAllLogs();
    return all[dateKey] || [];
  },
  // 書き込めなかったら、古い日のサムネイルから順に外して本文を守る。
  // 戻り値: "ok" | "shed"(サムネイルを一部手放した) | "fail"
  setAllLogs(all) {
    if (writeLS(LS_LOGS, all)) return "ok";
    const dates = Object.keys(all).sort(); // 古い日付から
    let shed = false;
    for (const d of dates) {
      for (const e of all[d]) {
        if (e.thumb) {
          e.thumb = null;
          shed = true;
          if (writeLS(LS_LOGS, all)) return "shed";
        }
      }
    }
    return shed && writeLS(LS_LOGS, all) ? "shed" : "fail";
  },
  addLog(dateKey, entry) {
    const all = Storage.getAllLogs();
    if (!all[dateKey]) all[dateKey] = [];
    all[dateKey].unshift(entry);
    return Storage.setAllLogs(all);
  },
  updateLog(dateKey, entryId, patch) {
    const all = Storage.getAllLogs();
    const list = all[dateKey];
    if (!list) return "fail";
    const i = list.findIndex((e) => e.id === entryId);
    if (i === -1) return "fail";
    list[i] = Object.assign({}, list[i], patch);
    return Storage.setAllLogs(all);
  },
  // 削除した項目を返す(「元に戻す」用)
  deleteLog(dateKey, entryId) {
    const all = Storage.getAllLogs();
    if (!all[dateKey]) return null;
    const i = all[dateKey].findIndex((e) => e.id === entryId);
    if (i === -1) return null;
    const [removed] = all[dateKey].splice(i, 1);
    if (all[dateKey].length === 0) delete all[dateKey];
    Storage.setAllLogs(all);
    return { entry: removed, index: i };
  },
  restoreLog(dateKey, entry, index) {
    const all = Storage.getAllLogs();
    if (!all[dateKey]) all[dateKey] = [];
    const i = Math.max(0, Math.min(all[dateKey].length, index ?? 0));
    all[dateKey].splice(i, 0, entry);
    return Storage.setAllLogs(all);
  },
  clearAllLogs() {
    localStorage.removeItem(LS_LOGS);
  },

  // ---------------- よく食べるもの ----------------

  getFavorites() {
    return safeParse(localStorage.getItem(LS_FAVS), []);
  },
  saveFavorites(favs) {
    return writeLS(LS_FAVS, favs);
  },
  // 同じ名前があれば置き換える(同じ料理を撮り直したときに増殖させない)
  addFavorite(fav) {
    const favs = Storage.getFavorites().filter((f) => f.name !== fav.name);
    favs.unshift(fav);
    return Storage.saveFavorites(favs.slice(0, 30));
  },
  removeFavorite(id) {
    Storage.saveFavorites(Storage.getFavorites().filter((f) => f.id !== id));
  },
  findFavoriteByName(name) {
    return Storage.getFavorites().find((f) => f.name === name) || null;
  },

  // ---------------- 体重 ----------------

  getWeights() {
    return safeParse(localStorage.getItem(LS_WEIGHTS), {});
  },
  setWeight(dateKey, kg) {
    const w = Storage.getWeights();
    w[dateKey] = kg;
    return writeLS(LS_WEIGHTS, w);
  },
};

// ---------------- 日付ヘルパー ----------------

function dateKeyOf(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayKey() {
  return dateKeyOf(new Date());
}

// 今日を含む直近n日ぶんの日付キー(古い→新しい)
function lastNDates(n) {
  const out = [];
  const base = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
    out.push(dateKeyOf(d));
  }
  return out;
}

const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];

function formatDateLabel(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${m}月${d}日(${WEEKDAYS_JA[dt.getDay()]})`;
}

// "8/21" のような短い表記(チャートの軸に使う)
function formatDateShort(dateKey) {
  const [, m, d] = dateKey.split("-").map(Number);
  return `${m}/${d}`;
}

function weekdayChar(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return WEEKDAYS_JA[new Date(y, m - 1, d).getDay()];
}

function sumNutrients(entries) {
  const sum = {};
  Object.keys(NUTRIENT_META).forEach((k) => (sum[k] = 0));
  entries.forEach((e) => {
    Object.keys(NUTRIENT_META).forEach((k) => {
      sum[k] += Number(e.nutrients?.[k]) || 0;
    });
  });
  return sum;
}
