// Test del riscaldamento Tado con un Tado finto (login con codice, stanze, comandi).
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Tado, shapeStates, clampTemp } from "../tablet/tado.mjs";

const zones = { 1: { name: "Soggiorno", temp: 19.8, set: 21 }, 2: { name: "Camera", temp: 20.4, set: 20 }, 3: { name: "Cameretta", temp: 20.6, set: 20.5 } };
const overlays = {}; let tokenCalls = 0, refreshes = 0, lastRefresh = "";
const srv = http.createServer(async (q, s) => {
  const u = new URL(q.url, "http://x"); let body = ""; for await (const c of q) body += c;
  const json = (o, st = 200) => { s.writeHead(st, { "content-type": "application/json" }); s.end(JSON.stringify(o)); };
  if (u.pathname === "/oauth2/device_authorize") return json({ device_code: "dc", user_code: "ABC123", verification_uri_complete: "https://login.tado.com/oauth2/device?user_code=ABC123", expires_in: 300, interval: 0 });
  if (u.pathname === "/oauth2/token") {
    const f = new URLSearchParams(body);
    if (f.get("grant_type").endsWith("device_code")) { tokenCalls++; return tokenCalls < 2 ? json({ error: "authorization_pending" }, 400) : json({ access_token: "a1", refresh_token: "r1", expires_in: 1 }); }
    if (f.get("grant_type") === "refresh_token") { refreshes++; lastRefresh = f.get("refresh_token"); return json({ access_token: "a" + (refreshes + 1), refresh_token: "r" + (refreshes + 1), expires_in: 600 }); }
  }
  if (!String(q.headers.authorization || "").startsWith("Bearer a")) return json({}, 401);
  if (u.pathname === "/api/v2/me") return json({ homes: [{ id: 5, name: "Vecchia casa" }, { id: 7, name: "Casa" }] });
  if (u.pathname === "/api/v2/homes/5/zones") return json([]);
  if (u.pathname === "/api/v2/homes/7") return json({ id: 7, name: "Casa", generation: "PRE_LINE_X" });
  if (u.pathname === "/api/v2/homes/5") return json({ id: 5, name: "Vecchia casa", generation: "PRE_LINE_X" });
  if (u.pathname === "/api/v2/homes/7/zones") return json([...Object.entries(zones).map(([id, z]) => ({ id: +id, name: z.name, type: "HEATING" })), { id: 9, name: "Acqua", type: "HOT_WATER" }]);
  if (u.pathname === "/api/v2/homes/7/zoneStates") {
    const zoneStates = {};
    for (const [id, z] of Object.entries(zones)) {
      const o = overlays[id];
      zoneStates[id] = {
        setting: { type: "HEATING", power: "ON", temperature: { celsius: z.set } },
        overlay: o ? { setting: o.setting, termination: o.termination.type === "TIMER" ? { ...o.termination, projectedExpiry: "2026-11-04T17:56:00Z" } : o.termination } : null,
        sensorDataPoints: { insideTemperature: { celsius: z.temp }, humidity: { percentage: 51.4 } },
        activityDataPoints: { heatingPower: { percentage: id === "1" ? 40 : 0 } },
        openWindow: id === "3" ? { detectedTime: "x" } : null, link: { state: "ONLINE" },
      };
    }
    return json({ zoneStates });
  }
  const m = u.pathname.match(/^\/api\/v2\/homes\/7\/zones\/(\d+)\/overlay$/);
  if (m && q.method === "PUT") { overlays[m[1]] = JSON.parse(body); return json(overlays[m[1]]); }
  if (m && q.method === "DELETE") { delete overlays[m[1]]; s.writeHead(204); return s.end(); }
  json({}, 404);
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}`;
const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "tado-")), "tado.json");
const t = await new Tado({ file, api: base + "/api/v2", login: base + "/oauth2", minInterval: 0.05 }).load();

assert.equal(t.snapshot().collegato, false);
const link = await t.startLink();
assert.equal(link.codice, "ABC123");
for (let i = 0; i < 40 && !t.snapshot().collegato; i++) await new Promise((r) => setTimeout(r, 50));
for (let i = 0; i < 40 && !t.snapshot().stanze.length; i++) await new Promise((r) => setTimeout(r, 50));
let snap = t.snapshot();
assert.equal(snap.collegato, true, "collegato dopo l'approvazione");
assert.equal(snap.stanze.length, 3, "solo le zone di riscaldamento");
const sog = snap.stanze.find((z) => z.nome === "Soggiorno");
assert.equal(sog.temp, 19.8); assert.equal(sog.umidita, 51); assert.equal(sog.target, 21); assert.equal(sog.riscalda, true); assert.equal(sog.manuale, false);
assert.equal(snap.stanze.find((z) => z.nome === "Cameretta").finestra, true);
assert.equal(JSON.parse(await fs.readFile(file, "utf8")).homeId, 7, "scelta la casa con le stanze, non la prima");
const dia = await t.diagnosi();
assert.equal(dia.case.length, 2); assert.equal(dia.case[1].scelta, true); assert.equal(dia.case[1].stanze.length, 4); assert.equal(dia.case[1].generazione, "PRE_LINE_X");
assert.ok(!JSON.stringify(dia).includes("r1"), "nessun token nella diagnosi");

// il token scade (expires_in 1): al comando successivo si rinnova e il nuovo refresh token viene salvato
await new Promise((r) => setTimeout(r, 1100));
await t.stanza(2, { temp: 22.3, ore: 2 });
assert.deepEqual(overlays[2].setting.temperature, { celsius: 22.5 }, "mezzo grado");
assert.equal(overlays[2].termination.durationInSeconds, 7200);
assert.equal(lastRefresh, "r1"); assert.equal(JSON.parse(await fs.readFile(file, "utf8")).refresh_token, "r2", "refresh token ruotato e salvato");
snap = t.snapshot(); const cam = snap.stanze.find((z) => z.nome === "Camera");
assert.equal(cam.manuale, true); assert.equal(cam.target, 22.5); assert.equal(cam.fino, "2026-11-04T17:56:00Z");

assert.deepEqual(await t.tutte("max"), []);
for (const id of [1, 2, 3]) { assert.equal(overlays[id].setting.temperature.celsius, 25); assert.equal(overlays[id].termination.durationInSeconds, 1800); }
await t.tutte("spegni");
assert.equal(overlays[1].setting.power, "OFF"); assert.equal(overlays[1].termination.type, "MANUAL");
assert.equal(t.snapshot().stanze[0].acceso, false); assert.equal(t.snapshot().stanze[0].target, null);
await t.tutte("programma");
assert.equal(Object.keys(overlays).length, 0, "tutte tornate al programma");
await t.stanza(1, { temp: 21, ore: 1 }); await t.stanza(1, { programma: true });
assert.equal(overlays[1], undefined);
await assert.rejects(t.stanza(1, { temp: 21, ore: 5 }));
await assert.rejects(t.stanza(99, { programma: true }));
assert.equal(clampTemp(40), 25); assert.equal(clampTemp(2), 5); assert.equal(clampTemp(20.26), 20.5);

// dopo un riavvio il collegamento si recupera dal file
const t2 = await new Tado({ file, api: base + "/api/v2", login: base + "/oauth2" }).load();
await t2.refresh();
assert.equal(t2.snapshot().stanze.length, 3, "riparte già collegato");
srv.close();
console.log("Test tado: ok");
