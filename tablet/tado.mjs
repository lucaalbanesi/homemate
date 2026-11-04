// Riscaldamento Tado (valvole V3/V3+) tramite l'API cloud di Tado.
// Collegamento con il "device code flow" di Tado: il tablet mostra un link, la persona approva con il suo account.
// Il token resta solo sul tablet, in ~/.homemate/tado.json (mai nel repository).
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const CLIENT_ID = "1bb50063-6b0c-4d11-bd99-387f4a91cc46"; // client pubblico dell'app web di Tado
export const MAX_TEMP = 25, MIN_TEMP = 5;

export class Tado {
  constructor({ file = path.join(os.homedir(), ".homemate", "tado.json"), api = "https://my.tado.com/api/v2", login = "https://login.tado.com/oauth2", log = () => {}, minInterval = 5 } = {}) {
    this.file = file; this.api = api; this.login = login; this.log = log; this.minInterval = minInterval;
    this.saved = null;          // { refresh_token, homeId }
    this.access = null;         // { token, exp }
    this.zones = [];            // [{ id, nome }]
    this.state = null;          // ultimo stato letto
    this.pending = null;        // collegamento in corso { link, codice, scade }
    this.error = "";
    this.updated = 0;
  }

  async load() {
    try { this.saved = JSON.parse(await fs.readFile(this.file, "utf8")); } catch { this.saved = null; }
    return this;
  }
  async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.saved), { mode: 0o600 });
  }

  // ---- Collegamento (device code flow) ----
  async startLink() {
    if (this.pending && this.pending.scade > Date.now()) return this.pending;
    const r = await this.form(`${this.login}/device_authorize`, { client_id: CLIENT_ID, scope: "offline_access" });
    this.pending = { link: r.verification_uri_complete, codice: r.user_code, scade: Date.now() + (r.expires_in || 300) * 1000 };
    this.waitLink(r.device_code, Math.max(this.minInterval, typeof r.interval === "number" ? r.interval : 5));
    return this.pending;
  }
  async waitLink(deviceCode, interval) {
    while (this.pending && Date.now() < this.pending.scade) {
      await new Promise((ok) => setTimeout(ok, interval * 1000));
      try {
        const t = await this.form(`${this.login}/token`, { client_id: CLIENT_ID, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" });
        this.setTokens(t);
        this.pending = null;
        const home = await this.pickHome();
        this.log("Tado collegato:", home.name || home.id);
        await this.refresh();
        return;
      } catch (e) {
        if (e.code === "authorization_pending" || e.code === "slow_down") continue;
        this.pending = null; this.error = "Collegamento non riuscito: " + e.message; this.log(this.error);
        return;
      }
    }
    this.pending = null;
  }
  // Sceglie la casa dell'account che ha stanze di riscaldamento (un account può avere più case)
  async pickHome() {
    const me = await this.get("/me");
    const homes = me.homes || [];
    if (!homes.length) throw new Error("nessuna casa trovata nell'account Tado");
    let chosen = homes[0], zones = [];
    for (const h of homes) {
      const z = heatingZones(await this.get(`/homes/${h.id}/zones`).catch(() => []));
      if (z.length) { chosen = h; zones = z; break; }
    }
    this.saved = { ...this.saved, homeId: chosen.id };
    this.zones = zones;
    await this.save();
    return chosen;
  }

  // Diagnosi in sola lettura: case dell'account e stanze di ognuna, senza token né dati personali
  async diagnosi() {
    const me = await this.get("/me");
    const homes = [];
    for (const h of me.homes || []) {
      const info = await this.get(`/homes/${h.id}`).catch((e) => ({ errore: e.message }));
      const zones = await this.get(`/homes/${h.id}/zones`).catch((e) => ({ errore: e.message }));
      homes.push({
        id: h.id, nome: h.name || info.name || "", generazione: info.generation || "", scelta: this.saved && this.saved.homeId === h.id,
        stanze: Array.isArray(zones) ? zones.map((z) => ({ id: z.id, nome: z.name, tipo: z.type, dispositivi: (z.devices || []).map((d) => d.deviceType).join(", ") })) : zones,
      });
    }
    return { collegato: Boolean(this.saved && this.saved.homeId), case: homes, stanzeUsate: this.zones, errore: this.error };
  }

  setTokens(t) {
    this.access = { token: t.access_token, exp: Date.now() + ((t.expires_in || 600) - 30) * 1000 };
    this.saved = { ...(this.saved || {}), refresh_token: t.refresh_token || (this.saved && this.saved.refresh_token) };
  }
  async token() {
    if (this.access && this.access.exp > Date.now()) return this.access.token;
    if (!this.saved || !this.saved.refresh_token) throw Object.assign(new Error("Tado non collegato"), { code: "not_linked" });
    try {
      const t = await this.form(`${this.login}/token`, { client_id: CLIENT_ID, grant_type: "refresh_token", refresh_token: this.saved.refresh_token });
      this.setTokens(t);
      await this.save(); // il refresh token cambia a ogni rinnovo: va salvato subito
      return this.access.token;
    } catch (e) {
      if (e.code === "invalid_grant") { this.saved = null; await fs.rm(this.file, { force: true }); throw Object.assign(new Error("collegamento a Tado scaduto"), { code: "not_linked" }); }
      throw e;
    }
  }

  // ---- HTTP ----
  async form(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error_description || j.error || `HTTP ${r.status}`), { code: j.error });
    return j;
  }
  async call(method, p, body) {
    const r = await fetch(this.api + p, {
      method, headers: { authorization: "Bearer " + (await this.token()), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000),
    });
    if (r.status === 401) { this.access = null; throw new Error("accesso a Tado rifiutato"); }
    if (r.status === 429) throw new Error("troppe richieste a Tado, riprovo più tardi");
    if (!r.ok) throw new Error(`Tado ha risposto ${r.status}`);
    return r.status === 204 ? null : r.json().catch(() => null);
  }
  get(p) { return this.call("GET", p); }
  home(p) { return `/homes/${this.saved.homeId}${p}`; }

  // ---- Stato ----
  async refresh() {
    if (!this.saved || !this.saved.homeId) return;
    try {
      if (!this.zones.length) {
        this.zones = heatingZones(await this.get(this.home("/zones")));
        if (!this.zones.length) await this.pickHome(); // la casa salvata non ha stanze: provo le altre dell'account
      }
      const s = await this.get(this.home("/zoneStates"));
      this.state = shapeStates(this.zones, (s && s.zoneStates) || {});
      this.updated = Date.now(); this.error = "";
    } catch (e) {
      if (e.code === "not_linked") { this.zones = []; this.state = null; }
      this.error = e.message;
    }
  }
  snapshot() {
    const linked = Boolean(this.saved && this.saved.homeId);
    return {
      collegato: linked,
      collegamento: this.pending ? { link: this.pending.link, codice: this.pending.codice } : null,
      stanze: linked && this.state ? this.state : [],
      aggiornato: this.updated ? new Date(this.updated).toISOString() : null,
      errore: this.error || "",
    };
  }

  // ---- Comandi ----
  overlay(zoneId, celsius, seconds) {
    const setting = celsius == null ? { type: "HEATING", power: "OFF" } : { type: "HEATING", power: "ON", temperature: { celsius } };
    const termination = seconds ? { typeSkillBasedApp: "TIMER", type: "TIMER", durationInSeconds: seconds } : { typeSkillBasedApp: "MANUAL", type: "MANUAL" };
    return this.call("PUT", this.home(`/zones/${zoneId}/overlay`), { setting, termination });
  }
  backToSchedule(zoneId) { return this.call("DELETE", this.home(`/zones/${zoneId}/overlay`)); }

  async stanza(zoneId, { temp, ore, programma }) {
    const z = this.zones.find((x) => String(x.id) === String(zoneId));
    if (!z) throw Object.assign(new Error("stanza non trovata"), { status: 404 });
    if (programma) await this.backToSchedule(z.id);
    else {
      const t = clampTemp(temp), h = Number(ore);
      if (!(h >= 1 && h <= 3)) throw Object.assign(new Error("durata non valida"), { status: 400 });
      await this.overlay(z.id, t, h * 3600);
    }
    await this.refresh();
  }
  async tutte(azione) {
    if (!this.zones.length) throw Object.assign(new Error("Tado non collegato"), { status: 409 });
    const errori = [];
    for (const z of this.zones) {
      try {
        if (azione === "max") await this.overlay(z.id, MAX_TEMP, 1800);
        else if (azione === "spegni") await this.overlay(z.id, null, 0);
        else if (azione === "programma") await this.backToSchedule(z.id);
        else throw Object.assign(new Error("azione non valida"), { status: 400 });
      } catch (e) { if (e.status) throw e; errori.push(`${z.nome}: ${e.message}`); }
    }
    await this.refresh();
    return errori;
  }
}

