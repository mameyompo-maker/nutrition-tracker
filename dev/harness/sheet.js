(function () {
  const q = new URLSearchParams(location.search);
  const which = q.get("sheet");
  if (!which) return;
  window.addEventListener("load", () => setTimeout(() => {
    if (which === "entry") {
      const k = todayKey();
      openEntrySheet(k, Storage.getLogsForDate(k).slice(-1)[0].id);
    } else if (which === "basis") { openBasisSheet(); }
    else if (which === "guide") { openSheet("Google AI Studio APIキーの取得", guideHtml("gemini")); }
    else if (which === "manual") { openManualAddSheet(); }
    else if (which === "weight") { openWeightSheet(); }
    else if (which === "mealplan") { openMealPlanSheet(); }
    else if (which === "targets") { openTargetsSheet(); }
    else if (which === "share") {
      const k = todayKey();
      openShareSheet(k, Storage.getLogsForDate(k).slice(-1)[0].id);
    }
  }, 150));
})();
