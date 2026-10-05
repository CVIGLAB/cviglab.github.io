// CVIG Lab — shared behaviour: mobile nav, media/photo fallbacks, BibTeX toggles, theme.
(function () {
  "use strict";
  document.documentElement.classList.add("js");

  // Scroll reveals: children of [data-reveal] rise in once when the block enters view.
  var revealables = document.querySelectorAll("[data-reveal]");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px" });
    revealables.forEach(function (el) { io.observe(el); });
  } else {
    revealables.forEach(function (el) { el.classList.add("is-in"); });
  }

  // Mobile nav
  var header = document.querySelector(".site-header");
  var toggle = document.querySelector(".nav-toggle");
  if (header && toggle) {
    toggle.addEventListener("click", function () {
      var open = header.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }

  // Empty .media slots get a ColorChecker chart; empty .photo slots a silhouette (CSS).
  var empty = function (slot) {
    slot.classList.add("is-empty");
    if (!slot.classList.contains("media") || slot.querySelector(".checker")) return;
    var chart = document.createElement("span");
    chart.className = "checker";
    chart.setAttribute("aria-hidden", "true");
    var strip = slot.closest(".strip");
    if (strip) chart.style.setProperty("--d", Array.prototype.indexOf.call(strip.children, slot.closest(".teaser")) * 90 + "ms");
    for (var i = 0; i < 24; i++) {
      var p = document.createElement("i");
      p.style.setProperty("--i", (i % 6) + Math.floor(i / 6));
      chart.appendChild(p);
    }
    slot.appendChild(chart);
  };
  document.querySelectorAll(".media, .photo").forEach(function (slot) {
    var el = slot.querySelector("img, video");
    if (!el) { empty(slot); return; }
    var fail = function () { el.remove(); empty(slot); };
    if (el.tagName === "IMG") {
      if (el.complete && el.naturalWidth === 0) fail();
      else el.addEventListener("error", fail);
    } else {
      el.addEventListener("error", fail, true);
    }
  });

  // BibTeX: button[data-bib="id"] toggles <div class="bibtex" id="id" hidden><pre>…</pre></div>
  document.querySelectorAll("[data-bib]").forEach(function (btn) {
    var box = document.getElementById(btn.getAttribute("data-bib"));
    if (!box) return;
    btn.setAttribute("aria-controls", box.id);
    btn.setAttribute("aria-expanded", "false");
    btn.addEventListener("click", function () {
      var show = box.hasAttribute("hidden");
      box.toggleAttribute("hidden", !show);
      btn.setAttribute("aria-expanded", String(show));
    });
    if (!box.querySelector(".copy")) {
      var copy = document.createElement("button");
      copy.type = "button";
      copy.className = "act copy";
      copy.textContent = "Copy";
      copy.addEventListener("click", function () {
        var text = box.querySelector("pre").textContent.trim();
        var done = function () { copy.textContent = "Copied"; setTimeout(function () { copy.textContent = "Copy"; }, 1600); };
        if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {});
        else {
          var r = document.createRange(); r.selectNodeContents(box.querySelector("pre"));
          var s = getSelection(); s.removeAllRanges(); s.addRange(r);
          try { document.execCommand("copy"); done(); } catch (e) {}
        }
      });
      box.appendChild(copy);
    }
  });

  // Theme: follows the system setting until the header toggle saves a choice for this viewer.
  var root = document.documentElement;
  try { var saved = localStorage.getItem("cvig-theme"); if (saved) root.setAttribute("data-theme", saved); } catch (e) {}
  var tbtn = document.querySelector(".theme-toggle");
  if (tbtn) {
    var sys = matchMedia("(prefers-color-scheme: dark)");
    var isDark = function () {
      var t = root.getAttribute("data-theme");
      return t ? t === "dark" : sys.matches;
    };
    var label = function () {
      var dark = isDark();
      tbtn.setAttribute("aria-pressed", String(dark));
      tbtn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
    };
    label();
    tbtn.addEventListener("click", function () {
      var next = isDark() ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("cvig-theme", next); } catch (e) {}
      label();
    });
    if (sys.addEventListener) sys.addEventListener("change", label);
  }
})();
