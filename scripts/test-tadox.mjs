// Test tado X (hops.tado.com) con un Tado finto: riconoscimento della generazione, stanze, comandi, azioni rapide.
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Tado } from "../tablet/tado.mjs";

const rooms = {
  1: { name: "Soggiorno", temp: 19.8, set: 21, heat: 40 },
  2: { name: "Camera", temp: 20.4, set: 20, heat: 0 },
  3: { name: "Cameretta", temp: 20.6, set: 20.5, heat: 0, window: true },
};
const manual = {}, calls = []; let boost = false, allOff = false;
const srv = http.createServer(async (q, s) => {
  const u = new URL(q.url, "http://x"); let body = ""; for await (const c of q) body += c;
  const json = (o, st = 200) => { s.writeHead(st, { "content-type": "application/json" }); s.end(JSON.stringify(o)); };
  if (u.pathname === "/oauth2/token") return json({ access_token: "aX", refresh_token: "rX2", expires_in: 600 });
  if (!String(q.headers.authorization || "").startsWith("Bearer a")) return json({}, 401);
  if (u.pathname === "/api/v2/me") return json({ homes: [{ id: 1799799, name: "Home" }] });
  if (u.pathname === "/api/v2/homes/1799799") return json({ id: 1799799, name: "Home", generation: "LINE_X" });
  if (u.pathname === "/api/v2/homes/1799799/zones") return json([]); // come nella realtà: con tado X le zone v2 sono vuote
  if (u.pathname.startsWith("/hops/")) {
    assert.equal(u.searchParams.get("ngsw-bypass"), "true");
    const p = u.pathname.replace("/hops", "");
    if (q.method !== "GET") calls.push(q.method + " " + p + (body ? " " + body : ""));
    if (p === "/homes/1799799/rooms" && q.method === "GET") {
      return json(Object.entries(rooms).map(([id, r]) => {
        const m = manual[id];
        const off = allOff && !m;
        return {
          id: +id, name: r.name,
          sensorDataPoints: { insideTemperature: { value: r.temp }, humidity: { percentage: 49.6 } },
          setting: off ? { power: "OFF", temperature: null } : boost ? { power: "ON", temperature: { value: 25 } } : m ? m.setting : { power: "ON", temperature: { value: r.set } },
          manualControlTermination: m ? { type: "TIMER", remainingTimeInSeconds: m.termination.durationInSeconds, projectedExpiry: "2026-11-04T19:30:00Z" } : off ? { type: "MANUAL", remainingTimeInSeconds: null, projectedExpiry: null } : null,
          boostMode: boost ? { projectedExpiry: "2026-11-04T19:00:00Z" } : null,
          heatingPower: { percentage: r.heat }, openWindow: r.window ? { activated: true } : null, connection: { state: "CONNECTED" },
        };
      }));
    }
    let m;
    if ((m = p.match(/^\/homes\/1799799\/rooms\/(\d+)\/manualControl$/))) { manual[m[1]] = JSON.parse(body); return json({}); }
    if ((m = p.match(/^\/homes\/1799799\/rooms\/(\d+)\/resumeSchedule$/))) { delete manual[m[1]]; return json({}); }
    if (p === "/homes/1799799/quickActions/boost") { boost = true; allOff = false; return json({ status: "success" }); }
    if (p === "/homes/1799799/quickActions/allOff") { allOff = true; boost = false; for (const k in manual) delete manual[k]; return json({ status: "success" }); }
    if (p === "/homes/1799799/quickActions/resumeSchedule") { allOff = false; boost = false; for (const k in manual) delete manual[k]; return json({ status: "success" }); }
  }
  json({}, 404);
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${srv.address().port}`;
const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "tadox-")), "tado.json");
// stato di partenza: già collegato ma salvato prima del supporto X (senza "gen"), come sul tablet
await fs.writeFile(file, JSON.stringify({ refresh_token: "rX1", homeId: 1799799 }));
const t = await new Tado({ file, api: base + "/api/v2", login: base + "/oauth2", hops: base + "/hops" }).load();
await t.refresh();
let snap = t.snapshot();
assert.equal(t.saved.gen, "X", "generazione riconosciuta");
assert.equal(JSON.parse(await fs.readFile(file, "utf8")).gen, "X", "generazione salvata");
assert.equal(snap.stanze.length, 3, "stanze tado X trovate");
const sog = snap.stanze.find((z) => z.nome === "Soggiorno");
assert.equal(sog.temp, 19.8); assert.equal(sog.umidita, 50); assert.equal(sog.target, 21); assert.equal(sog.riscalda, true); assert.equal(sog.manuale, false);
assert.equal(snap.stanze.find((z) => z.nome === "Cameretta").finestra, true);

await t.stanza(2, { temp: 22.3, ore: 2 });
assert.deepEqual(manual[2], { setting: { power: "ON", temperature: { value: 22.5 } }, termination: { type: "TIMER", durationInSeconds: 7200 } });
const cam = t.snapshot().stanze.find((z) => z.nome === "Camera");
assert.equal(cam.manuale, true); assert.equal(cam.target, 22.5); assert.equal(cam.fino, "2026-11-04T19:30:00Z");
await t.stanza(2, { programma: true });
assert.equal(manual[2], undefined); assert.equal(t.snapshot().stanze[1].manuale, false);

calls.length = 0;
await t.tutte("max");
assert.deepEqual(calls, ["POST /homes/1799799/quickActions/boost"], "Max = boost, una sola richiesta");
snap = t.snapshot();
assert.ok(snap.stanze.every((z) => z.boost && z.target === 25)); assert.equal(snap.stanze[0].fino, "2026-11-04T19:00:00Z");
await t.tutte("spegni");
assert.ok(t.snapshot().stanze.every((z) => !z.acceso && z.target === null), "tutto spento");
await t.tutte("programma");
assert.ok(t.snapshot().stanze.every((z) => z.acceso && !z.manuale), "tutto al programma");
await assert.rejects(t.tutte("salta"));
const dia = await t.diagnosi();
assert.equal(dia.case[0].generazione, "LINE_X"); assert.equal(dia.case[0].stanze.length, 3);
srv.close();
console.log("Test tado X: ok");
