// Test del robot Dreame con il ponte Python in modalità finta (DREAME_FAKE=1): collegamento, stato, comandi.
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Dreame, shapeRobot } from "../tablet/dreame.mjs";
import { handler, useDreame } from "../tablet/server.mjs";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hm-dreame-"));
const file = path.join(dir, "dreame.json");
const dreame = new Dreame({ file, env: { DREAME_FAKE: "1" } });
await dreame.load();
useDreame(dreame);
const srv = http.createServer(handler()).listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const api = () => fetch(base + "/api/casa").then((r) => r.json());
const form = (p, o) => fetch(base + p, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o) }).then((r) => r.text());
const post = (p) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.json());

try {
  assert.equal(shapeRobot({ stato: 6, batteria: 50, carica: 1 }).inBase, true);
  assert.equal(shapeRobot({ stato: 1, batteria: 50, carica: 2 }).pulisce, true);

  assert.equal((await api()).robot.collegato, false);
  assert.match(await (await fetch(base + "/dreame")).text(), /Dreamehome/);
  assert.match(await form("/dreame/accedi", { email: "luca@example.com", password: "sbagliata", regione: "eu" }), /non riuscito/);
  const ok = await form("/dreame/accedi", { email: "luca@example.com", password: "giusta", regione: "eu" });
  assert.match(ok, /Collegato/);
  const saved = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(saved.did, "111"); assert.equal(saved.country, "eu"); assert.ok(saved.refresh); assert.equal(saved.password, undefined);
  assert.doesNotMatch(await fs.readFile(file, "utf8"), /giusta/);

  let r = (await api()).robot;
  assert.equal(r.collegato, true); assert.equal(r.nome, "L10s Pro Ultra Heat"); assert.equal(r.batteria, 87); assert.equal(r.testo, "In carica");

  r = (await post("/api/casa/robot/avvia")).robot;
  assert.equal(r.testo, "Sta pulendo"); assert.equal(r.pulisce, true);
  r = (await post("/api/casa/robot/pausa")).robot;
  assert.equal(r.inPausa, true);
  r = (await post("/api/casa/robot/base")).robot;
  assert.equal(r.rientra, true);
  assert.equal((await fetch(base + "/api/casa/robot/esplodi", { method: "POST" })).status, 404);

  // accesso scaduto: la scheda chiede di ricollegare
  dreame.stop(); dreame.saved.refresh = "scaduto"; dreame.inUse = false;
  await dreame.refresh();
  r = (await api()).robot;
  assert.equal(r.collegato, false); assert.match(r.errore, /ricollega/);
  const cmd = await post("/api/casa/robot/avvia");
  assert.equal(cmd.ok, false);

  // dopo un riavvio il collegamento salvato basta
  await form("/dreame/accedi", { email: "luca@example.com", password: "giusta", regione: "eu" });
  dreame.stop();
  const d2 = new Dreame({ file, env: { DREAME_FAKE: "1" } }); await d2.load(); useDreame(d2); await d2.refresh();
  assert.equal((await api()).robot.collegato, true);
  assert.match(await form("/dreame/scollega", {}), /Scollegato/);
  assert.equal((await api()).robot.collegato, false);
  d2.stop();
  console.log("Robot Dreame: tutti i test passati");
} finally { srv.close(); dreame.stop(); await fs.rm(dir, { recursive: true, force: true }); }
