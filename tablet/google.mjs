// Lista della spesa su Google Tasks per la versione di casa.
// Il tablet si collega una volta sola all'account Google (OAuth "Applicazione web", redirect su localhost)
// e conserva il refresh token in ~/.homemate/google.json, insieme al client secret: mai nel repository.
// Così il tablet vede la lista sempre, senza accessi che scadono ogni ora e senza finestre popup.
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export const SCOPE = "https://www.googleapis.com/auth/tasks";

export class Google {
  constructor({ file = path.join(os.homedir(), ".homemate", "google.json"), clientId = "", lista = "Spesa", redirect = "http://localhost:8080/google/fatto",
    auth = "https://accounts.google.com/o/oauth2/v2/auth", token = "https://oauth2.googleapis.com/token", api = "https://tasks.googleapis.com/tasks/v1", log = () => {} } = {}) {
    Object.assign(this, { file, clientId, lista, redirect, authUrl: auth, tokenUrl: token, api, log });
    this.saved = {};       // { clientSecret, refresh_token, email, listId }
    this.access = null;    // { token, exp }
    this.states = new Map();
    this.error = "";
  }
  async load() { try { this.saved = JSON.parse(await fs.readFile(this.file, "utf8")) || {}; } catch { this.saved = {}; } return this; }
  async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.saved), { mode: 0o600 });
  }
  get pronto() { return Boolean(this.clientId && this.saved.clientSecret); }
  get collegato() { return Boolean(this.pronto && this.saved.refresh_token); }
  stato() { return { clientId: Boolean(this.clientId), secret: Boolean(this.saved.clientSecret), collegato: this.collegato, lista: this.lista, errore: this.error }; }

  async setSecret(secret) {
    secret = String(secret || "").trim();
    if (!/^[\w-]{10,}$/.test(secret)) throw Object.assign(new Error("Il client secret non sembra valido"), { status: 400 });
    this.saved = { ...this.saved, clientSecret: secret }; await this.save();
  }
  async scollega() { const { clientSecret } = this.saved; this.saved = { clientSecret }; this.access = null; await this.save(); }

  // ---- Collegamento ----
  linkUrl() {
    if (!this.pronto) throw Object.assign(new Error("Manca il client ID o il client secret"), { status: 400 });
    const state = crypto.randomBytes(16).toString("hex");
    this.states.set(state, Date.now() + 15 * 60000);
    const q = new URLSearchParams({ client_id: this.clientId, redirect_uri: this.redirect, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent", state });
    return `${this.authUrl}?${q}`;
  }
  // accetta i parametri del ritorno da Google (o l'indirizzo intero incollato a mano)
  async finish(params) {
    if (typeof params === "string") { try { params = Object.fromEntries(new URL(params.trim()).searchParams); } catch { throw Object.assign(new Error("Indirizzo non valido"), { status: 400 }); } }
    if (params.error) throw Object.assign(new Error(params.error === "access_denied" ? "Accesso negato su Google" : params.error), { status: 400 });
    const scade = this.states.get(params.state);
    if (!scade || scade < Date.now()) throw Object.assign(new Error("Collegamento scaduto: riparti da «Collega Google»"), { status: 400 });
    this.states.delete(params.state);
    const t = await this.form({ code: params.code, client_id: this.clientId, client_secret: this.saved.clientSecret, redirect_uri: this.redirect, grant_type: "authorization_code" });
    if (!t.refresh_token) throw new Error("Google non ha dato un accesso permanente: riprova");
    this.saved = { ...this.saved, refresh_token: t.refresh_token, listId: null };
    this.access = { token: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1000 };
    this.error = "";
    await this.save();
    this.log("Google collegato");
  }

  async form(body) {
    const r = await fetch(this.tokenUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body), signal: AbortSignal.timeout(15000) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error_description || d.error || "HTTP " + r.status), { code: d.error, status: 502 });
    return d;
  }
  async accessToken() {
    if (this.access && this.access.exp > Date.now() + 60000) return this.access.token;
    if (!this.collegato) throw Object.assign(new Error("non collegata"), { status: 409, scollegato: true });
    try {
      const t = await this.form({ client_id: this.clientId, client_secret: this.saved.clientSecret, refresh_token: this.saved.refresh_token, grant_type: "refresh_token" });
      this.access = { token: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1000 };
      return this.access.token;
    } catch (e) {
      if (e.code === "invalid_grant") { // accesso revocato o scaduto: serve un nuovo collegamento
        this.saved = { clientSecret: this.saved.clientSecret }; await this.save();
        this.error = "Accesso a Google scaduto: ricollega il tablet";
        throw Object.assign(new Error(this.error), { status: 409, scollegato: true });
      }
      throw e;
    }
  }
  async call(p, opt = {}) {
    const tok = await this.accessToken();
    const r = await fetch(this.api + p, { ...opt, headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, signal: AbortSignal.timeout(15000) });
    if (r.status === 401) { this.access = null; throw Object.assign(new Error("accesso rifiutato"), { status: 502 }); }
    if (!r.ok) throw Object.assign(new Error("Google Tasks HTTP " + r.status), { status: r.status === 404 ? 404 : 502 });
    return r.status === 204 ? null : r.json().catch(() => null);
  }

  // ---- Lista ----
  async listId(crea = false) {
    if (this.saved.listId) return this.saved.listId;
    const d = await this.call("/users/@me/lists?maxResults=100");
    const name = this.lista.trim().toLowerCase();
    let l = (d.items || []).find((x) => x.title.trim().toLowerCase() === name);
    if (!l && crea) l = await this.call("/users/@me/lists", { method: "POST", body: JSON.stringify({ title: this.lista }) });
    if (!l) return null;
    this.saved = { ...this.saved, listId: l.id }; await this.save();
    return l.id;
  }
  async withList(fn) {
    try { return await fn(await this.listId()); }
    catch (e) { if (e.status !== 404 || !this.saved.listId) throw e; this.saved = { ...this.saved, listId: null }; return fn(await this.listId()); }
  }
  async voci() {
    if (!this.collegato) return { collegata: false, ...this.stato() };
    const id = await this.listId();
    if (!id) return { collegata: true, lista: this.lista, manca: true, voci: [] };
    const d = await this.withList((lid) => this.call(`/lists/${lid}/tasks?showCompleted=false&maxResults=100`));
    const voci = ((d && d.items) || []).filter((t) => t.title && t.title.trim()).map((t) => ({ id: t.id, titolo: t.title.trim() }));
    this.error = "";
    return { collegata: true, lista: this.lista, voci };
  }
  async aggiungi(titolo) {
    titolo = String(titolo || "").trim().slice(0, 120);
    if (!titolo) throw Object.assign(new Error("Scrivi cosa aggiungere"), { status: 400 });
    const id = await this.listId(true);
    await this.call(`/lists/${id}/tasks`, { method: "POST", body: JSON.stringify({ title: titolo }) });
  }
  async fatto(taskId) {
    await this.withList((lid) => this.call(`/lists/${lid}/tasks/${encodeURIComponent(taskId)}`, { method: "PATCH", body: JSON.stringify({ status: "completed" }) }));
  }
  async creaLista() { await this.listId(true); }
}

// legge googleClientId da app/config.js (lo stesso usato dalla versione online)
export async function clientIdFrom(configJs) {
  try { const m = (await fs.readFile(configJs, "utf8")).match(/googleClientId:\s*["']([^"']*)["']/); return m ? m[1].trim() : ""; } catch { return ""; }
}
