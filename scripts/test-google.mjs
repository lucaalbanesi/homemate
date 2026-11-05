// Test della lista della spesa di casa con un Google finto (collegamento, lista, aggiunta, spunta, revoca).
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Google, clientIdFrom } from "../tablet/google.mjs";
import { handler, useGoogle } from "../tablet/server.mjs";

const tasks = [{ id: "t1", title: "Latte", status: "needsAction" }, { id: "t2", title: "  ", status: "needsAction" }];
let lists = [{ id: "L1", title: "Lavoro" }], revoked = false;
const g = http.createServer(async (q, s) => {
  const u = new URL(q.url, "http://x"); let body = ""; for await (const c of q) body += c;
  const json = (o, st = 200) => { s.writeHead(st, { "content-type": "application/json" }); s.end(JSON.stringify(o)); };
  if (u.pathname === "/token") {
    const f = new URLSearchParams(body);
    assert.equal(f.get("client_secret"), "GOCSPX-segreto123");
    if (f.get("grant_type") === "authorization_code") return f.get("code") === "C0DE" ? json({ access_token: "a1", refresh_token: "r1", expires_in: 1 }) : json({ error: "invalid_grant" }, 400);
    if (f.get("grant_type") === "refresh_token") return revoked ? json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400) : json({ access_token: "a2", expires_in: 3600 });
  }
  if (!/^Bearer a/.test(q.headers.authorization || "")) return json({}, 401);
  if (u.pathname === "/api/users/@me/lists" && q.method === "GET") return json({ items: lists });
  if (u.pathname === "/api/users/@me/lists" && q.method === "POST") { const l = { id: "L2", title: JSON.parse(body).title }; lists.push(l); return json(l); }
  const m = u.pathname.match(/^\/api\/lists\/(\w+)\/tasks(?:\/(\w+))?$/);
  if (m && m[1] !== "L2") return json({}, 404);
  if (m && q.method === "GET") return json({ items: tasks.filter((t) => t.status !== "completed") });
  if (m && q.method === "POST") { tasks.unshift({ id: "t" + (tasks.length + 1), title: JSON.parse(body).title, status: "needsAction" }); return json({}); }
  if (m && q.method === "PATCH") { const t = tasks.find((x) => x.id === m[2]); if (!t) return json({}, 404); Object.assign(t, JSON.parse(body)); return json(t); }
  json({}, 404);
}).listen(0);
const gb = `http://127.0.0.1:${g.address().port}`;
const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hm-google-"));
const google = new Google({ file: path.join(dir, "google.json"), clientId: "123.apps.googleusercontent.com", auth: gb + "/auth", token: gb + "/token", api: gb + "/api" });
await google.load();
useGoogle(google);
const srv = http.createServer(handler()).listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const get = (p) => fetch(base + p, { redirect: "manual" });
const post = (p, b) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}) }).then((r) => r.json());
const form = (p, o) => fetch(base + p, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o) }).then((r) => r.text());

try {
  // client id letto da config.js
  assert.equal(await clientIdFrom(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "app", "config.js")), (await fs.readFile(new URL("../app/config.js", import.meta.url), "utf8")).match(/googleClientId:\s*"([^"]*)"/)[1]);

  // non collegata: la pagina chiede il secret, l'API dice "non collegata"
  assert.equal((await (await fetch(base + "/api/casa/spesa")).json()).collegata, false);
  assert.match(await (await get("/google")).text(), /client secret/);
  assert.match(await form("/google/chiave", { secret: "x" }), /non sembra valido/);
  assert.match(await form("/google/chiave", { secret: "GOCSPX-segreto123" }), /Collega Google/);
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, "google.json"), "utf8")).clientSecret, "GOCSPX-segreto123");

  // collegamento: redirect a Google con offline + consent, ritorno con il codice
  const r = await get("/google/vai");
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get("location"));
  assert.equal(loc.searchParams.get("access_type"), "offline");
  assert.equal(loc.searchParams.get("scope"), "https://www.googleapis.com/auth/tasks");
  const state = loc.searchParams.get("state");
  assert.match(await (await get("/google/fatto?code=C0DE&state=sbagliato")).text(), /scaduto/);
  assert.match(await (await get(`/google/fatto?code=C0DE&state=${state}`)).text(), /Collegato/);
  assert.equal(JSON.parse(await fs.readFile(path.join(dir, "google.json"), "utf8")).refresh_token, "r1");
  assert.match(await (await get("/google")).text(), /è collegato/);

  // collegamento incollando l'indirizzo (da un altro dispositivo)
  const loc2 = new URL((await get("/google/vai")).headers.get("location"));
  assert.match(await form("/google/incolla", { url: `http://localhost:8080/google/fatto?state=${loc2.searchParams.get("state")}&code=C0DE&scope=x` }), /Collegato/);

  // la lista "Spesa" manca: la si crea, poi aggiunta e spunta
  let d = await (await fetch(base + "/api/casa/spesa")).json();
  assert.equal(d.manca, true);
  d = await post("/api/casa/spesa", { crea: true });
  assert.deepEqual(d.voci, [{ id: "t1", titolo: "Latte" }]);
  d = await post("/api/casa/spesa", { titolo: "  Pane  " });
  assert.deepEqual(d.voci.map((v) => v.titolo), ["Pane", "Latte"]);
  assert.equal((await fetch(base + "/api/casa/spesa", { method: "POST", body: JSON.stringify({ titolo: " " }) })).status, 400);
  d = await post("/api/casa/spesa/t1/fatto");
  assert.deepEqual(d.voci.map((v) => v.titolo), ["Pane"]);

  // lista cancellata su Google e ricreata con un altro nome di id: la ritrova da sola
  google.saved.listId = "VECCHIA";
  assert.deepEqual((await (await fetch(base + "/api/casa/spesa")).json()).voci.map((v) => v.titolo), ["Pane"]);

  // accesso revocato: torna "non collegata" con il motivo, il secret resta
  revoked = true; google.access = null;
  d = await (await fetch(base + "/api/casa/spesa")).json();
  assert.equal(d.collegata, false);
  assert.match(d.errore || d.error, /ricollega/);
  d = await (await fetch(base + "/api/casa/spesa")).json();
  assert.equal(d.collegata, false);
  assert.match(d.errore, /ricollega/);
  assert.equal(google.saved.clientSecret, "GOCSPX-segreto123");
  console.log("Spesa di casa (Google Tasks): tutti i test passati");
} finally { srv.close(); g.close(); await fs.rm(dir, { recursive: true, force: true }); }
