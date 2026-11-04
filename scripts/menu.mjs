// Menu della mensa (Roma Capitale, MESIS). Legge il menu dei prossimi giorni di scuola e lo salva in data/menu.json.
// Municipio e ciclo arrivano dalle impostazioni private del repository (Secrets), non stanno mai nel codice.
// Uso personale e leggero: una volta al giorno, una richiesta per giorno di scuola (al massimo 6), con una pausa tra l'una e l'altra.
import fs from "node:fs/promises";

const BASE = "https://www.comune.roma.it/servizi/mesis-portal-reports-war";
const UA = "homemate/1.0 (uso personale, una lettura al giorno)";

export const CICLI = { 1: "Nido medi", 2: "Nido grandi", 3: "Ponte", 4: "Infanzia", 5: "Primaria", 6: "Secondaria di I grado" };

// Prossimi giorni di scuola (lun-ven) a partire da oggi, in ora di Roma
export function schoolDays(from = new Date(), n = 6) {
  const out = [];
  const d = new Date(from.toLocaleString("en-US", { timeZone: "Europe/Rome" }));
  for (let i = 0; out.length < n && i < 14; i++) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
    const wd = x.getDay();
    if (wd === 0 || wd === 6) continue;
    const iso = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    out.push(iso);
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const outFile = process.argv[2] || "data/menu.json";
  const municipio = process.env.MENSA_MUNICIPIO, ciclo = process.env.MENSA_CICLO;
  if (!municipio || !ciclo) {
    console.log("::notice title=Menu mensa::Imposta i secret MENSA_MUNICIPIO e MENSA_CICLO per scaricare il menu.");
    process.exit(0);
  }
  const days = await fetchMenu({ municipio, ciclo, days: schoolDays() });
  await fs.mkdir(outFile.replace(/\/[^/]+$/, "") || ".", { recursive: true });
  // nel file pubblico niente municipio: solo il ciclo (es. "Primaria") e i piatti
  await fs.writeFile(outFile, JSON.stringify({ updated: new Date().toISOString(), ciclo: CICLI[ciclo] || "", days }, null, 1));
  console.log(`Menu salvato: ${days.filter((d) => d.disponibile).length} giorni con menu su ${days.length}`);
}
