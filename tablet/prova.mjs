// Prova di HomeMate sul tablet. Solo lettura: non comanda nessun dispositivo.
// - avvia un server sulla porta 8080 (raggiungibile dal tablet e dagli altri dispositivi del Wi-Fi)
// - cerca le Shelly nella rete di casa e ne legge modello, generazione e posizione della tapparella
import http from "node:http";
import dgram from "node:dgram";
import os from "node:os";

const PORT = 8080;
const started = new Date();
let scan = { running: false, done: false, found: [], checked: 0, total: 0, error: "" };

// Indirizzo del tablet nella rete di casa (senza mandare nulla su internet)
function localIp() {
  return new Promise((resolve) => {
    const s = dgram.createSocket("udp4");
    s.on("error", () => resolve(""));
    s.connect(53, "8.8.8.8", () => { const a = s.address().address; s.close(); resolve(a); });
  });
}

async function getJson(url, ms = 1500) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

// Legge una Shelly: /shelly c'è su tutte le generazioni
export async function probe(host) {
  const info = await getJson(`http://${host}/shelly`);
  if (!info || !(info.type || info.model || info.gen)) return null;
  const gen = info.gen || 1;
  const dev = { host, gen, modello: info.model || info.type || "", nome: info.name || "", app: info.app || "", auth: Boolean(info.auth || info.auth_en), posizione: null, stato: "" };
  try {
    if (gen >= 2) {
      const st = await getJson(`http://${host}/rpc/Cover.GetStatus?id=0`, 2000);
      dev.posizione = st.current_pos ?? null; dev.stato = st.state || "";
      if (!dev.nome) { const cfg = await getJson(`http://${host}/rpc/Cover.GetConfig?id=0`, 2000).catch(() => null); dev.nome = (cfg && cfg.name) || ""; }
    } else {
      const st = await getJson(`http://${host}/roller/0`, 2000);
      dev.posizione = st.current_pos ?? null; dev.stato = st.state || "";
    }
  } catch { /* non è una tapparella o richiede password */ }
  return dev;
}

export async function runScan(hosts) {
  scan = { running: true, done: false, found: [], checked: 0, total: hosts.length, error: "" };
  const queue = hosts.slice();
  const worker = async () => {
    while (queue.length) {
      const h = queue.shift();
      try { const d = await probe(h); if (d) scan.found.push(d); } catch { /* nessuna Shelly qui */ }
      scan.checked++;
    }
  };
  await Promise.all(Array.from({ length: 32 }, worker));
  scan.found.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
  scan.running = false; scan.done = true;
  console.log(`Ricerca finita: ${scan.found.length} Shelly trovate`);
  for (const d of scan.found) console.log(`  ${d.host}  gen ${d.gen}  ${d.modello}  ${d.nome}  ${d.posizione != null ? "posizione " + d.posizione + "%" : ""}`);
}

const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function page(ip) {
  const rows = scan.found.map((d) => `<tr><td>${esc(d.host)}</td><td>${esc(d.nome || "-")}</td><td>${esc(d.modello)}${d.app ? " (" + esc(d.app) + ")" : ""}</td><td>${d.gen}</td><td>${d.posizione != null ? d.posizione + "%" : d.auth ? "password" : "-"}</td></tr>`).join("");
  return `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>HomeMate, prova tablet</title>
${scan.running ? '<meta http-equiv="refresh" content="3">' : ""}
<style>body{font-family:system-ui,sans-serif;background:#12151a;color:#eef0f3;margin:0;padding:1.25rem;line-height:1.4}h1{font-size:1.5rem;margin:0 0 1rem}
.card{background:#1b1f26;border-radius:16px;padding:1rem 1.25rem;margin-bottom:1rem}.ok{color:#62d394;font-weight:700}.muted{color:#9aa3b0}
table{width:100%;border-collapse:collapse;font-size:.95rem}td,th{text-align:left;padding:.45rem .5rem;border-bottom:1px solid #2f3540}th{color:#9aa3b0;font-weight:600}
a.btn{display:inline-block;background:#9db7ff;color:#0f1830;font-weight:700;padding:.6rem 1rem;border-radius:12px;text-decoration:none}</style></head><body>
<h1>HomeMate, prova del tablet</h1>
<div class="card"><p class="ok">Il server funziona.</p>
<p>Node.js ${esc(process.version)} · Android/Linux ${esc(os.release())} · acceso dalle ${started.toLocaleTimeString("it-IT")}</p>
<p>Dagli altri dispositivi del Wi-Fi apri: <b>http://${esc(ip || "indirizzo-del-tablet")}:${PORT}</b></p></div>
<div class="card"><h2 style="margin-top:0;font-size:1.15rem">Shelly in casa</h2>
${scan.running ? `<p>Ricerca in corso… ${scan.checked} indirizzi su ${scan.total}</p>` : ""}
${scan.done && !scan.found.length ? '<p>Nessuna Shelly trovata. Controlla che il tablet sia sul Wi-Fi di casa.</p>' : ""}
${scan.found.length ? `<table><tr><th>Indirizzo</th><th>Nome</th><th>Modello</th><th>Gen</th><th>Posizione</th></tr>${rows}</table>
<p class="muted">Solo lettura: nessuna tapparella è stata mossa.</p>` : ""}
${scan.error ? `<p>${esc(scan.error)}</p>` : ""}
${scan.done ? '<p><a class="btn" href="/cerca">Cerca di nuovo</a></p>' : ""}</div>
<p class="muted">Fai uno screenshot di questa pagina e mandalo a Claude.</p></body></html>`;
}

function hostsOf(ip) {
  if (process.env.SCAN_HOSTS) return process.env.SCAN_HOSTS.split(",");
  const m = ip.match(/^(\d+\.\d+\.\d+)\.\d+$/);
  if (!m) return [];
  return Array.from({ length: 254 }, (_, i) => `${m[1]}.${i + 1}`).filter((h) => h !== ip);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ip = await localIp();
  const start = () => {
    const hosts = hostsOf(ip);
    if (!hosts.length) { scan = { ...scan, done: true, error: "Non riesco a capire l'indirizzo del tablet nella rete di casa." }; return; }
    runScan(hosts).catch((e) => { scan.running = false; scan.done = true; scan.error = String(e.message || e); });
  };
  http.createServer((req, res) => {
    if (req.url === "/cerca") { if (!scan.running) start(); res.writeHead(302, { location: "/" }); return res.end(); }
    if (req.url === "/stato.json") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ node: process.version, ip, scan })); }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(page(ip));
  }).listen(PORT, "0.0.0.0", () => {
    console.log("");
    console.log("Server avviato. Apri nel browser del tablet:  http://localhost:" + PORT);
    if (ip) console.log("Dagli altri dispositivi del Wi-Fi:            http://" + ip + ":" + PORT);
    console.log("Cerco le Shelly nella rete di casa...");
    start();
  });
}
