// Test del servizio di casa con Shelly finte (tapparelle di 2a generazione, Dimmer 2, 1PM nuovo e vecchio).
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
function fake1pm(rpc) {
  const st = { on: false }, calls = [];
  const srv = http.createServer((q, s) => {
    const u = new URL(q.url, "http://x"); calls.push(u.pathname + u.search);
    s.setHeader("content-type", "application/json");
    if (rpc && u.pathname === "/rpc/Switch.GetStatus") return s.end(JSON.stringify({ id: 0, output: st.on, apower: st.on ? 42.3 : 0 }));
    if (rpc && u.pathname === "/rpc/Switch.Set") { st.on = u.searchParams.get("on") === "true"; return s.end(JSON.stringify({ was_on: !st.on })); }
    if (!rpc && u.pathname === "/status") return s.end(JSON.stringify({ relays: [{ ison: st.on }], meters: [{ power: st.on ? 15 : 0 }] }));
    if (!rpc && u.pathname === "/relay/0") { if (u.searchParams.has("turn")) st.on = u.searchParams.get("turn") === "on"; return s.end(JSON.stringify({ ison: st.on })); }
    s.statusCode = 404; s.end("{}");
  });
  return { srv, st, calls };
}
const listen = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(`127.0.0.1:${srv.address().port}`)));

const a = fakeCover(100), b = fakeCover(40), dim = fakeDimmer(), sw2 = fake1pm(true), sw1 = fake1pm(false);
const ipA = await listen(a.srv), ipB = await listen(b.srv), ipD = await listen(dim.srv), ipS2 = await listen(sw2.srv), ipS1 = await listen(sw1.srv);
const cfgFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "casa-")), "casa.json");
await fs.writeFile(cfgFile, JSON.stringify({
  tapparelle: [{ id: "sog", nome: "Soggiorno", stanza: "Soggiorno", ip: ipA }, { id: "cam", nome: "Camera", stanza: "Camera", ip: ipB }, { id: "spenta", nome: "Spenta", stanza: "Bagno", ip: "127.0.0.1:1" }],
  luci: [{ id: "luce", nome: "Luce", stanza: "Soggiorno", ip: ipD, tipo: "dimmer1" }, { id: "divano", nome: "Divano", stanza: "Soggiorno", ip: ipS2, tipo: "switch" }, { id: "vecchio", nome: "Vecchio", stanza: "Studio", ip: ipS1, tipo: "switch" }],
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
assert.equal(snap.luci[0].on, true); assert.equal(snap.luci[0].brightness, 60); assert.equal(snap.luci[0].regolabile, true);
assert.equal(snap.luci[1].on, false); assert.equal(snap.luci[1].regolabile, false); assert.equal(snap.luci[1].brightness, null);
assert.equal(snap.luci[2].online, true, "1PM di 1a generazione riconosciuto");

const srv = http.createServer(casa.handler()); const host = await listen(srv);
const post = (p, body) => fetch(`http://${host}${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) }).then(async (r) => ({ status: r.status, json: await r.json() }));

let r = await post("/api/casa/tapparelle/cam", { azione: "posizione", pos: 75 });
assert.equal(r.status, 200); assert.equal(b.st.current_pos, 75);
r = await post("/api/casa/tapparelle/tutte", { azione: "chiudi" });
assert.equal(r.status, 207, "una tapparella spenta: esito parziale"); assert.equal(r.json.errori.length, 1);
assert.equal(a.st.current_pos, 0); assert.equal(b.st.current_pos, 0);
r = await post("/api/casa/luci/luce", { brightness: 30 });
assert.equal(dim.st.brightness, 30);
r = await post("/api/casa/luci/divano", { on: true });
assert.equal(r.status, 200); assert.equal(sw2.st.on, true);
assert.ok(sw2.calls.includes("/rpc/Switch.Set?id=0&on=true"));
r = await post("/api/casa/luci/vecchio", { brightness: 50 });
assert.equal(r.status, 200); assert.equal(sw1.st.on, true, "sul relè una percentuale accende");
assert.ok(sw1.calls.includes("/relay/0?turn=on"));
await casa.refresh(); snap = casa.snapshot();
assert.equal(snap.luci[1].watt, 42.3); assert.equal(snap.luci[2].watt, 15);
r = await post("/api/casa/scene/notte");
assert.equal(dim.st.ison, false, "la scena spegne la luce"); assert.equal(sw2.st.on, false); assert.equal(sw1.st.on, false);
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

// comandi Tado passano dal servizio al modulo Tado
const calls = [];
casa.useTado({ snapshot: () => ({ collegato: true, stanze: [] }), startLink: async () => calls.push("collega"), tutte: async (az) => { calls.push("tutte:" + az); return []; }, stanza: async (id, b) => calls.push("stanza:" + id + ":" + JSON.stringify(b)) });
assert.equal((await post("/api/casa/tado/tutte", { azione: "max" })).status, 200);
await post("/api/casa/tado/stanze/2", { temp: 21, ore: 1 }); await post("/api/casa/tado/collega");
assert.deepEqual(calls, ["tutte:max", 'stanza:2:{"temp":21,"ore":1}', "collega"]);
assert.equal((await fetch(`http://${host}/api/casa`).then((x) => x.json())).tado.collegato, true);
for (const s of [srv, a.srv, b.srv, dim.srv, sw2.srv, sw1.srv]) s.close();
console.log("Test casa: ok");
