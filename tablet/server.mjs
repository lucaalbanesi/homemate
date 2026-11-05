// HomeMate, versione di casa: gira sul tablet (Termux) e risponde a tutta la rete di casa sulla porta 8080.
// - serve la stessa pagina del sito (cartella app/), in più la sezione Casa
// - parla con le Shelly della rete di casa (config/casa.json)
// - prende notizie e menu dal sito online, così la pagina di casa li ha come quella online
// - ogni notte alle 4 scarica gli aggiornamenti da GitHub e, se ce ne sono, si riavvia
// Non aprire mai la porta 8080 nel router: la versione di casa deve restare raggiungibile solo dal Wi-Fi.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as shelly from "./shelly.mjs";
import { Tado } from "./tado.mjs";
import { Google, clientIdFrom } from "./google.mjs";
import { Dreame } from "./dreame.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(ROOT, "app");
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "0.0.0.0";
const PAGES = (process.env.PAGES_URL || "https://lucaalbanesi.github.io/homemate/").replace(/\/?$/, "/");
const CONFIG = process.env.CASA_CONFIG || path.join(ROOT, "config", "casa.json");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png" };

const log = (...a) => console.log(new Date().toLocaleString("it-IT", { timeZone: "Europe/Rome" }), ...a);
let cfg = { tapparelle: [], luci: [], scene: [] };
let tado = new Tado({ log, file: process.env.TADO_FILE || undefined, api: process.env.TADO_API || undefined, login: process.env.TADO_LOGIN || undefined, hops: process.env.TADO_HOPS || undefined });
export function useTado(t) { tado = t; }
let google = new Google({ log, file: process.env.GOOGLE_FILE || undefined, redirect: `http://localhost:${PORT}/google/fatto`,
  auth: process.env.GOOGLE_AUTH || undefined, token: process.env.GOOGLE_TOKEN || undefined, api: process.env.GOOGLE_API || undefined });
export function useGoogle(g) { google = g; }
let dreame = new Dreame({ log: (...a) => log(...a), file: process.env.DREAME_FILE || undefined });
export function useDreame(d) { dreame = d; }
export async function loadGoogle() {
  google.clientId = process.env.GOOGLE_CLIENT_ID || await clientIdFrom(path.join(APP, "config.js"));
  const m = (await fs.readFile(path.join(APP, "config.js"), "utf8").catch(() => "")).match(/listaSpesa:\s*["']([^"']+)["']/);
  if (m) google.lista = m[1];
  await google.load();
}
const stato = new Map(); // id -> ultimo stato letto

export async function loadConfig(file = CONFIG) {
  cfg = JSON.parse(await fs.readFile(file, "utf8"));
  cfg.tapparelle = cfg.tapparelle || []; cfg.luci = cfg.luci || []; cfg.scene = cfg.scene || []; cfg.riquadri = cfg.riquadri || [];
  // ogni riga di un riquadro è un gruppo di tapparelle comandate insieme
  cfg.gruppi = [...(cfg.gruppi || []), ...cfg.riquadri.flatMap((r) => r.righe || [])];
  return cfg;
}

// ---- Stato dei dispositivi, aggiornato in sottofondo ----
async function readOne(kind, d) {
  try {
    const s = kind === "tapparella" ? await shelly.coverStatus(d.ip) : await shelly.lightStatus(d.ip);
    stato.set(d.id, { ...s, letto: Date.now() });
  } catch (e) {
    const prev = stato.get(d.id) || {};
    stato.set(d.id, { ...prev, online: false, errore: String(e.message || e), letto: Date.now() });
  }
}
export async function refresh() {
  await Promise.all([...cfg.tapparelle.map((d) => readOne("tapparella", d)), ...cfg.luci.map((d) => readOne("luce", d))]);
}
let refreshing = null;
function refreshSoon() { if (!refreshing) refreshing = refresh().finally(() => { refreshing = null; }); return refreshing; }
// dopo un comando le tapparelle si muovono per qualche secondo: rileggo più volte
function followUp() { [800, 3000, 8000, 20000].forEach((ms) => setTimeout(refreshSoon, ms).unref()); }

