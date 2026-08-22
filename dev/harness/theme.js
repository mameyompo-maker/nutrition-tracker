(function () {
  if (new URLSearchParams(location.search).get("theme") !== "1") return;
  window.addEventListener("load", () => setTimeout(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    const seg = document.querySelector(".segmented .seg.on");
    const track = document.querySelector(".segmented");
    const lines = [
      "prefers-color-scheme:dark = " + window.matchMedia("(prefers-color-scheme: dark)").matches,
      "--bg      = " + v("--bg"),
      "--surface = " + v("--surface"),
      "--text    = " + v("--text"),
      "--accent  = " + v("--accent"),
      "--seg-on  = " + v("--seg-on"),
      "body bg   = " + getComputedStyle(document.body).backgroundColor,
      "seg.on bg = " + (seg ? getComputedStyle(seg).backgroundColor : "(none)"),
      "track bg  = " + (track ? getComputedStyle(track).backgroundColor : "(none)"),
    ];
    const d = document.createElement("div");
    d.id = "theme-out";
    d.textContent = lines.join("\n");
    document.body.appendChild(d);
    fetch("/__result", { method: "POST", body: d.textContent }).catch(() => {});
  }, 200));
})();
