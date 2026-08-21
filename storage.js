// ---------------------------------------------------------------
// storage.js
// localStorageまわりの薄いラッパー。
// このアプリはブラウザで直接開いて使う想定のため、通常の
// localStorage / IndexedDB がそのまま使えます（データは端末内のみ）。
// ---------------------------------------------------------------

const LS_PROFILE = "nutriapp_profile_v1";
const LS_LOGS = "nutriapp_logs_v1";

function safeParse(json, fallback) {
  try {
    const v = JSON.parse(json);
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

const Storage = {
  getProfile() {
    return safeParse(localStorage.getItem(LS_PROFILE), null);
  },
  saveProfile(profile) {
    localStorage.setItem(LS_PROFILE, JSON.stringify(profile));
  },
  clearProfile() {
    localStorage.removeItem(LS_PROFILE);
  },

  getAllLogs() {
    return safeParse(localStorage.getItem(LS_LOGS), {});
  },
  getLogsForDate(dateKey) {
    const all = Storage.getAllLogs();
    return all[dateKey] || [];
  },
  addLog(dateKey, entry) {
    const all = Storage.getAllLogs();
    if (!all[dateKey]) all[dateKey] = [];
    all[dateKey].unshift(entry);
    localStorage.setItem(LS_LOGS, JSON.stringify(all));
  },
  deleteLog(dateKey, entryId) {
    const all = Storage.getAllLogs();
    if (!all[dateKey]) return;
    all[dateKey] = all[dateKey].filter((e) => e.id !== entryId);
    if (all[dateKey].length === 0) delete all[dateKey];
    localStorage.setItem(LS_LOGS, JSON.stringify(all));
  },
  clearAllLogs() {
    localStorage.removeItem(LS_LOGS);
  },
};

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDateLabel(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const wd = ["日", "月", "火", "水", "木", "金", "土"][dt.getDay()];
  return `${m}月${d}日(${wd})`;
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