export function snapshot() {
  const pick = (d) => ({ id: d.id, nome: d.nome, stanza: d.stanza, ...(stato.get(d.id) || { online: null }) });
  return {
    casa: true,
    aggiornato: new Date().toISOString(),
    tapparelle: cfg.tapparelle.map(pick),
    luci: cfg.luci.map(pick),
    riquadri: cfg.riquadri,
    scene: cfg.scene.map((s) => ({ id: s.id, nome: s.nome })),
    tado: tado.snapshot(),
    robot: dreame.snapshot(),
  };
}

// ---- Comandi ----
const motivo = (e) => /fetch failed|timeout|aborted|ECONNREFUSED|EHOSTUNREACH/i.test(String(e && (e.message || e)) + String(e && e.cause && e.cause.code)) ? "non risponde" : String(e.message || e);
export async function comandaTapparelle(ids, azione, pos) {
  const list = ids === "tutte" ? cfg.tapparelle : cfg.tapparelle.filter((d) => ids.includes(d.id));
  if (!list.length) throw Object.assign(new Error("tapparella non trovata"), { status: 404 });
  const esiti = await Promise.all(list.map((d) => shelly.coverCommand(d.ip, azione, pos).then(() => null, (e) => `${d.nome}: ${motivo(e)}`)));
  followUp();
  return esiti.filter(Boolean);
}
export async function comandaLuce(id, opt) {
  const d = cfg.luci.find((x) => x.id === id);
  if (!d) throw Object.assign(new Error("luce non trovata"), { status: 404 });
  try { await shelly.lightCommand(d.ip, opt); } catch (e) { return [`${d.nome}: ${motivo(e)}`]; }
  followUp();
  return [];
}
export async function scena(id) {
  const s = cfg.scene.find((x) => x.id === id);
  if (!s) throw Object.assign(new Error("scena non trovata"), { status: 404 });
  const errori = [];
  if (s.tapparelle) errori.push(...await comandaTapparelle("tutte", s.tapparelle, s.posizione));
  if (s.luci) {
    for (const d of cfg.luci) {
      try { await shelly.lightCommand(d.ip, { on: s.luci === "accendi" }); } catch (e) { errori.push(`${d.nome}: ${motivo(e)}`); }
    }
    followUp();
  }
  log(`Scena ${s.nome}${errori.length ? " con errori: " + errori.join("; ") : ""}`);
  return errori;
}

// ---- Notizie e menu dal sito online ----
const proxyCache = new Map();
async function fromPages(rel) {
  const hit = proxyCache.get(rel);
  if (hit && Date.now() - hit.at < 5 * 60000) return hit;
  try {
    const r = await fetch(PAGES + rel + "?t=" + Date.now(), { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error("HTTP " + r.status);
    const v = { at: Date.now(), body: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type") || "application/json" };
    proxyCache.set(rel, v);
    return v;
  } catch (e) {
    if (hit) return hit;
    throw e;
  }
}

// ---- Server ----
function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > 10000) { reject(new Error("troppo grande")); req.destroy(); } });
    req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(Object.assign(new Error("dati non validi"), { status: 400 })); } });
  });
}

