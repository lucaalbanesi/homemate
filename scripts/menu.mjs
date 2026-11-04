// Menu della mensa (Roma Capitale, MESIS). Legge il menu dei prossimi giorni di scuola e lo salva in data/menu.json.
// Le scuole da seguire (municipio e ciclo) sono in config/mensa.json: si scaricano solo quelle.
// Uso personale e leggero: una volta a settimana (il sabato), una richiesta per giorno di scuola (5 per scuola), con una pausa.
import fs from "node:fs/promises";

const BASE = "https://www.comune.roma.it/servizi/mesis-portal-reports-war";
const UA = "homemate/1.0 (uso personale, una lettura al giorno)";

export const CICLI = { 1: "Nido medi", 2: "Nido grandi", 3: "Ponte", 4: "Infanzia", 5: "Primaria", 6: "Secondaria di I grado" };

// Giorni di scuola da scaricare: dal lunedì al venerdì della settimana in corso (da oggi in poi);
// di sabato e domenica quelli della settimana dopo. Il menu non cambia: basta una lettura a settimana.
export function weekDays(from = new Date()) {
  const d = new Date(from.toLocaleString("en-US", { timeZone: "Europe/Rome" }));
  const wd = d.getDay(); // 0 domenica, 6 sabato
  const start = wd === 6 ? 2 : wd === 0 ? 1 : 0;
  const out = [];
  for (let i = start; i < start + 7 && out.length < 5; i++) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    if (x.getDay() === 0 || x.getDay() === 6) { if (out.length) break; continue; }
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`);
  }
  return out;
}

const clean = (s) => String(s || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").trim();

// Risposta del Comune: elenco di { tipoPasto, descPasto }. Il pranzo arriva in più voci.
export function shapeDay(date, list) {
  const day = { date, spuntino: "", pranzo: [], merenda: "", note: "" };
  for (const v of Array.isArray(list) ? list : []) {
    const tipo = clean(v && v.tipoPasto).toLowerCase(), desc = clean(v && v.descPasto);
    if (!tipo || !desc) continue;
    if (tipo === "spuntino") day.spuntino = desc;
    else if (tipo === "pranzo") day.pranzo.push(...desc.split("\n").map((s) => s.trim()).filter(Boolean));
    else if (tipo === "merenda") day.merenda = desc;
    else if (tipo === "note") day.note = desc;
  }
  day.disponibile = Boolean(day.spuntino || day.pranzo.length || day.merenda);
  return day;
}

// Il sito è in windows-1252: se il testo non è UTF-8 valido lo rileggo in quella codifica
export function decode(buf) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch { return new TextDecoder("windows-1252").decode(buf); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchMenu({ municipio, ciclo, days, base = BASE, pause = 1500 }) {
  // prima apro la pagina, come fa il browser, per avere il cookie di sessione
  const home = await fetch(`${base}/loadMenuRistorazione.do`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20000) });
  const cookie = (home.headers.getSetCookie ? home.headers.getSetCookie() : [home.headers.get("set-cookie") || ""])
    .map((c) => c.split(";")[0]).filter(Boolean).join("; ");
  const out = [];
  for (const iso of days) {
    const [y, m, d] = iso.split("-");
    const q = new URLSearchParams({ municipio: String(municipio), cicloScolastico: String(ciclo), giornoSelezionato: `${d}/${m}/${y}`, v: String(Date.now()) });
    const r = await fetch(`${base}/elencoMenuGiorno.do?${q}`, {
      headers: { "user-agent": UA, accept: "application/json", "x-requested-with": "XMLHttpRequest", referer: `${base}/loadMenuRistorazione.do`, ...(cookie ? { cookie } : {}) },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`Il Comune ha risposto ${r.status} per il ${iso}`);
    const text = decode(new Uint8Array(await r.arrayBuffer()));
    let list;
    try { list = JSON.parse(text); } catch { throw new Error(`Risposta non leggibile per il ${iso}: ${text.slice(0, 120)}`); }
    out.push(shapeDay(iso, list));
    if (pause) await sleep(pause);
  }
  return out;
}

// Codici MESIS dei municipi (valore della tendina sul sito del Comune) e nome
export const MUNICIPI = { 1: "I", 2: "II", 4: "III", 5: "IV", 6: "V", 8: "VI", 9: "VII", 11: "VIII", 12: "IX", 13: "X", 15: "XI", 16: "XII", 18: "XIII", 19: "XIV", 20: "XV" };
export const comboKey = (municipio, ciclo) => `${municipio}-${ciclo}`;

if (import.meta.url === `file://${process.argv[1]}`) {
  const outFile = process.argv[2] || "data/menu.json";
  const cfg = JSON.parse(await fs.readFile(process.argv[3] || "config/mensa.json", "utf8"));
  const combos = (cfg.combinazioni || []).filter((c) => MUNICIPI[c.municipio] && CICLI[c.ciclo]);
  if (!combos.length) {
    console.log("::notice title=Menu mensa::Nessuna scuola in config/mensa.json: niente da scaricare.");
    process.exit(0);
  }
  const days = weekDays();
  const menus = {};
  for (const c of combos) {
    try {
      menus[comboKey(c.municipio, c.ciclo)] = { municipio: MUNICIPI[c.municipio], ciclo: CICLI[c.ciclo], days: await fetchMenu({ municipio: c.municipio, ciclo: c.ciclo, days }) };
    } catch (e) {
      console.log(`::warning title=Menu mensa::Municipio ${MUNICIPI[c.municipio]}, ${CICLI[c.ciclo]}: ${e.message}`);
    }
  }
  if (!Object.keys(menus).length) throw new Error("Nessun menu scaricato");
  await fs.mkdir(outFile.replace(/\/[^/]+$/, "") || ".", { recursive: true });
  await fs.writeFile(outFile, JSON.stringify({ updated: new Date().toISOString(), menus }, null, 1));
  for (const [k, m] of Object.entries(menus)) console.log(`Menu ${k} (${m.municipio}, ${m.ciclo}): ${m.days.filter((d) => d.disponibile).length} giorni su ${m.days.length}`);
}
