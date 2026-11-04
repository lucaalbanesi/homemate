// Notizie per Casa mia: legge alcuni feed ANSA, sceglie le 10 più importanti e le salva in un file JSON.
// Lo lancia il workflow di pubblicazione ogni 30 minuti.
//
// Criterio di importanza (punti, la notizia con più punti vince):
//  +3  è tra le "Ultima ora" di ANSA (la redazione la considera in primo piano)
//  +3  riguarda Roma o il Lazio
//  +2  ha un impatto pratico sulla vita di tutti i giorni (scioperi, trasporti, meteo, bollette, tasse, mutui, scuola, sanità...)
//  +1  compare in più feed ANSA insieme
//  -1  ogni 3 ore di età (le notizie vecchie scendono)
// A parità di punti vince la più recente. Le notizie più vecchie di 24 ore non entrano.
import fs from "node:fs/promises";

export const FEEDS = [
  { key: "top", url: "https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml" },
  { key: "lazio", url: "https://www.ansa.it/lazio/notizie/lazio_rss.xml" },
  { key: "cronaca", url: "https://www.ansa.it/sito/notizie/cronaca/cronaca_rss.xml" },
  { key: "economia", url: "https://www.ansa.it/sito/notizie/economia/economia_rss.xml" },
  { key: "politica", url: "https://www.ansa.it/sito/notizie/politica/politica_rss.xml" },
  { key: "mondo", url: "https://www.ansa.it/sito/notizie/mondo/mondo_rss.xml" },
];

const ROMA = /\b(roma|romano|romana|romani|capitale|lazio|laziale|campidoglio|atac|fiumicino|ciampino|municipio|gra|tiburtina|ostia)\b/i;
const PRATICO = /\b(sciopero|scioperi|trasporti|metro|metropolitana|treni|autobus|traffico|maltempo|allerta|nubifragio|caldo|ondata|bollett[ae]|luce|gas|benzina|carburant[ei]|tasse|irpef|imu|pension[ei]|mutu[oi]|tass[io]|bce|inflazione|prezzi|stipendi|bonus|scuola|scuole|sanità|ospedal[ei]|pronto soccorso|vaccin[oi])\b/i;

export function parseRss(xml) {
  const blocks = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return blocks.map((b) => {
    const d = field(b, "pubDate");
    const t = d ? new Date(d) : null;
    return {
      image: imageOf(b),
      title: field(b, "title"),
      text: field(b, "description").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      link: field(b, "link"),
      time: t && !isNaN(t) ? t.toISOString() : null,
    };
  }).filter((x) => x.title);
}

// Immagine della notizia dal feed: enclosure, media:content/thumbnail o prima <img> della descrizione
export function imageOf(block) {
  const pats = [
    /<enclosure\b[^>]*\burl=["']([^"']+)["'][^>]*>/i,
    /<media:(?:content|thumbnail)\b[^>]*\burl=["']([^"']+)["'][^>]*>/i,
    /<img\b[^>]*\bsrc=["']([^"']+)["']/i,
    /&lt;img\b[^&]*?\bsrc=(?:&quot;|["'])([^"'&]+)/i,
  ];
  for (const re of pats) {
    const m = block.match(re);
    if (m && /^https?:\/\//.test(m[1]) && !/\.(mp4|mp3|m3u8)(\?|$)/i.test(m[1])) return m[1].replace(/&amp;/g, "&");
  }
  return "";
}

// Immagine principale di un articolo (og:image), per le notizie senza immagine nel feed
export function ogImage(html) {
  const m = html.match(/<meta\b[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/i);
  if (!m) return "";
  const c = m[0].match(/\bcontent=["']([^"']+)["']/i);
  return c && /^https?:\/\//.test(c[1]) ? c[1].replace(/&amp;/g, "&") : "";
}

function field(block, tag) {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return "";
  let v = m[1].trim();
  const c = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (c) v = c[1];
  return v
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ").trim();
}

const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// feedItems: { top: [...], lazio: [...], ... }; now: Date
export function rank(feedItems, now = new Date(), limit = 10) {
  const byKey = new Map();
  for (const [feed, items] of Object.entries(feedItems)) {
    for (const it of items) {
      const k = norm(it.title);
      if (!k) continue;
      const cur = byKey.get(k) || { ...it, feeds: new Set() };
      cur.feeds.add(feed);
      if (!cur.text && it.text) cur.text = it.text;
      if (!cur.time && it.time) cur.time = it.time;
      if (!cur.image && it.image) cur.image = it.image;
      byKey.set(k, cur);
    }
  }
  const out = [];
  for (const it of byKey.values()) {
    const ageH = it.time ? (now - new Date(it.time)) / 3.6e6 : 12;
    if (ageH > 24) continue;
    const hay = it.title + " " + it.text;
    const why = [];
    let score = 0;
    if (it.feeds.has("top")) { score += 3; why.push("primo piano"); }
    if (it.feeds.has("lazio") || ROMA.test(hay)) { score += 3; why.push("Roma e Lazio"); }
    if (PRATICO.test(hay)) { score += 2; why.push("vita di tutti i giorni"); }
    if (it.feeds.size > 1) score += 1;
    score -= Math.floor(Math.max(0, ageH) / 3);
    out.push({ title: it.title, text: it.text.slice(0, 400), link: it.link, image: it.image || "", time: it.time, score, why });
  }
  out.sort((a, b) => b.score - a.score || (b.time || "").localeCompare(a.time || ""));
  return out.slice(0, limit);
}

async function getFeed(url) {
  const r = await fetch(url, { headers: { "user-agent": "homemate/1.0" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`${url} ha risposto ${r.status}`);
  return parseRss(await r.text());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] || "_site/data/news.json";
  const feedItems = {};
  for (const f of FEEDS) {
    try { feedItems[f.key] = await getFeed(f.url); }
    catch (e) { console.log(`Feed ${f.key} non disponibile: ${e.message}`); }
  }
  const items = rank(feedItems);
  // completa le immagini mancanti leggendo l'articolo (al massimo 10 richieste)
  for (const it of items) {
    if (it.image || !it.link) continue;
    try {
      const r = await fetch(it.link, { headers: { "user-agent": "homemate/1.0" }, signal: AbortSignal.timeout(10000) });
      if (r.ok) it.image = ogImage(await r.text());
    } catch (e) { /* resta senza immagine */ }
  }
  console.log(`Immagini trovate: ${items.filter((x) => x.image).length} su ${items.length}`);
  if (!items.length) throw new Error("Nessuna notizia dai feed ANSA");
  await fs.mkdir(out.replace(/\/[^/]+$/, ""), { recursive: true });
  await fs.writeFile(out, JSON.stringify({ source: "ANSA", updated: new Date().toISOString(), items }, null, 1));
  console.log(`Salvate ${items.length} notizie in ${out}`);
}
