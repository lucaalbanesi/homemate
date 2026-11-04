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
  // tocco su una scheda; i controlli dentro la scheda (tendine, pulsanti, link) fanno solo il loro lavoro
  function onTap(el, fn) {
    var inner = function (e) { return e.target !== el && e.target.closest && e.target.closest("select, button, input, form, a"); };
    el.addEventListener("click", function (e) { if (!inner(e)) fn(); });
    el.addEventListener("keydown", function (e) { if (!inner(e) && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); fn(); } });
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

  // ---------- Mensa (menu preparati dal job ogni mattina; la scuola si sceglie sul dispositivo) ----------
  var MUNICIPI = [[1, "I"], [2, "II"], [4, "III"], [5, "IV"], [6, "V"], [8, "VI"], [9, "VII"], [11, "VIII"], [12, "IX"], [13, "X"], [15, "XI"], [16, "XII"], [18, "XIII"], [19, "XIV"], [20, "XV"]];
  var CICLI = [[1, "Nido medi"], [2, "Nido grandi"], [3, "Ponte"], [4, "Infanzia"], [5, "Primaria"], [6, "Secondaria di I grado"]];
  var menu = null, mealMissing = false;
  function nameOf(list, v) { var x = list.filter(function (p) { return p[0] === Number(v); })[0]; return x ? x[1] : ""; }
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
  function school() { var s = store("casa.mensa"); return s && s.m && s.c ? s : null; }
  function myMenu() { var s = school(); return s && menu && menu.menus ? menu.menus[s.m + "-" + s.c] : null; }
  function options(list, sel) { return '<option value="">Scegli…</option>' + list.map(function (p) { return '<option value="' + p[0] + '"' + (Number(sel) === p[0] ? " selected" : "") + ">" + (list === MUNICIPI ? "Municipio " : "") + p[1] + "</option>"; }).join(""); }
  function showChooser() {
    var s = store("casa.mensa") || {};
    $("mealTitle").textContent = "Mensa"; $("mealTag").textContent = "";
    $("mealBody").innerHTML = '<form class="choose" id="mealForm"><p class="state">Scegli la scuola per vedere il menu. Resta salvata su questo dispositivo.</p>' +
      '<label for="mealMun">Municipio</label><select id="mealMun">' + options(MUNICIPI, s.m) + "</select>" +
      '<label for="mealCic">Ciclo</label><select id="mealCic">' + options(CICLI, s.c) + "</select>" +
      '<button class="btn primary" type="submit">Salva</button><p class="state err" id="mealErr" hidden></p></form>';
    $("mealForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var m = $("mealMun").value, c = $("mealCic").value;
      if (!m || !c) { $("mealErr").textContent = "Scegli municipio e ciclo."; $("mealErr").hidden = false; return; }
      store("casa.mensa", { m: Number(m), c: Number(c) }); $("mealBody").innerHTML = ""; renderMeal();
    });
    ["mealMun", "mealCic"].forEach(function (id) { $(id).addEventListener("change", function () { $("mealErr").hidden = true; }); });
    fitSoon();
  }
  function changeLink() { return ' <button class="linkbtn" id="mealChange">cambia</button>'; }
  function bindChange() { var b = $("mealChange"); if (b) b.addEventListener("click", function (e) { e.stopPropagation(); openPrefs(); }); }
  function renderMeal() {
    var s = school();
    if (!s) return showChooser();
    var label = "Municipio " + nameOf(MUNICIPI, s.m) + ", " + nameOf(CICLI, s.c);
    $("mealTag").innerHTML = esc(nameOf(CICLI, s.c)) + changeLink();
    if (!menu) {
      $("mealTitle").textContent = "Mensa";
      $("mealBody").innerHTML = mealMissing ? '<p class="state err">Menu non disponibile. Riprovo più tardi.</p>' : '<p class="state">Caricamento menu…</p>';
      return bindChange();
    }
    var mm = myMenu();
    if (!mm) {
      $("mealTitle").textContent = "Mensa";
      $("mealBody").innerHTML = '<p class="state">Il menu di ' + esc(label) + " non viene ancora scaricato.</p>" + addSchoolHint(s);
      return bindChange();
    }
    var t = todayIso(), days = mm.days || [];
    var d = days.filter(function (x) { return x.date === t; })[0] || days.filter(function (x) { return x.date > t; })[0];
    $("mealTitle").textContent = d ? "Mensa, " + dayLabel(d.date) : "Mensa";
    $("mealBody").innerHTML = d ? mealHtml(d) : '<p class="state">Menu non ancora aggiornato.</p>';
    bindChange(); fitSoon();
  }
  function loadMeal() {
    fetch("data/menu.json", { cache: "no-store" }).then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (m) { menu = m; mealMissing = false; if (!$("mealForm")) renderMeal(); })
      .catch(function () { mealMissing = !menu; if (!$("mealForm")) renderMeal(); });
  }
  onTap($("mealCard"), function () {
    var mm = myMenu(); if (!mm || !mm.days || !mm.days.length) return;
    var t = todayIso(), s = school();
    openModal("Mensa, prossimi giorni", '<p class="sheet-note">Municipio ' + esc(nameOf(MUNICIPI, s.m)) + ", " + esc(nameOf(CICLI, s.c)) + "</p>" +
      (mm.days.filter(function (d) { return d.date >= t; }).map(function (d) { return '<div class="mday"><h4>' + esc(dayLabel(d.date)) + "</h4>" + mealHtml(d) + "</div>"; }).join("") || '<p class="state">Nessun giorno disponibile.</p>'));
  });
  setInterval(function () { if (menu && !$("mealForm")) renderMeal(); }, 10 * 60000);
  renderMeal();

  // Come aggiungere una scuola all'elenco del job (da GitHub, senza toccare file)
  function addSchoolHint(s) {
    var url = (C.repoUrl || "") + "/actions/workflows/menu.yml";
    return '<p class="hint">Per scaricarlo apri <a href="' + esc(url) + '" target="_blank" rel="noopener">Menu mensa su GitHub</a>, tocca <b>Run workflow</b> e scegli municipio <b>' +
      esc(nameOf(MUNICIPI, s.m)) + "</b> e ciclo <b>" + esc(nameOf(CICLI, s.c)) + "</b>. Il menu arriva in un paio di minuti.</p>";
  }

  // ---------- Impostazioni (salvate su questo dispositivo) ----------
  function openPrefs() {
    var s = store("casa.mensa") || {};
    openModal("Impostazioni", '<form class="prefs" id="prefsForm"><h4>Mensa</h4>' +
      '<label for="pMun">Municipio</label><select id="pMun">' + options(MUNICIPI, s.m) + "</select>" +
      '<label for="pCic">Ciclo</label><select id="pCic">' + options(CICLI, s.c) + "</select>" +
      '<button class="btn primary" type="submit">Salva</button><p class="state err" id="pErr" hidden></p><div id="pHint"></div>' +
      '<p class="hint">Le impostazioni valgono solo per questo dispositivo.</p></form>');
    $("prefsForm").addEventListener("submit", function (e) {
      e.preventDefault();
      var m = $("pMun").value, c = $("pCic").value;
      if (!m || !c) { $("pErr").textContent = "Scegli municipio e ciclo."; $("pErr").hidden = false; return; }
      var ns = { m: Number(m), c: Number(c) };
      store("casa.mensa", ns); renderMeal();
      $("pHint").innerHTML = myMenu() ? '<p class="hint ok">Salvato. Il menu di questa scuola è già disponibile.</p>' : '<p class="hint ok">Salvato.</p>' + addSchoolHint(ns);
    });
    ["pMun", "pCic"].forEach(function (id) { $(id).addEventListener("change", function () { $("pErr").hidden = true; $("pHint").innerHTML = ""; }); });
  }
  $("prefsBtn").addEventListener("click", openPrefs);

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

  // ---------- Casa (solo dalla versione di casa sul tablet; #prova la simula da ovunque) ----------
  var casa = { mode: "", data: null, timer: null, open: null };
  var PROVA = location.hash === "#prova";
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toast.h); toast.h = setTimeout(function () { t.classList.remove("show"); }, 2500);
  }
  // simulazione per lavorare sul layout da fuori casa: stessi dati e stesse risposte del servizio vero
  var sim = {
    data: {
      casa: true, tapparelle: [["soggiorno1", "Soggiorno 1"], ["soggiorno2", "Soggiorno 2"], ["camera1", "Camera 1"], ["camera2", "Camera 2"], ["camera3", "Camera 3"], ["cameretta1", "Cameretta 1"], ["cameretta2", "Cameretta 2"], ["bagno", "Bagno"], ["studio", "Studio"]]
        .map(function (t, i) { return { id: t[0], nome: t[1], online: i !== 7, pos: [100, 100, 60, 100, 100, 100, 50, null, 0][i], state: "stopped" }; }),
      luci: [{ id: "soggiorno", nome: "Soggiorno", online: true, on: true, brightness: 70 }],
      scene: [{ id: "buongiorno", nome: "Buongiorno" }, { id: "buonanotte", nome: "Buonanotte" }, { id: "esco", nome: "Esco di casa" }]
    },
    post: function (path, body) {
      var d = sim.data, m = path.split("/"), kind = m[3], id = m[4];
      var setT = function (t, a, p) { if (!t.online) return; t.pos = a === "apri" ? 100 : a === "chiudi" ? 0 : a === "posizione" ? p : t.pos; };
      if (kind === "tapparelle") d.tapparelle.forEach(function (t) { if (id === "tutte" || t.id === id) setT(t, body.azione, body.pos); });
      if (kind === "luci") d.luci.forEach(function (l) { if (l.id === id) { if (body.on !== undefined) l.on = body.on; if (body.brightness !== undefined) l.brightness = body.brightness; } });
      if (kind === "scene") { var a = id === "buongiorno" ? "apri" : "chiudi"; d.tapparelle.forEach(function (t) { setT(t, a); }); if (id !== "buongiorno") d.luci.forEach(function (l) { l.on = false; }); }
      var err = (kind === "scene" || id === "tutte") ? ["Bagno: non risponde"] : [];
      return Promise.resolve(Object.assign({ ok: !err.length, errori: err }, JSON.parse(JSON.stringify(d))));
    }
  };
  function casaGet() {
    if (casa.mode === "prova") return Promise.resolve(JSON.parse(JSON.stringify(sim.data)));
    return fetch("api/casa", { cache: "no-store" }).then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(function (d) { if (!d || !d.casa) throw 0; return d; });
  }
  function casaPost(path, body) {
    if (casa.mode === "prova") return sim.post(path, body || {});
    return fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, errori: ["risposta non valida"] }; }); });
  }
  function shutterText(t) {
    if (t.online === false) return "Non risponde";
    if (t.online == null) return "…";
    if (t.state === "opening") return "In apertura…";
    if (t.state === "closing") return "In chiusura…";
    if (t.pos == null) return "Posizione sconosciuta";
    if (t.pos >= 99) return "Aperta";
    if (t.pos <= 1) return "Chiusa";
    return t.pos + "% aperta";
  }
  function lightText(l) { if (l.online === false) return "Non risponde"; return l.on ? "Accesa" + (l.brightness != null ? " · " + l.brightness + "%" : "") : "Spenta"; }
  function renderCasa() {
    var d = casa.data; if (!d) return;
    var ts = d.tapparelle || [], open = 0, closed = 0, half = 0, off = 0;
    ts.forEach(function (t) { if (t.online === false) off++; else if (t.pos >= 99) open++; else if (t.pos <= 1) closed++; else half++; });
    var summary = open + " aperte · " + half + " a metà · " + closed + " chiuse" + (off ? " · " + off + " non risponde" : "");
    $("casaBody").innerHTML =
      '<div class="scenes">' + (d.scene || []).map(function (sc) { return '<button class="scene" data-scene="' + esc(sc.id) + '">' + esc(sc.nome) + "</button>"; }).join("") + "</div>" +
      '<div class="block" style="margin-top:0"><div class="block-title"><strong>Tapparelle</strong><span>' + summary + "</span></div>" +
      '<div class="pair"><button data-all="apri">Apri tutte</button><button data-all="chiudi">Chiudi tutte</button></div>' +
      '<div class="tiles">' + ts.map(function (t) {
        var mv = t.state === "opening" || t.state === "closing";
        return '<button class="tile' + (t.online === false ? " off" : "") + (mv ? " moving" : "") + '" data-tap="' + esc(t.id) + '"><span class="nm">' + esc(t.nome) + '</span><span class="st">' + shutterText(t) + '</span><span class="bar"><i style="width:' + (t.pos == null ? 0 : t.pos) + '%"></i></span></button>';
      }).join("") + "</div></div>" +
      ((d.luci || []).length ? '<div class="block"><div class="block-title"><strong>Luci</strong><span>' + d.luci.filter(function (l) { return l.on; }).length + " accese su " + d.luci.length + "</span></div>" +
        '<div class="tiles">' + d.luci.map(function (l) {
          return '<button class="tile' + (l.on ? " on" : "") + (l.online === false ? " off" : "") + '" data-light="' + esc(l.id) + '"><span class="nm">' + esc(l.nome) + '</span><span class="st">' + lightText(l) + "</span></button>";
        }).join("") + "</div></div>" : "");
    if (casa.open) casa.open();
    fitSoon();
  }
  function after(res, ok) {
    if (res && res.tapparelle) { casa.data = res; renderCasa(); }
    if (res && res.errori && res.errori.length) toast("Fatto, tranne: " + res.errori.join(", "));
    else if (ok) toast(ok);
    setTimeout(pollCasa, 1500);
  }
  function shutterSheet(id) {
    var t = (casa.data.tapparelle || []).filter(function (x) { return x.id === id; })[0]; if (!t) return;
    openModal(t.nome, '<p class="sheet-note" id="shSt">' + shutterText(t) + '</p><div class="ctl"><button class="primary" data-a="apri">Apri</button><button data-a="ferma">Ferma</button><button class="primary" data-a="chiudi">Chiudi</button></div>' +
      '<div class="ctl"><button data-p="25">25%</button><button data-p="50">50%</button><button data-p="75">75%</button></div>');
    casa.open = function () { var x = (casa.data.tapparelle || []).filter(function (y) { return y.id === id; })[0]; if (x && $("shSt")) $("shSt").textContent = shutterText(x); };
    [].forEach.call(document.querySelectorAll("#modalBody [data-a], #modalBody [data-p]"), function (b) {
      b.addEventListener("click", function () {
        var body = b.dataset.a ? { azione: b.dataset.a } : { azione: "posizione", pos: Number(b.dataset.p) };
        casaPost("api/casa/tapparelle/" + encodeURIComponent(id), body).then(function (r) { after(r); });
      });
    });
  }
  function lightSheet(id) {
    var l = (casa.data.luci || []).filter(function (x) { return x.id === id; })[0]; if (!l) return;
    openModal("Luce " + l.nome, '<p class="sheet-note" id="lSt">' + lightText(l) + '</p><div class="ctl" style="grid-template-columns:1fr 1fr"><button class="primary" data-on="1">Accendi</button><button data-on="0">Spegni</button></div>' +
      '<label for="lBr" class="sheet-note">Intensità</label><input class="range" id="lBr" type="range" min="1" max="100" step="1" value="' + (l.brightness || 50) + '">');
    casa.open = function () { var x = (casa.data.luci || []).filter(function (y) { return y.id === id; })[0]; if (x && $("lSt")) $("lSt").textContent = lightText(x); };
    [].forEach.call(document.querySelectorAll("#modalBody [data-on]"), function (b) {
      b.addEventListener("click", function () { casaPost("api/casa/luci/" + encodeURIComponent(id), { on: b.dataset.on === "1" }).then(function (r) { after(r); }); });
    });
    $("lBr").addEventListener("change", function () { casaPost("api/casa/luci/" + encodeURIComponent(id), { on: true, brightness: Number(this.value) }).then(function (r) { after(r); }); });
  }
  $("casaBody").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b || !casa.data) return;
    if (b.dataset.scene) { b.disabled = true; casaPost("api/casa/scene/" + encodeURIComponent(b.dataset.scene)).then(function (r) { b.disabled = false; after(r, b.textContent + ": fatto"); }); }
    else if (b.dataset.all) casaPost("api/casa/tapparelle/tutte", { azione: b.dataset.all }).then(function (r) { after(r, b.dataset.all === "apri" ? "Apro tutte le tapparelle" : "Chiudo tutte le tapparelle"); });
    else if (b.dataset.tap) shutterSheet(b.dataset.tap);
    else if (b.dataset.light) lightSheet(b.dataset.light);
  });
  $("modalClose").addEventListener("click", function () { casa.open = null; });
  function pollCasa() {
    clearTimeout(casa.timer);
    casaGet().then(function (d) { casa.data = d; renderCasa(); $("casaTag").innerHTML = casa.mode === "prova" ? '<span class="sim">Simulazione</span>' : "aggiornato " + hhmm(); })
      .catch(function () { $("casaTag").textContent = "non aggiornato"; })
      .then(function () { casa.timer = setTimeout(pollCasa, document.hidden ? 30000 : 5000); });
  }
  function startCasa() {
    var show = function (mode) {
      casa.mode = mode;
      document.body.classList.add("casa"); $("colCasa").hidden = false; $("casaOnline").hidden = true;
      pollCasa();
    };
    if (PROVA) return show("prova");
    casaGet().then(function (d) { casa.data = d; show("casa"); }, function () {
      casa.mode = "online";
      if (C.homeUrl) { $("homeLink").href = C.homeUrl + "/" + (KIOSK ? "?kiosk" : ""); $("casaOnline").hidden = false; fitSoon(); }
    });
  }

  // ---------- Avvio ----------
  loadWeather(); loadNews(); loadMeal(); initGoogle(); startCasa();
  setInterval(loadWeather, 15 * 60000);
  setInterval(loadNews, 10 * 60000);
  setInterval(loadMeal, 60 * 60000);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(function () {});

  // ---------- Link esterni sul tablet ----------
  // Fully Kiosk gratuito blocca le finestre nuove: sul tablet i link (RaiNews24, ANSA) si aprono nella stessa
  // finestra, e con il tasto Indietro si torna alla pagina.
  if (KIOSK) document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[target="_blank"]');
    if (!a || !a.href || a.href.charAt(a.href.length - 1) === "#") return;
    e.preventDefault(); location.href = a.href;
  }, true);

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