// Stanze di riscaldamento: tutte tranne acqua calda e climatizzatori
export function heatingZones(list) {
  return (Array.isArray(list) ? list : []).filter((z) => z && z.type !== "HOT_WATER" && z.type !== "AIR_CONDITIONING").map((z) => ({ id: z.id, nome: z.name }));
}

export function clampTemp(t) {
  const v = Math.round(Number(t) * 2) / 2;
  if (!Number.isFinite(v)) throw Object.assign(new Error("temperatura non valida"), { status: 400 });
  return Math.max(MIN_TEMP, Math.min(MAX_TEMP, v));
}

// Stato di Tado in forma semplice per la pagina
export function shapeStates(zones, zs) {
  return zones.map((z) => {
    const s = zs[z.id] || zs[String(z.id)] || {};
    const set = (s.overlay && s.overlay.setting) || s.setting || {};
    const term = s.overlay && s.overlay.termination;
    const sensor = s.sensorDataPoints || {};
    const heat = s.activityDataPoints && s.activityDataPoints.heatingPower;
    return {
      id: z.id,
      nome: z.nome,
      temp: sensor.insideTemperature ? round1(sensor.insideTemperature.celsius) : null,
      umidita: sensor.humidity ? Math.round(sensor.humidity.percentage) : null,
      acceso: set.power !== "OFF",
      target: set.power === "OFF" ? null : set.temperature ? round1(set.temperature.celsius) : null,
      manuale: Boolean(s.overlay),
      fino: term && (term.projectedExpiry || term.expiry) ? (term.projectedExpiry || term.expiry) : null,
      riscalda: heat ? heat.percentage > 0 : false,
      finestra: Boolean(s.openWindow || s.openWindowDetected),
      online: s.link ? s.link.state !== "OFFLINE" : true,
    };
  });
}
const round1 = (x) => (typeof x === "number" ? Math.round(x * 10) / 10 : null);
