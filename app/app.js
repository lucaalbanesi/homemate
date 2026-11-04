// Casa mia, versione online: orologio, meteo (Open-Meteo), notizie (file del sito), spesa (Google Tasks).
(function () {
  "use strict";
  var C = window.CASA_CONFIG || {};
  var KIOSK = typeof window.fully !== "undefined" || /[?&]kiosk\b/.test(location.search);

  var ICONS = {
    sun: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><circle cx="24" cy="24" r="8"/><path d="M24 5v6M24 37v6M5 24h6M37 24h6M10.5 10.5l4.2 4.2M33.3 33.3l4.2 4.2M10.5 37.5l4.2-4.2M33.3 14.7l4.2-4.2"/></svg>',
    part: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="17" cy="17" r="6"/><path d="M17 5v3M5 17h3M8.5 8.5l2 2M25.5 8.5l-2 2"/><path d="M16 38h19a7 7 0 0 0 0-14 10 10 0 0 0-19 2.5A5.8 5.8 0 0 0 16 38z"/></svg>',
    cloud: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M13 36h22a8 8 0 0 0 0-16 11 11 0 0 0-21 3A6.5 6.5 0 0 0 13 36z"/></svg>',
    rain: '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M13 30h22a8 8 0 0 0 0-16 11 11 0 0 0-21 3A6.5 6.5 0 0 0 13 30z"/><path d="M16 36l-2 6M25 36l-2 6M34 36l-2 6"/></svg>'
  };
  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function romeNow() { return new Date().toLocaleString("sv-SE", { timeZone: "Europe/Rome" }).replace(" ", "T").slice(0, 16); }
  function hhmm(d) { return (d || new Date()).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" }); }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k)); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

  // ---------- Orologio ----------
  function tick() {
    var d = new Date();
    $("idleClock").textContent = $("clock").textContent = hhmm(d);
    $("date").textContent = d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Rome" });
  }
  tick(); setInterval(tick, 15000);

  // ---------- Finestra di dettaglio ----------
  var modal = $("modal");
  function openModal(title, html) { $("modalTitle").textContent = title; $("modalBody").innerHTML = html; modal.classList.add("show"); $("modalClose").focus(); }
  function closeModal() { modal.classList.remove("show"); }
  $("modalClose").addEventListener("click", closeModal);
  modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
  function onTap(el, fn) {
    el.addEventListener("click", fn);
    el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } });
  }

  // ---------- Adatta la grandezza allo schermo (tablet e schermi grandi) ----------
  var fitTimer;
  function fit() {
    var root = document.documentElement;
    var land = matchMedia("(orientation: landscape) and (min-width: 900px)").matches;
    if (!land && !(KIOSK && innerWidth >= 700)) { root.style.fontSize = ""; return; }
    var lo = 10, hi = 22;
    function over() {
      if (land) return [].some.call(document.querySelectorAll(".col"), function (c) { return c.scrollHeight > c.clientHeight + 1; });
      return document.querySelector(".wrap").scrollHeight > innerHeight + 1;
    }
    for (var i = 0; i < 9; i++) { var mid = (lo + hi) / 2; root.style.fontSize = mid + "px"; if (over()) hi = mid; else lo = mid; }
    root.style.fontSize = lo + "px";
  }
  function fitSoon() { clearTimeout(fitTimer); fitTimer = setTimeout(fit, 120); }
  addEventListener("resize", fitSoon);
  addEventListener("orientationchange", fitSoon);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  fit();

  // ---------- Meteo (Open-Meteo, direttamente dal browser) ----------
  var EVENING = C.oraSera || 18, lastWx = null;
  function wx(code) {
    if (code === 0) return ["sun", "Sereno"];
    if (code <= 2) return ["part", "Poco nuvoloso"];
    if (code === 3) return ["cloud", "Nuvoloso"];
    if (code === 45 || code === 48) return ["cloud", "Nebbia"];
    if (code >= 51 && code <= 57) return ["rain", "Pioggerella"];
    if (code >= 61 && code <= 67) return ["rain", "Pioggia"];
    if (code >= 71 && code <= 77) return ["cloud", "Neve"];
    if (code >= 80 && code <= 82) return ["rain", "Rovesci"];
    if (code >= 95) return ["rain", "Temporale"];
    return ["cloud", "Variabile"];
  }
  function shapeWeather(j) {
    var SLOTS = ["06", "09", "12", "15", "18", "21"], r = Math.round;
    return {
      now: { t: r(j.current.temperature_2m), code: j.current.weather_code },
      days: j.daily.time.map(function (date, d) {
        var day = { date: date, min: r(j.daily.temperature_2m_min[d]), max: r(j.daily.temperature_2m_max[d]), pop: j.daily.precipitation_probability_max[d], code: j.daily.weather_code[d], wind: r(j.daily.wind_speed_10m_max[d]), sunrise: j.daily.sunrise[d].slice(11, 16), sunset: j.daily.sunset[d].slice(11, 16) };
        if (d < 2) day.slots = SLOTS.map(function (h) {
          var k = j.hourly.time.indexOf(date + "T" + h + ":00");
          return k < 0 ? null : { time: h + ":00", t: r(j.hourly.temperature_2m[k]), pop: j.hourly.precipitation_probability[k], code: j.hourly.weather_code[k] };
        }).filter(Boolean);
        return day;
      })
    };
  }
  function dayName(iso, i) {
    if (i === 0) return "Oggi";
    if (i === 1) return "Domani";
    var s = new Date(iso + "T12:00:00").toLocaleDateString("it-IT", { weekday: "short", day: "numeric" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function renderWeather(w) {
    lastWx = w;
    var hourNow = Number(romeNow().slice(11, 13)), di = hourNow >= EVENING ? 1 : 0, day = w.days[di], n = wx(w.now.code);
    $("now").hidden = false;
    $("nowIcon").innerHTML = ICONS[n[0]];
    $("temp").textContent = w.now.t + "°";
    $("cond").textContent = n[1];
    $("wxTitle").textContent = (C.luogo || "Meteo") + ", " + (di ? "domani" : "oggi");
    $("wxBody").innerHTML = '<div class="hours">' + (day.slots || []).map(function (h) {
      var past = di === 0 && Number(h.time.slice(0, 2)) + 3 <= hourNow;
      return '<div class="hour' + (past ? " past" : "") + '"><span>' + h.time + "</span>" + ICONS[wx(h.code)[0]] + "<b>" + h.t + "°</b><span>" + h.pop + "%</span></div>";
    }).join("") + "</div>" +
      '<div class="wline"><span>' + (di ? "Domani" : "Oggi") + " <b>" + day.min + "° / " + day.max + "°</b></span><span>Pioggia <b>" + day.pop + "%</b></span><span>Vento <b>" + day.wind + " km/h</b></span><span>Alba/Tramonto <b>" + day.sunrise + " / " + day.sunset + "</b></span></div>" +
      '<div class="more">Prossimi 7 giorni ›</div>';
    fitSoon();
  }
  function weekHtml() {
    return lastWx.days.map(function (d, i) {
      var c = wx(d.code);
      return '<div class="wday"><span class="dn">' + dayName(d.date, i) + "</span>" + ICONS[c[0]] + '<span class="dc">' + c[1] + '</span><span class="dp">' + d.pop + '% pioggia</span><span class="dt">' + d.max + "° <span>/ " + d.min + "°</span></span></div>";
    }).join("");
  }
  var wxRetry;
  function loadWeather() {
    clearTimeout(wxRetry);
    var q = "latitude=" + C.lat + "&longitude=" + C.lon + "&timezone=Europe%2FRome&forecast_days=8" +
      "&current=temperature_2m,weather_code&hourly=temperature_2m,precipitation_probability,weather_code" +
      "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,wind_speed_10m_max,sunrise,sunset";
    fetch("https://api.open-meteo.com/v1/forecast?" + q).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (j) {
      var w = shapeWeather(j);
      store("casa.meteo", { at: Date.now(), w: w });
      renderWeather(w);
      $("wxTag").textContent = "aggiornato " + hhmm();
    }).catch(function () {
      var saved = store("casa.meteo");
      if (!lastWx && saved && Date.now() - saved.at < 12 * 3.6e6) { renderWeather(saved.w); $("wxTag").textContent = "dati delle " + hhmm(new Date(saved.at)); }
      else if (!lastWx) $("wxBody").innerHTML = '<div class="state err">Meteo non disponibile. Riprovo tra un minuto.</div>';
      else $("wxTag").textContent = "non aggiornato";
      wxRetry = setTimeout(loadWeather, 60000);
    });
  }
  onTap($("wxCard"), function () { if (lastWx) openModal((C.luogo || "Meteo") + ", prossimi 7 giorni", weekHtml()); });
  setInterval(function () { if (lastWx) renderWeather(lastWx); }, 5 * 60000);

  // ---------- Notizie (file preparato dal job ogni 30 minuti) ----------
  var news = null, newsRetry;
  $("videoLink").href = C.videoUrl || "#";
  $("videoName").textContent = C.videoNome || "Diretta video";
  function ago(iso) {
    if (!iso) return "";
    var m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return "adesso";
    if (m < 60) return m + " min fa";
    if (m < 1440) return Math.round(m / 60) + " h fa";
    return Math.round(m / 1440) + " g fa";
  }
  var PAPER = '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"><rect x="8" y="10" width="32" height="28" rx="3"/><path d="M14 18h20M14 25h20M14 31h12"/></svg>';
  function img(it) {
    return it.image
      ? '<img class="thumb" src="' + esc(it.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer">'
      : '<div class="thumb none">' + PAPER + "</div>";
  }
  // se un'immagine non si carica, al suo posto compare il riquadro neutro
  document.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t.tagName === "IMG" && t.classList.contains("thumb")) { var d = document.createElement("div"); d.className = "thumb none"; d.innerHTML = PAPER; t.replaceWith(d); }
  }, true);
  function renderNews() {
    $("news").innerHTML = news.items.slice(0, 2).map(function (it) {
      return '<div class="row">' + img(it) + "<div><small>" + esc(news.source) + (it.time ? " · " + ago(it.time) : "") + "</small><p>" + esc(it.title) + "</p></div></div>";
    }).join("");
    $("newsMore").hidden = news.items.length <= 2;
    $("newsTag").textContent = "ANSA · " + hhmm(new Date(news.updated));
    fitSoon();
  }
  function newsHtml() {
    return '<p class="sheet-note">Scelte tra i feed ANSA: prima le notizie in primo piano, su Roma e Lazio e con effetti sulla vita di tutti i giorni; le più recenti a parità di importanza.</p>' +
      news.items.map(function (it) {
        return '<div class="nitem">' + img(it) + '<div><small>' + esc(it.why && it.why.length ? it.why.join(" · ") : "ANSA") + (it.time ? " · " + ago(it.time) : "") + "</small><h4>" + esc(it.title) + "</h4>" +
          (it.text ? "<p>" + esc(it.text) + "</p>" : "") + (it.link ? '<a href="' + esc(it.link) + '" target="_blank" rel="noopener">Leggi su ANSA ›</a>' : "") + "</div></div>";
      }).join("");
  }
  function loadNews() {
    clearTimeout(newsRetry);
    fetch("data/news.json", { cache: "no-store" }).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (d) {
      if (!d || !d.items || !d.items.length) throw 0;
      news = d; renderNews();
    }).catch(function () {
      if (!news) $("news").innerHTML = '<div class="state err">Notizie non disponibili. Riprovo tra un minuto.</div>';
      newsRetry = setTimeout(loadNews, 60000);
    });
  }
  function openNews() { if (news) openModal("Le 10 notizie più importanti", newsHtml()); }
  onTap($("news"), openNews);
  $("newsMore").addEventListener("click", openNews);

  // ---------- Mensa (file preparato dal job ogni mattina) ----------
  var menu = null;
  function todayIso() { return romeNow().slice(0, 10); }
  function dayLabel(iso) {
    if (iso === todayIso()) return "oggi";
    var t = new Date(todayIso() + "T12:00:00"); t.setDate(t.getDate() + 1);
    if (iso === t.toISOString().slice(0, 10)) return "domani";
    return new Date(iso + "T12:00:00").toLocaleDateString("it-IT", { weekday: "long", day: "numeric" });
  }
  function mealHtml(d) {
    if (!d.disponibile) return '<p class="state">Nessun menu per questo giorno' + (d.note ? ": " + esc(d.note) : ".") + "</p>";
    return '<div class="meal">' + (d.pranzo.length ? '<div class="main">' + d.pranzo.map(esc).join("<br>") + "</div>" : "") +
      '<div class="side">' + (d.spuntino ? "<span>Spuntino <b>" + esc(d.spuntino) + "</b></span>" : "") + (d.merenda ? "<span>Merenda <b>" + esc(d.merenda) + "</b></span>" : "") + "</div>" +
      (d.note ? '<div class="note">' + esc(d.note) + "</div>" : "") + "</div>";
  }
  function renderMeal() {
    var t = todayIso(), days = menu.days || [];
    var d = days.filter(function (x) { return x.date === t; })[0] || days.filter(function (x) { return x.date > t; })[0];
    if (!d) { $("mealTitle").textContent = "Mensa"; $("mealBody").innerHTML = '<p class="state">Menu non ancora aggiornato.</p>'; return; }
    $("mealTitle").textContent = "Mensa, " + dayLabel(d.date);
    $("mealTag").textContent = menu.ciclo || "";
    $("mealBody").innerHTML = mealHtml(d);
    fitSoon();
  }
  function loadMeal() {
    fetch("data/menu.json", { cache: "no-store" }).then(function (r) {
      if (r.status === 404) throw { missing: true };
      if (!r.ok) throw 0; return r.json();
    }).then(function (m) { menu = m; renderMeal(); }).catch(function (e) {
      if (menu) return;
      $("mealBody").innerHTML = e && e.missing ? '<p class="state">Menu della mensa non ancora impostato.</p>' : '<p class="state err">Menu non disponibile. Riprovo più tardi.</p>';
    });
  }
  onTap($("mealCard"), function () {
    if (!menu || !menu.days || !menu.days.length) return;
    var t = todayIso();
    openModal("Mensa, prossimi giorni", menu.days.filter(function (d) { return d.date >= t; }).map(function (d) {
      return '<div class="mday"><h4>' + esc(dayLabel(d.date)) + "</h4>" + mealHtml(d) + "</div>";
    }).join("") || '<p class="state">Nessun giorno disponibile.</p>');
  });
  setInterval(function () { if (menu) renderMeal(); }, 10 * 60000);

  // ---------- Spesa (Google Tasks, con l'accesso Google di chi usa la pagina) ----------
  var SCOPE = "https://www.googleapis.com/auth/tasks", API = "https://tasks.googleapis.com/tasks/v1";
  var tokenClient = null, listId = store("casa.spesa.lista"), items = [];
  function token() { var t = store("casa.google"); return t && t.exp > Date.now() + 60000 ? t.token : null; }
  function shop(html) { $("shopBody").innerHTML = html; fitSoon(); }
  function gapi(path, opt) {
    opt = opt || {};
    opt.headers = { Authorization: "Bearer " + token(), "Content-Type": "application/json" };
    return fetch(API + path, opt).then(function (r) {
      if (r.status === 401) { store("casa.google", null); throw { auth: true }; }
      if (!r.ok) throw { status: r.status };
      return r.status === 204 ? null : r.json();
    });
  }
  function showLogin(msg) {
    $("shopTag").textContent = "";
    shop('<p class="state">' + esc(msg) + '</p><button class="btn primary" id="gLogin">Accedi con Google</button>');
    $("gLogin").addEventListener("click", login);
  }
  function login() {
    if (!tokenClient) return;
    tokenClient.requestAccessToken({ prompt: store("casa.google.ok") ? "" : "consent" });
  }
  function findList() {
    if (listId) return Promise.resolve(listId);
    return gapi("/users/@me/lists?maxResults=100").then(function (d) {
      var name = (C.listaSpesa || "Spesa").toLowerCase();
      var l = (d.items || []).filter(function (x) { return x.title.trim().toLowerCase() === name; })[0];
      if (!l) throw { noList: true };
      listId = l.id; store("casa.spesa.lista", listId); return listId;
    });
  }
  function renderShop() {
    var open = items.filter(function (t) { return t.status !== "completed"; });
    $("shopTag").textContent = open.length ? open.length + " da prendere" : "";
    shop((open.length ? '<ul class="shop">' + open.map(function (t) {
      return '<li><button data-id="' + esc(t.id) + '"><span class="box" aria-hidden="true"></span><span>' + esc(t.title) + "</span></button></li>";
    }).join("") + "</ul>" : '<p class="state">Lista vuota.</p>') +
      '<form class="add" id="addForm"><input id="addItem" aria-label="Cosa aggiungere alla lista" placeholder="Aggiungi alla lista" autocomplete="off" maxlength="120"><button class="btn primary" type="submit">Aggiungi</button></form>');
    $("addForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var v = $("addItem").value.trim(); if (!v) return;
      $("addItem").value = "";
      items.unshift({ id: "tmp" + Date.now(), title: v, status: "needsAction" }); renderShop();
      gapi("/lists/" + listId + "/tasks", { method: "POST", body: JSON.stringify({ title: v }) }).then(loadShop, shopError);
    });
    [].forEach.call(document.querySelectorAll(".shop button"), function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-id"); if (id.indexOf("tmp") === 0) return;
        b.classList.add("done");
        gapi("/lists/" + listId + "/tasks/" + encodeURIComponent(id), { method: "PATCH", body: JSON.stringify({ status: "completed" }) })
          .then(function () { setTimeout(loadShop, 600); }, shopError);
      });
    });
  }
  function shopError(e) {
    if (e && e.auth) return showLogin("Accesso a Google scaduto.");
    if (e && e.noList) {
      shop('<p class="state">Non trovo la lista "' + esc(C.listaSpesa || "Spesa") + '" in Google Tasks.</p><button class="btn primary" id="mkList">Crea la lista</button>');
      $("mkList").addEventListener("click", function () {
        gapi("/users/@me/lists", { method: "POST", body: JSON.stringify({ title: C.listaSpesa || "Spesa" }) }).then(function (l) { listId = l.id; store("casa.spesa.lista", listId); loadShop(); }, shopError);
      });
      return;
    }
    if (e && e.status === 404) { listId = null; store("casa.spesa.lista", null); return loadShop(); }
    $("shopTag").textContent = "non aggiornata";
    if (!items.length) shop('<p class="state err">Lista non disponibile. Riprovo tra un minuto.</p>');
  }
  function loadShop() {
    if (!C.googleClientId) return shop('<p class="state">Lista della spesa non ancora collegata a Google Tasks.</p>');
    if (!token()) return showLogin("Entra con il tuo account Google per vedere la lista della spesa.");
    findList().then(function (id) { return gapi("/lists/" + id + "/tasks?showCompleted=false&maxResults=100"); })
      .then(function (d) { items = (d && d.items) || []; renderShop(); }, shopError);
  }
  function initGoogle() {
    if (!C.googleClientId) return loadShop();
    var s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = function () {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: C.googleClientId, scope: SCOPE,
        callback: function (r) {
          if (!r || !r.access_token) return showLogin("Accesso non riuscito, riprova.");
          store("casa.google", { token: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 });
          store("casa.google.ok", true);
          loadShop();
        }
      });
      loadShop();
    };
    s.onerror = function () { shop('<p class="state err">Non riesco a contattare Google. Riprovo tra un minuto.</p>'); setTimeout(initGoogle, 60000); };
    document.head.appendChild(s);
  }
  setInterval(function () { if (token() && !document.activeElement.matches("#addItem")) loadShop(); }, 2 * 60000);

  // ---------- Avvio ----------
  loadWeather(); loadNews(); loadMeal(); initGoogle();
  setInterval(loadWeather, 15 * 60000);
  setInterval(loadNews, 10 * 60000);
  setInterval(loadMeal, 60 * 60000);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(function () {});

  // ---------- Riposo (solo tablet kiosk) ----------
  if (KIOSK) {
    var lastTouch = Date.now(), sleeping = false, savedBrightness = null, idleEl = $("idle");
    var sleep = function () {
      if (sleeping) return; sleeping = true; idleEl.classList.add("show"); closeModal();
      try { if (window.fully) { savedBrightness = fully.getScreenBrightness(); fully.setScreenBrightness(1); } } catch (e) {}
    };
    var wake = function () {
      lastTouch = Date.now(); if (!sleeping) return; sleeping = false; idleEl.classList.remove("show");
      try { if (window.fully && savedBrightness !== null) fully.setScreenBrightness(savedBrightness); } catch (e) {}
      fitSoon();
    };
    idleEl.addEventListener("click", function (e) { e.stopPropagation(); wake(); });
    ["pointerdown", "keydown"].forEach(function (ev) { document.addEventListener(ev, function () { if (!sleeping) lastTouch = Date.now(); }, true); });
    setInterval(function () { if (!sleeping && Date.now() - lastTouch > (C.riposoMinuti || 2) * 60000) sleep(); }, 10000);
  }
})();
