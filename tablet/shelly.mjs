// Comandi e stato delle Shelly nella rete di casa (API locale, senza cloud).
// Tapparelle: Shelly Plus 2PM e simili di 2a generazione o successive (RPC Cover).
// Luci: Shelly Dimmer 2 (1a generazione, /light/0).

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

// ---- Luci (Dimmer 2) ----
export async function lightStatus(ip) {
  const s = await get(`http://${ip}/light/0`);
  return { online: true, on: Boolean(s.ison), brightness: typeof s.brightness === "number" ? s.brightness : null };
}

export async function lightCommand(ip, { on, brightness }) {
  const q = new URLSearchParams();
  if (on !== undefined) q.set("turn", on ? "on" : "off");
  if (brightness !== undefined) {
    const b = Math.max(1, Math.min(100, Math.round(Number(brightness))));
    if (!Number.isFinite(b)) throw new Error("luminosità non valida");
    q.set("brightness", String(b));
  }
  return get(`http://${ip}/light/0?${q}`);
}
