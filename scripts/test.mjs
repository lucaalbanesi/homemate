// Test della scelta notizie: node scripts/test.mjs
import assert from "node:assert/strict";
import { parseRss, rank } from "./news.mjs";

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
console.log("Test notizie: ok", r.map((x) => `${x.score} ${x.title}`));