function readForm(req) {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => { b += c; if (b.length > 10000) { reject(new Error("troppo grande")); req.destroy(); } });
    req.on("end", () => resolve(Object.fromEntries(new URLSearchParams(b))));
  });
}
const escHtml = (v) => String(v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function pagina(res, corpo, status = 200) {
  send(res, status, `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Collega Google</title>
<style>body{font:17px/1.5 system-ui,sans-serif;background:#111418;color:#e8eaed;margin:0;padding:24px;max-width:640px}h1{font-size:22px}a,button{font:inherit}
.btn{display:inline-block;background:#a8c7fa;color:#0b1a33;border:0;border-radius:12px;padding:12px 18px;text-decoration:none;font-weight:600;margin:6px 0}
.sec{background:#22262c;color:#e8eaed}input{font:inherit;width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1px solid #444;background:#0b0d10;color:#e8eaed;margin:6px 0}
.ok{color:#8fd19e}.err{color:#f6ae6b}.muted{color:#9aa0a6;font-size:15px}code{background:#22262c;padding:1px 5px;border-radius:5px}</style></head><body>${corpo}</body></html>`, "text/html; charset=utf-8");
}
function paginaGoogle(res, msg = "") {
  const st = google.stato();
  const head = '<h1>Lista della spesa: collega Google</h1>' + (msg ? `<p class="${msg.startsWith("!") ? "err" : "ok"}">${escHtml(msg.replace(/^!/, ""))}</p>` : "");
  if (!st.clientId) return pagina(res, head + '<p class="err">Manca il client ID in <code>app/config.js</code> (googleClientId). Aggiornalo su GitHub, poi sul tablet <code>cd ~/homemate && git pull</code> e riavvia.</p>');
  if (!st.secret) return pagina(res, head + `<p>Incolla il <b>client secret</b> del client OAuth creato su Google Cloud. Resta solo su questo tablet.</p>
<form method="post" action="/google/chiave"><input name="secret" autocomplete="off" placeholder="GOCSPX-..." required><button class="btn">Salva</button></form>`);
  if (st.collegato) return pagina(res, head + `<p class="ok">Il tablet è collegato a Google Tasks. Lista usata: <b>${escHtml(st.lista)}</b>.</p>
<p><a class="btn" href="/">Torna a Casa mia</a></p><form method="post" action="/google/scollega"><button class="btn sec">Scollega</button></form>`);
  return pagina(res, head + `${st.errore ? `<p class="err">${escHtml(st.errore)}</p>` : ""}<p>Apri questa pagina con <b>Chrome sul tablet</b> all'indirizzo <code>http://localhost:${PORT}/google</code> (Google non accetta l'accesso da Fully Kiosk), poi:</p>
<p><a class="btn" href="/google/vai">Collega Google</a></p>
<p class="muted">Se hai aperto il collegamento da un altro dispositivo, alla fine il browser mostrerà «pagina non raggiungibile» su localhost: copia l'indirizzo completo dalla barra e incollalo qui.</p>
<form method="post" action="/google/incolla"><input name="url" placeholder="http://localhost:${PORT}/google/fatto?..." autocomplete="off"><button class="btn sec">Completa il collegamento</button></form>
<form method="post" action="/google/scollega"><button class="btn sec">Cambia client secret</button></form>`);
}
const REGIONI = [["eu", "Europa"], ["us", "Stati Uniti"], ["cn", "Cina"], ["ru", "Russia"], ["sg", "Asia (Singapore)"], ["in", "India"]];
function paginaDreame(res, msg = "", robots = null) {
  const head = '<h1>Robot: collega Dreamehome</h1>' + (msg ? `<p class="${msg.startsWith("!") ? "err" : "ok"}">${escHtml(msg.replace(/^!/, ""))}</p>` : "");
  const snap = dreame.snapshot();
  if (robots && robots.length > 1) return pagina(res, head + '<p>Nell\'account ci sono più robot: scegli quello da mostrare.</p>' +
    robots.map((r) => `<form method="post" action="/dreame/scegli"><input type="hidden" name="did" value="${escHtml(r.did)}"><button class="btn sec">${escHtml(r.nome)}</button></form>`).join(""));
  if (dreame.collegato) return pagina(res, head + `<p class="ok">Collegato a <b>${escHtml(snap.nome)}</b>${snap.testo ? " · " + escHtml(snap.testo) : ""}${snap.batteria != null ? " · batteria " + snap.batteria + "%" : ""}.</p>` +
    (snap.errore ? `<p class="err">${escHtml(snap.errore)}</p>` : "") + '<p><a class="btn" href="/">Torna a Casa mia</a></p><form method="post" action="/dreame/scollega"><button class="btn sec">Scollega</button></form>');
  return pagina(res, head + (snap.errore ? `<p class="err">${escHtml(snap.errore)}</p>` : "") +
    `<p>Entra con l'account dell'app <b>Dreamehome</b>. La password serve solo adesso e non viene salvata: sul tablet resta un accesso che si rinnova da solo.</p>
<form method="post" action="/dreame/accedi"><input name="email" type="email" autocomplete="username" placeholder="Email Dreamehome" required value="${escHtml((dreame.saved && dreame.saved.username) || "")}">
<input name="password" type="password" autocomplete="current-password" placeholder="Password" required>
<select name="regione" style="font:inherit;width:100%;padding:10px;border-radius:10px;background:#0b0d10;color:#e8eaed;border:1px solid #444;margin:6px 0">${REGIONI.map(([v, n]) => `<option value="${v}">${n}</option>`).join("")}</select>
<button class="btn">Collega</button></form>
<p class="muted">Se hai creato l'account Dreamehome con Google o Apple, nell'app imposta prima una password (Profilo → Impostazioni account).</p>`);
}
async function rottaDreame(req, res, pathname) {
  try {
    if (pathname === "/dreame" && req.method === "GET") return paginaDreame(res);
    if (pathname === "/dreame/accedi" && req.method === "POST") {
      const f = await readForm(req);
      const robots = await dreame.accedi(f.email, f.password, f.regione);
      return robots.length > 1 ? paginaDreame(res, "", robots) : paginaDreame(res, "Collegato!");
    }
    if (pathname === "/dreame/scegli" && req.method === "POST") { await dreame.scegli((await readForm(req)).did); return paginaDreame(res, "Collegato!"); }
    if (pathname === "/dreame/scollega" && req.method === "POST") { await dreame.scollega(); return paginaDreame(res, "Scollegato."); }
    return send(res, 404, "non trovato", "text/plain");
  } catch (e) { log("Dreame:", e.message); return paginaDreame(res, "!" + (e.message || e)); }
}

async function rottaGoogle(req, res, pathname, url) {
  try {
    if (pathname === "/google" && req.method === "GET") return paginaGoogle(res);
    if (pathname === "/google/chiave" && req.method === "POST") { await google.setSecret((await readForm(req)).secret); return paginaGoogle(res, "Client secret salvato."); }
    if (pathname === "/google/vai" && req.method === "GET") { res.writeHead(302, { location: google.linkUrl(), "cache-control": "no-store" }); return res.end(); }
    if (pathname === "/google/fatto" && req.method === "GET") { await google.finish(Object.fromEntries(url.searchParams)); return paginaGoogle(res, "Collegato! La lista della spesa ora compare su Casa mia."); }
    if (pathname === "/google/incolla" && req.method === "POST") { await google.finish((await readForm(req)).url || ""); return paginaGoogle(res, "Collegato! La lista della spesa ora compare su Casa mia."); }
    if (pathname === "/google/scollega" && req.method === "POST") {
      if (google.collegato) await google.scollega(); else { google.saved = {}; await google.save(); }
      return paginaGoogle(res, google.pronto ? "Scollegato." : "Fatto. Incolla il nuovo client secret.");
    }
    return send(res, 404, "non trovato", "text/plain");
  } catch (e) { log("Google:", e.message); return paginaGoogle(res, "!" + (e.message || e)); }
}

export function handler() {
  return async (req, res) => {
    const url = new URL(req.url, "http://casa"), { pathname } = url;
    if (pathname === "/google" || pathname.startsWith("/google/")) return rottaGoogle(req, res, pathname, url);
    if (pathname === "/dreame" || pathname.startsWith("/dreame/")) return rottaDreame(req, res, pathname);
    try {
      const rb = pathname.match(/^\/api\/casa\/robot\/(avvia|pausa|base)$/);
      if (rb && req.method === "POST") {
        let errori = [];
        try { await dreame.comando(rb[1]); } catch (e) { errori = ["Robot: " + (e.message || e)]; }
        return send(res, errori.length ? 207 : 200, { ok: !errori.length, errori, ...snapshot() });
      }
      if (pathname === "/api/casa/spesa" && req.method === "GET") return send(res, 200, await google.voci());
      const sp = pathname.match(/^\/api\/casa\/spesa(?:\/([\w-]+)\/fatto)?$/);
      if (sp && req.method === "POST") {
        const body = await readBody(req);
        if (sp[1]) await google.fatto(sp[1]);
        else if (body.crea) await google.creaLista();
        else await google.aggiungi(body.titolo);
        log(`Spesa: ${sp[1] ? "presa una voce" : body.crea ? "lista creata" : "aggiunto «" + String(body.titolo).trim() + "»"}`);
        return send(res, 200, { ok: true, ...await google.voci() });
      }
      if (pathname === "/api/casa" && req.method === "GET") return send(res, 200, snapshot());
      if (pathname === "/api/casa/tado/diagnosi" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
        return res.end(JSON.stringify(await tado.diagnosi(), null, 2));
      }
      const t = pathname.match(/^\/api\/casa\/tado\/(collega|tutte|stanze\/[0-9]+)$/);
      if (t && req.method === "POST") {
        const body = await readBody(req);
        let errori = [];
        if (t[1] === "collega") await tado.startLink();
        else if (t[1] === "tutte") errori = await tado.tutte(body.azione);
        else await tado.stanza(t[1].split("/")[1], body);
        log(`Tado ${t[1]} ${JSON.stringify(body)}${errori.length ? " con errori: " + errori.join("; ") : ""}`);
        return send(res, errori.length ? 207 : 200, { ok: !errori.length, errori, ...snapshot() });
      }
      const m = pathname.match(/^\/api\/casa\/(tapparelle|gruppi|luci|scene)\/([a-z0-9_-]+)$/i);
      if (m && req.method === "POST") {
        const body = await readBody(req);
        let errori;
        if (m[1] === "tapparelle") errori = await comandaTapparelle(m[2] === "tutte" ? "tutte" : [m[2]], body.azione, body.pos);
        else if (m[1] === "gruppi") {
          const g = cfg.gruppi.find((x) => x.id === m[2]);
          if (!g) throw Object.assign(new Error("gruppo non trovato"), { status: 404 });
          errori = await comandaTapparelle(g.tapparelle, body.azione, body.pos);
        }
        else if (m[1] === "luci") errori = await comandaLuce(m[2], body);
        else errori = await scena(m[2]);
        await refreshSoon(); // la risposta porta già lo stato nuovo (es. "in chiusura")
        return send(res, errori.length ? 207 : 200, { ok: !errori.length, errori, ...snapshot() });
      }
      if (pathname.startsWith("/api/")) return send(res, 404, { error: "non trovato" });
      if (/^\/data\/[a-z0-9_-]+\.json$/i.test(pathname)) {
        const v = await fromPages(pathname.slice(1));
        return send(res, 200, v.body, v.type);
      }
      const rel = pathname === "/" ? "/index.html" : pathname;
      const file = path.normalize(path.join(APP, rel));
      if (!file.startsWith(APP + path.sep)) return send(res, 403, "vietato", "text/plain");
      const body = await fs.readFile(file);
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
      res.end(body);
    } catch (e) {
      if (e.code === "ENOENT" || e.code === "EISDIR") return send(res, 404, "non trovato", "text/plain");
      send(res, e.status || 502, { error: String(e.message || e), ...(e.scollegato ? { collegata: false } : {}) });
    }
  };
}

// ---- Aggiornamento notturno da GitHub ----
function nightlyUpdate() {
  let lastDay = "";
  setInterval(() => {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" }));
    const day = now.toDateString();
    if (now.getHours() !== 4 || day === lastDay) return;
    lastDay = day;
    execFile("git", ["-C", ROOT, "pull", "--ff-only", "-q"], (err, out, errOut) => {
      if (err) return log("Aggiornamento non riuscito:", (errOut || err.message).trim());
      execFile("git", ["-C", ROOT, "log", "-1", "--format=%h %s"], (_, last) => {
        if (last && last.trim() !== startedAt) { log("Aggiornato a", last.trim(), "- riavvio"); process.exit(0); }
      });
    });
  }, 60000);
}
let startedAt = "";

if (import.meta.url === `file://${process.argv[1]}`) {
  await loadConfig();
  await tado.load(); await tado.refresh();
  await loadGoogle();
  await dreame.load(); dreame.refresh();
  // stato del robot: ogni 30 secondi mentre lavora, ogni 2 minuti quando è fermo
  setInterval(() => { const st = dreame.state; if (dreame.collegato && (!st || st.pulisce || st.rientra || Date.now() - dreame.updated > 115000)) dreame.refresh(); }, 30000);
  setInterval(() => tado.refresh(), 60000);
  execFile("git", ["-C", ROOT, "log", "-1", "--format=%h %s"], (_, out) => { startedAt = (out || "").trim(); log("Versione", startedAt || "sconosciuta"); });
  await refresh();
  setInterval(refreshSoon, 5000);
  nightlyUpdate();
  http.createServer(handler()).listen(PORT, HOST, () => {
    log(`HomeMate di casa su http://localhost:${PORT} (${cfg.tapparelle.length} tapparelle, ${cfg.luci.length} luci)`);
    for (const d of [...cfg.tapparelle, ...cfg.luci]) { const s = stato.get(d.id) || {}; log(`  ${d.nome.padEnd(12)} ${d.ip.padEnd(15)} ${s.online ? "ok" : "non risponde"}`); }
  });
}
