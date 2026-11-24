// Comandi e stato delle Shelly nella rete di casa (API locale, senza cloud).
// Tapparelle: Shelly Plus 2PM e simili di 2a generazione o successive (RPC Cover).
// Luci: Shelly Dimmer 2 (1a generazione, /light/0) e relè on/off come lo Shelly 1PM.

async function get(url, ms = 2500) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const t = await r.text();
  return t ? JSON.parse(t) : {};
}

// ---- Tapparelle ----
export async function coverStatus(ip) {
  const s = await get(`http://${ip}/rpc/Cover.GetStatus?id=0`);
  return {
    online: true,
    pos: typeof s.current_pos === "number" ? s.current_pos : null,
    state: s.state || "",            // open, closed, opening, closing, stopped, calibrating
    calibrata: s.pos_control !== false,
  };
}

export async function coverCommand(ip, azione, pos) {
  if (azione === "apri") return get(`http://${ip}/rpc/Cover.Open?id=0`);
  if (azione === "chiudi") return get(`http://${ip}/rpc/Cover.Close?id=0`);
  if (azione === "ferma") return get(`http://${ip}/rpc/Cover.Stop?id=0`);
  if (azione === "posizione") {
    const p = Math.max(0, Math.min(100, Math.round(Number(pos))));
    if (!Number.isFinite(p)) throw new Error("posizione non valida");
    return get(`http://${ip}/rpc/Cover.GoToPosition?id=0&pos=${p}`);
  }
  throw new Error(`azione non valida: ${azione}`);
}

// ---- Luci ----
// tipo "dimmer1": Shelly Dimmer 2 (1a generazione, /light/0), con luminosità.
// tipo "switch": relè on/off con misura dei consumi (es. Shelly 1PM). La generazione
// si riconosce da sola: prima le API RPC (Plus, Gen3, Gen4), altrimenti quelle della 1a generazione.
const gen = new Map(); // ip -> "rpc" | "gen1"

async function switchKind(ip) {
  if (gen.has(ip)) return gen.get(ip);
  let k;
  try { await get(`http://${ip}/rpc/Switch.GetStatus?id=0`); k = "rpc"; }
  catch (e) { if (!/^HTTP /.test(String(e.message))) throw e; k = "gen1"; } // risponde ma non conosce RPC
  gen.set(ip, k);
  return k;
}

export async function lightStatus(ip, tipo = "dimmer1") {
  if (tipo === "switch") {
    if (await switchKind(ip) === "rpc") {
      const s = await get(`http://${ip}/rpc/Switch.GetStatus?id=0`);
      return { online: true, on: Boolean(s.output), brightness: null, watt: typeof s.apower === "number" ? s.apower : null };
    }
    const s = await get(`http://${ip}/status`);
    const r = (s.relays || [])[0] || {}, m = (s.meters || [])[0] || {};
    return { online: true, on: Boolean(r.ison), brightness: null, watt: typeof m.power === "number" ? m.power : null };
  }
  const s = await get(`http://${ip}/light/0`);
  return { online: true, on: Boolean(s.ison), brightness: typeof s.brightness === "number" ? s.brightness : null };
}

export async function lightCommand(ip, { on, brightness }, tipo = "dimmer1") {
  if (tipo === "switch") {
    // niente luminosità: chiedere una percentuale vuol dire accendere
    const acc = on !== undefined ? Boolean(on) : brightness !== undefined ? true : undefined;
    if (acc === undefined) throw new Error("comando non valido");
    if (await switchKind(ip) === "rpc") return get(`http://${ip}/rpc/Switch.Set?id=0&on=${acc}`);
    return get(`http://${ip}/relay/0?turn=${acc ? "on" : "off"}`);
  }
  const q = new URLSearchParams();
  if (on !== undefined) q.set("turn", on ? "on" : "off");
  if (brightness !== undefined) {
    const b = Math.max(1, Math.min(100, Math.round(Number(brightness))));
    if (!Number.isFinite(b)) throw new Error("luminosità non valida");
    q.set("brightness", String(b));
  }
  return get(`http://${ip}/light/0?${q}`);
}
