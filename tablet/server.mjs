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

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(ROOT, "app");
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || "0.0.0.0";
const PAGES = (process.env.PAGES_URL || "https://lucaalbanesi.github.io/homemate/").replace(/\/?$/, "/");
const CONFIG = process.env.CASA_CONFIG || path.join(ROOT, "config", "casa.json");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png" };

const log = (...a) => console.log(new Date().toLocaleString("it-IT", { timeZone: "Europe/Rome" }), ...a);
let cfg = { tapparelle: [], luci: [], scene: [] };
let tado = new Tado({ log, file: process.env.TADO_FILE || undefined, api: process.env.TADO_API || undefined, login: process.env.TADO_LOGIN || undefined });
export function useTado(t) { tado = t; }
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

export function handler() {
  return async (req, res) => {
    const { pathname } = new URL(req.url, "http://casa");
    try {
      if (pathname === "/api/casa" && req.method === "GET") return send(res, 200, snapshot());
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
      send(res, e.status || 502, { error: String(e.message || e) });
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
