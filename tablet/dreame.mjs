// Robot Dreame tramite il cloud Dreamehome (l'app Dreamehome non lascia l'API locale).
// Il lavoro col cloud lo fa tablet/dreame_bridge.py (Python), avviato e tenuto acceso da qui.
// Il collegamento resta solo sul tablet, in ~/.homemate/dreame.json: email, regione, robot scelto e il
// token di rinnovo (la password non si salva).
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// stati del robot (proprietà 2.1) in parole
const STATI = {
  1: "Sta pulendo", 2: "Fermo", 3: "In pausa", 4: "Errore", 5: "Torna alla base", 6: "In carica", 7: "Lava i pavimenti",
  8: "Asciuga i panni", 9: "Lava i panni", 10: "Torna a lavare i panni", 11: "Crea la mappa", 12: "Aspira e lava",
  13: "Carico", 14: "Si aggiorna", 15: "Pulizia su chiamata", 16: "Base in manutenzione", 17: "Torna a mettere i panni",
  18: "Torna a togliere i panni", 19: "Controlla l'acqua", 20: "Aggiunge acqua", 21: "Lavaggio in pausa", 22: "Svuota il serbatoio",
  23: "Comando a distanza", 24: "Ricarica intelligente", 25: "Seconda passata", 26: "Segue una persona", 27: "Pulizia di una zona",
};
const PULISCE = new Set([1, 7, 12, 15, 25, 27]);
const IN_BASE = new Set([6, 13, 8, 9, 16, 19, 20, 22, 24]);

export function shapeRobot(s) {
  if (!s) return null;
  const stato = Number(s.stato);
  return {
    stato, testo: STATI[stato] || (stato ? "Stato " + stato : "Sconosciuto"),
    pulisce: PULISCE.has(stato), inPausa: stato === 3 || stato === 21, inBase: IN_BASE.has(stato) || Number(s.carica) === 1,
    rientra: stato === 5,
    batteria: s.batteria == null ? null : Number(s.batteria),
    carica: Number(s.carica) === 1, codiceErrore: Number(s.errore) || 0,
    minuti: s.tempo == null ? null : Number(s.tempo), mq: s.area == null ? null : Number(s.area),
  };
}

