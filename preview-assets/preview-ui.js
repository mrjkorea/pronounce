/* Preview-only UI layer for Pronounce. No engine, mic, scoring or auth changes.
   - sets html[data-book] from the route (Basic=green, Int 2=blue, Int 3=red)
   - replaces the language <select> with a chip picker (select stays, hidden, driven by "change") */
(function () {
  "use strict";
  function fam() {
    var h = location.hash;
    return /int3/.test(h) ? "red" : /int2/.test(h) ? "blue" : "green";
  }
  function setTheme() {
    document.documentElement.setAttribute("data-book", fam());
    document.documentElement.setAttribute("data-view", /unit\//.test(location.hash) ? "sheet" : /book\//.test(location.hash) ? "units" : "home");
  }
  function langPicker() {
    var sel = document.getElementById("langMenu");
    if (!sel || !sel.options.length || document.querySelector(".pv-lang")) return !!sel && !!sel.options.length;
    sel.closest("label").classList.add("pv-hidden-control");
    var wrap = document.createElement("div");
    wrap.className = "pv-lang";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pv-lang-btn";
    btn.setAttribute("aria-expanded", "false");
    var pop = document.createElement("div");
    pop.className = "pv-lang-pop";
    pop.hidden = true;
    function label() { btn.textContent = "🌐 " + (sel.options[sel.selectedIndex] || {}).textContent; }
    Array.prototype.forEach.call(sel.options, function (o) {
      var c = document.createElement("button");
      c.type = "button";
      c.className = "pv-lang-chip" + (o.value === sel.value ? " is-on" : "");
      c.textContent = o.textContent;
      c.onclick = function () {
        sel.value = o.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        pop.querySelectorAll(".pv-lang-chip").forEach(function (x) { x.classList.toggle("is-on", x === c); });
        label(); pop.hidden = true; btn.setAttribute("aria-expanded", "false");
      };
      pop.appendChild(c);
    });
    btn.onclick = function () { pop.hidden = !pop.hidden; btn.setAttribute("aria-expanded", String(!pop.hidden)); };
    label();
    wrap.appendChild(btn); wrap.appendChild(pop);
    sel.closest(".top-row").appendChild(wrap);
    return true;
  }
  setTheme();
  window.addEventListener("hashchange", setTheme);
  var tries = 0;
  (function wait() { if (!langPicker() && tries++ < 100) setTimeout(wait, 100); })();
})();
