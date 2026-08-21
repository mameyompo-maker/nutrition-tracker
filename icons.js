// ---------------------------------------------------------------
// icons.js
// インラインSVGアイコン集(絵文字は使わず、線画のアイコンで統一)
// すべて currentColor を使うので、親要素の color / stroke 指定で色が変わります。
// ---------------------------------------------------------------

const ICONS = {
  calories: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21c-4 0-7-2.5-7-6.5C5 10 8 7 9 3c.5 3 3 3 3 6 0-2 2-3 2-5 2 2 3 5 3 8.5C17 18.5 16 21 12 21z"/></svg>`,
  protein: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="9" rx="4.5" ry="5.5"/><line x1="12" y1="14.5" x2="12" y2="21"/><line x1="9" y1="17" x2="15" y2="17"/></svg>`,
  fat: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c3 4 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-7 6-11z"/></svg>`,
  carb: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="21" x2="12" y2="4"/><line x1="12" y1="8" x2="8" y2="5"/><line x1="12" y1="8" x2="16" y2="5"/><line x1="12" y1="13" x2="8" y2="10"/><line x1="12" y1="13" x2="16" y2="10"/></svg>`,
  fiber: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20c0-9 6-15 15-15 0 9-6 15-15 15z"/><line x1="4" y1="20" x2="14" y2="10"/></svg>`,
  salt: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8.5" y="8" width="7" height="12" rx="2.2"/><path d="M9.5 8V6a2.5 2.5 0 0 1 5 0v2"/><circle cx="10.7" cy="12.2" r=".5" fill="currentColor" stroke="none"/><circle cx="13.1" cy="13.6" r=".5" fill="currentColor" stroke="none"/><circle cx="10.7" cy="15.6" r=".5" fill="currentColor" stroke="none"/></svg>`,
  meal: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="3" x2="7" y2="21"/><line x1="5" y1="3" x2="5" y2="9"/><line x1="9" y1="3" x2="9" y2="9"/><path d="M5 9c0 2 4 2 4 0"/><path d="M17 3c-2 0-3 2-3 4s1 4 3 4 3-2 3-4-1-4-3-4z"/><line x1="17" y1="11" x2="17" y2="21"/></svg>`,
  check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>`,
  close: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>`,
  label: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/></svg>`,
  camera: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7l2-3h4l2 3"/><circle cx="12" cy="13.5" r="3.5"/></svg>`,
  gallery: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5.5-5.5L5 20"/></svg>`,
  home: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-7 8 7"/><path d="M6 10v9a1 1 0 0 0 1 1h4v-6h2v6h4a1 1 0 0 0 1-1v-9"/></svg>`,
  calendar: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>`,
  settings: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>`,
};

// 二次栄養素(ミネラル・ビタミン・脂肪酸)は文字バッジで表現する
const NUTRIENT_BADGE = {
  calcium: "Ca",
  iron: "Fe",
  zinc: "Zn",
  magnesium: "Mg",
  potassium: "K",
  vitaminA: "A",
  vitaminC: "C",
  vitaminD: "D",
  vitaminE: "E",
  vitaminB1: "B1",
  vitaminB2: "B2",
  vitaminB6: "B6",
  vitaminB12: "B12",
  folate: "葉酸",
  saturatedFat: "SFA",
};

function iconHtml(key, size) {
  const svg = ICONS[key];
  if (!svg) return "";
  return size ? svg.replace('width="16"', `width="${size}"`).replace('height="16"', `height="${size}"`) : svg;
}

function nutrientIconHtml(key) {
  if (ICONS[key]) return iconHtml(key);
  if (NUTRIENT_BADGE[key]) {
    return `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 3px;border-radius:5px;background:var(--green-light);color:var(--green-deep);font-size:9px;font-weight:800;line-height:1;white-space:nowrap;">${NUTRIENT_BADGE[key]}</span>`;
  }
  return "";
}