export class Dreame {
  constructor({ file = path.join(os.homedir(), ".homemate", "dreame.json"), python = process.env.DREAME_PYTHON || "python3", log = () => {}, env = {} } = {}) {
    Object.assign(this, { file, python, log, env });
    this.saved = null;      // { username, country, refresh, did, nome }
    this.proc = null; this.ready = null; this.seq = 0; this.waiting = new Map();
    this.state = null; this.error = ""; this.updated = 0; this.inUse = false; this.mancante = "";
  }
  async load() { try { this.saved = JSON.parse(await fs.readFile(this.file, "utf8")); } catch { this.saved = null; } return this; }
  async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.saved), { mode: 0o600 });
  }
  get collegato() { return Boolean(this.saved && this.saved.did && this.saved.refresh); }

  // ---- processo Python ----
  start() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      let p;
      try { p = spawn(this.python, [path.join(HERE, "dreame_bridge.py")], { env: { ...process.env, ...this.env }, stdio: ["pipe", "pipe", "pipe"] }); }
      catch (e) { return reject(e); }
      this.proc = p;
      const fail = (msg) => {
        reject(new Error(msg));
        if (this.proc !== p) return; // processo vecchio, già sostituito
        this.proc = null; this.ready = null; this.inUse = false;
        for (const w of this.waiting.values()) { clearTimeout(w.timer); w.reject(new Error(msg)); }
        this.waiting.clear();
      };
      p.on("error", (e) => { this.mancante = e.code === "ENOENT" ? "Python non installato: rilancia l'installazione" : String(e.message); fail(this.mancante); });
      p.on("exit", (code) => fail("componente Dreame chiuso (" + code + ")"));
      readline.createInterface({ input: p.stderr }).on("line", (l) => this.log(l));
      readline.createInterface({ input: p.stdout }).on("line", (l) => {
        let m; try { m = JSON.parse(l); } catch { return; }
        if (m.id === 0) {
          if (m.ok) { this.mancante = ""; resolve(); } else { this.mancante = m.error; reject(new Error(m.error)); p.kill(); }
          return;
        }
        const w = this.waiting.get(m.id); if (!w) return;
        this.waiting.delete(m.id); clearTimeout(w.timer);
        if (m.refresh) this.lastRefresh = m.refresh;
        if (m.refresh && this.saved && m.refresh !== this.saved.refresh) { this.saved.refresh = m.refresh; this.save().catch(() => {}); }
        m.ok ? w.resolve(m.data) : w.reject(Object.assign(new Error(m.error), { scollegato: /^SCOLLEGATO/.test(m.error || "") }));
      });
    });
    return this.ready;
  }
  async call(cmd, args = {}, ms = 30000) {
    await this.start();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error("Dreamehome non risponde")); }, ms);
      timer.unref?.();
      this.waiting.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ id, cmd, ...args }) + "\n");
    });
  }
  stop() {
    const p = this.proc; this.proc = null; this.ready = null; this.inUse = false;
    for (const w of this.waiting.values()) { clearTimeout(w.timer); w.reject(new Error("interrotto")); }
    this.waiting.clear();
    if (p) p.kill();
  }

  // ---- collegamento ----
  async accedi(username, password, country = "eu") {
    username = String(username || "").trim(); country = String(country || "eu").trim().toLowerCase();
    if (!username || !password) throw Object.assign(new Error("Scrivi email e password di Dreamehome"), { status: 400 });
    this.stop(); // nuovo accesso: processo pulito
    this.lastRefresh = "";
    const r = await this.call("login", { username, password, country });
    if (!r.robot.length) throw Object.assign(new Error("Nell'account Dreamehome non c'è nessun robot aspirapolvere"), { status: 400 });
    this.pending = { username, country, robot: r.robot };
    if (r.robot.length === 1) await this.scegli(r.robot[0].did);
    return r.robot;
  }
  async scegli(did) {
    const p = this.pending; if (!p) throw Object.assign(new Error("Rifai l'accesso"), { status: 400 });
    const rb = p.robot.find((x) => x.did === String(did)); if (!rb) throw Object.assign(new Error("Robot non trovato"), { status: 400 });
    if (!this.lastRefresh) throw new Error("Dreamehome non ha dato un accesso permanente: riprova");
    // il token di rinnovo è quello dell'ultimo accesso, che il ponte ha rimandato con ogni risposta
    this.saved = { username: p.username, country: p.country, refresh: this.lastRefresh || "", did: rb.did, nome: rb.nome, model: rb.model };
    this.pending = null;
    this.stop();
    await this.save();
    await this.refresh();
    this.log(`Dreame collegato: ${rb.nome}`);
  }
  async scollega() { this.stop(); this.saved = null; this.state = null; this.error = ""; await fs.rm(this.file, { force: true }); }

  async ensure() {
    if (!this.collegato) throw Object.assign(new Error("non collegato"), { status: 409 });
    if (this.inUse && this.proc) return;
    const s = this.saved;
    await this.call("use", { username: s.username, country: s.country, refresh: s.refresh, did: s.did });
    this.inUse = true;
  }
  async refresh() {
    if (!this.collegato) return;
    try {
      await this.ensure();
      this.state = shapeRobot(await this.call("status"));
      this.updated = Date.now(); this.error = "";
    } catch (e) {
      this.error = String(e.message || e).replace(/^SCOLLEGATO: /, "");
      if (e.scollegato) { this.saved = { ...this.saved, refresh: "" }; await this.save().catch(() => {}); this.stop(); }
      else this.inUse = false;
    }
  }
  async comando(nome) {
    if (!["avvia", "pausa", "base"].includes(nome)) throw Object.assign(new Error("comando sconosciuto"), { status: 404 });
    await this.ensure();
    await this.call("action", { nome });
    this.log(`Robot: ${nome}`);
    setTimeout(() => this.refresh(), 3000).unref?.();
    setTimeout(() => this.refresh(), 15000).unref?.();
    await this.refresh();
  }
  snapshot() {
    if (!this.saved) return { collegato: false, errore: this.mancante || "" };
    return { ...(this.collegato ? this.state || {} : {}), collegato: this.collegato, nome: this.saved.nome, aggiornato: this.updated ? new Date(this.updated).toISOString() : null, errore: this.error };
  }
}
