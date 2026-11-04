// Test della scelta notizie: node scripts/test.mjs
import assert from "node:assert/strict";
import { parseRss, rank, imageOf, ogImage } from "./news.mjs";

const now = new Date("2026-11-03T18:00:00Z");
const h = (n) => new Date(now - n * 3.6e6).toUTCString();
const rss = (items) => `<rss><channel>${items.map(([t, d, ago]) => `<item><title><![CDATA[${t}]]></title><description><![CDATA[${d}]]></description><link>https://x/${encodeURIComponent(t)}</link><pubDate>${h(ago)}</pubDate></item>`).join("")}</channel></rss>`;

const top = parseRss(rss([["Vertice internazionale a Bruxelles", "I leader discutono", 1], ["Sciopero dei trasporti venerdì", "Metro e bus a rischio a Roma", 2], ["Notizia vecchia", "", 30]]));
const lazio = parseRss(rss([["Sciopero dei trasporti venerdì", "Metro e bus a rischio a Roma", 2], ["Mostra al Colosseo", "Apre a Roma", 5]]));
const economia = parseRss(rss([["Mutui, la Bce taglia i tassi", "Rate più leggere", 1], ["Borsa &amp; mercati &quot;oggi&quot;", "Seduta piatta", 0]]));

assert.equal(top[0].title, "Vertice internazionale a Bruxelles");
assert.equal(economia[1].title, 'Borsa & mercati "oggi"');

const r = rank({ top, lazio, economia }, now);
assert.equal(r[0].title, "Sciopero dei trasporti venerdì", "primo piano + Roma + pratico + più feed vince");
assert.deepEqual(r[0].why, ["primo piano", "Roma e Lazio", "vita di tutti i giorni"]);
assert.ok(!r.some((x) => x.title === "Notizia vecchia"), "oltre 24 ore esclusa");
assert.equal(r.filter((x) => x.title.startsWith("Sciopero")).length, 1, "doppioni uniti");
assert.ok(r.findIndex((x) => x.title.startsWith("Mutui")) < r.findIndex((x) => x.title.startsWith("Borsa")), "impatto pratico prima");
assert.equal(imageOf('<item><enclosure url="https://img.ansa.it/a.jpg" type="image/jpeg"/></item>'), "https://img.ansa.it/a.jpg");
assert.equal(imageOf('<item><media:thumbnail url="https://img.ansa.it/b.jpg?w=1&amp;h=2"/></item>'), "https://img.ansa.it/b.jpg?w=1&h=2");
assert.equal(imageOf('<item><description><![CDATA[<img src="https://img.ansa.it/c.jpg"> testo]]></description></item>'), "https://img.ansa.it/c.jpg");
assert.equal(imageOf('<item><description>&lt;img src=&quot;https://img.ansa.it/d.jpg&quot;&gt;</description></item>'), "https://img.ansa.it/d.jpg");
assert.equal(imageOf('<item><enclosure url="https://x/v.mp4"/></item>'), "");
assert.equal(ogImage('<meta property="og:image" content="https://img.ansa.it/e.jpg">'), "https://img.ansa.it/e.jpg");
assert.equal(ogImage('<meta content="https://img.ansa.it/f.jpg" property="og:image" />'), "https://img.ansa.it/f.jpg");
assert.equal(ogImage("<html></html>"), "");
assert.ok("image" in r[0]);
console.log("Test notizie: ok", r.map((x) => `${x.score} ${x.title}`));

// ---- Menu mensa ----
import { weekDays, shapeDay, decode, fetchMenu } from "./menu.mjs";
import http from "node:http";
{
  assert.deepEqual(weekDays(new Date("2026-11-07T05:23:00+01:00")), ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"], "sabato: settimana dopo");
  assert.deepEqual(weekDays(new Date("2026-11-08T20:00:00+01:00")), ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"], "domenica: settimana dopo");
  assert.deepEqual(weekDays(new Date("2026-11-04T11:30:00+01:00")), ["2026-11-04", "2026-11-05", "2026-11-06"], "mercoledì: fino a venerdì");
  assert.deepEqual(weekDays(new Date("2026-11-09T08:00:00+01:00")).length, 5, "lunedì: tutta la settimana");
  const day = shapeDay("2026-11-04", [
    { tipoPasto: "Spuntino", descPasto: "Schiacciatine" },
    { tipoPasto: "Pranzo", descPasto: "Risotto al pomodoro" },
    { tipoPasto: "Pranzo", descPasto: "Sformato di platessa<br>Fagiolini all'olio" },
    { tipoPasto: "Merenda", descPasto: "Ciambellone" },
    { tipoPasto: "Note", descPasto: "" },
  ]);
  assert.deepEqual(day.pranzo, ["Risotto al pomodoro", "Sformato di platessa", "Fagiolini all'olio"]);
  assert.equal(day.spuntino, "Schiacciatine"); assert.equal(day.merenda, "Ciambellone"); assert.equal(day.disponibile, true);
  assert.equal(shapeDay("x", []).disponibile, false, "giorno senza menu");
  assert.equal(decode(new Uint8Array([0x63, 0x61, 0x66, 0xe8])), "cafè", "codifica windows-1252");
  assert.equal(decode(new TextEncoder().encode("però")), "però");

  // server finto del Comune
  const seen = [];
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname.endsWith("loadMenuRistorazione.do")) { res.setHeader("set-cookie", "JSESSIONID=abc; Path=/"); return res.end("ok"); }
    seen.push({ q: Object.fromEntries(u.searchParams), cookie: req.headers.cookie });
    res.setHeader("content-type", "application/json");
    res.end(Buffer.from(JSON.stringify([{ tipoPasto: "Pranzo", descPasto: "Pasta e fagioli" }]), "latin1"));
  });
  await new Promise((r) => srv.listen(0, r));
  const got = await fetchMenu({ municipio: 9, ciclo: 5, days: ["2026-11-04"], base: `http://127.0.0.1:${srv.address().port}`, pause: 0 });
  srv.close();
  assert.equal(got[0].pranzo[0], "Pasta e fagioli");
  assert.equal(seen[0].q.giornoSelezionato, "04/11/2026"); assert.equal(seen[0].q.municipio, "9"); assert.equal(seen[0].cookie, "JSESSIONID=abc");
  console.log("Test menu: ok");
}

// ---- Elenco scuole ----
import { update } from "./scuole.mjs";
{
  const base = { nota: "x", combinazioni: [{ municipio: 9, ciclo: 4 }] };
  assert.deepEqual(update(base, "VII", "Primaria", "aggiungi").combinazioni, [{ municipio: 9, ciclo: 4 }, { municipio: 9, ciclo: 5 }]);
  assert.deepEqual(update(base, "xii", "infanzia", "sostituisci").combinazioni, [{ municipio: 16, ciclo: 4 }]);
  assert.deepEqual(update(base, "VII", "Infanzia", "aggiungi").combinazioni, [{ municipio: 9, ciclo: 4 }], "niente doppioni");
  assert.equal(update(base, "VII", "Primaria", "aggiungi").nota, "x");
  assert.throws(() => update(base, "XXX", "Primaria"));
  console.log("Test scuole: ok");
}
await import("./test-casa.mjs");
await import("./test-tado.mjs");
