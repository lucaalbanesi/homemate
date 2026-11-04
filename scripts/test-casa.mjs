// Test del servizio di casa con Shelly finte (tapparelle di 2a generazione e Dimmer 2).
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function fakeCover(start) {
  const st = { current_pos: start, state: "stopped", pos_control: true }, calls = [];
  const srv = http.createServer((q, s) => {
    const u = new URL(q.url, "http://x"); calls.push(u.pathname + u.search);
    s.setHeader("content-type", "application/json");
    if (u.pathname === "/rpc/Cover.GetStatus") return s.end(JSON.stringify({ id: 0, ...st }));
    if (u.pathname === "/rpc/Cover.Open") { st.current_pos = 100; st.state = "open"; return s.end("null"); }
    if (u.pathname === "/rpc/Cover.Close") { st.current_pos = 0; st.state = "closed"; return s.end("null"); }
    if (u.pathname === "/rpc/Cover.Stop") { st.state = "stopped"; return s.end("null"); }
    if (u.pathname === "/rpc/Cover.GoToPosition") { st.current_pos = Number(u.searchParams.get("pos")); return s.end("null"); }
    s.statusCode = 404; s.end("{}");
  });
  return { srv, st, calls };
}
function fakeDimmer() {
  const st = { ison: true, brightness: 60 }, calls = [];
  const srv = http.createServer((q, s) => {
    const u = new URL(q.url, "http://x"); calls.push(u.pathname + u.search);
    if (u.pathname !== "/light/0") { s.statusCode = 404; return s.end("{}"); }
    if (u.searchParams.has("turn")) st.ison = u.searchParams.get("turn") === "on";
    if (u.searchParams.has("brightness")) st.brightness = Number(u.searchParams.get("brightness"));
    s.setHeader("content-type", "application/json"); s.end(JSON.stringify(st));
  });
  return { srv, st, calls };
}
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`127.0.0.1:${srv.address().port}`)));

const a = fakeCover(100), b = fakeCover(40), dim = fakeDimmer();
const ipA = await listen(a.srv), ipB = await listen(b.srv), ipD = await listen(dim.srv);
const cfgFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "casa-")), "casa.json");
await fs.writeFile(cfgFile, JSON.stringify({
  tapparelle: [{ id: "sog", nome: "Soggiorno", stanza: "Soggiorno", ip: ipA }, { id: "cam", nome: "Camera", stanza: "Camera", ip: ipB }, { id: "spenta", nome: "Spenta", stanza: "Bagno", ip: "127.0.0.1:1" }],
  luci: [{ id: "luce", nome: "Luce", stanza: "Soggiorno", ip: ipD, tipo: "dimmer1" }],
  riquadri: [{ id: "r", nome: "Riquadro", righe: [{ id: "coppia", nome: "Coppia", tapparelle: ["sog", "cam"], comandi: ["apri", "50", "chiudi"] }], etichette: ["sog", "cam"] }],
  scene: [{ id: "notte", nome: "Buonanotte", tapparelle: "chiudi", luci: "spegni" }],
}));
const casa = await import("../tablet/server.mjs");
await casa.loadConfig(cfgFile);
await casa.refresh();
let snap = casa.snapshot();
assert.equal(snap.tapparelle.find((t) => t.id === "sog").pos, 100);
assert.equal(snap.tapparelle.find((t) => t.id === "cam").pos, 40);
assert.equal(snap.tapparelle.find((t) => t.id === "spenta").online, false, "dispositivo spento segnalato");
assert.equal(snap.luci[0].on, true); assert.equal(snap.luci[0].brightness, 60);

const srv = http.createServer(casa.handler()); const host = await listen(srv);
const post = (p, body) => fetch(`http://${host}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }).then(async (r) => ({ status: r.status, json: await r.json() }));

let r = await post("/api/casa/tapparelle/cam", { azione: "posizione", pos: 75 });
assert.equal(r.status, 200); assert.equal(b.st.current_pos, 75);
r = await post("/api/casa/tapparelle/tutte", { azione: "chiudi" });
assert.equal(r.status, 207, "una tapparella spenta: esito parziale"); assert.equal(r.json.errori.length, 1);
assert.equal(a.st.current_pos, 0); assert.equal(b.st.current_pos, 0);
r = await post("/api/casa/luci/luce", { brightness: 30 });
assert.equal(dim.st.brightness, 30);
r = await post("/api/casa/scene/notte");
assert.equal(dim.st.ison, false, "la scena spegne la luce");
r = await post("/api/casa/tapparelle/cam", { azione: "salta" });
assert.equal(r.status, 207, "azione non valida rifiutata dalla tapparella");
r = await post("/api/casa/gruppi/coppia", { azione: "posizione", pos: 50 });
assert.equal(r.status, 200); assert.equal(a.st.current_pos, 50); assert.equal(b.st.current_pos, 50, "il gruppo muove entrambe");
assert.equal(r.json.riquadri[0].righe[0].tapparelle.length, 2);
assert.equal((await post("/api/casa/gruppi/nessuno", { azione: "apri" })).status, 404);
r = await post("/api/casa/tapparelle/nessuna", { azione: "apri" });
assert.equal(r.status, 404);
const page = await fetch(`http://${host}/`); assert.equal(page.status, 200); assert.match(await page.text(), /<title>Casa mia<\/title>/);
assert.equal((await fetch(`http://${host}/../config/casa.json`)).status, 404, "niente file fuori da app/");
const st = await fetch(`http://${host}/api/casa`).then((x) => x.json());
assert.equal(st.casa, true); assert.equal(st.scene[0].nome, "Buonanotte");

for (const s of [srv, a.srv, b.srv, dim.srv]) s.close();
console.log("Test casa: ok");
