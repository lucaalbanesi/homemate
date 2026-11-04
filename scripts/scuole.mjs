// Aggiorna config/mensa.json: aggiunge una scuola (municipio romano + ciclo) e, se richiesto, toglie le altre.
// Uso: node scripts/scuole.mjs "VII" "Primaria" sostituisci|aggiungi
import fs from "node:fs/promises";
import { MUNICIPI, CICLI } from "./menu.mjs";

export function update(cfg, munRoman, cicloName, mode) {
  const municipio = Number(Object.keys(MUNICIPI).find((k) => MUNICIPI[k] === String(munRoman).trim().toUpperCase()));
  const ciclo = Number(Object.keys(CICLI).find((k) => CICLI[k].toLowerCase() === String(cicloName).trim().toLowerCase()));
  if (!municipio) throw new Error(`Municipio non valido: ${munRoman}`);
  if (!ciclo) throw new Error(`Ciclo non valido: ${cicloName}`);
  const list = mode === "sostituisci" ? [] : (cfg.combinazioni || []).filter((c) => !(c.municipio === municipio && c.ciclo === ciclo));
  list.push({ municipio, ciclo });
  return { ...cfg, combinazioni: list };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [mun, ciclo, mode] = process.argv.slice(2);
  const file = "config/mensa.json";
  const next = update(JSON.parse(await fs.readFile(file, "utf8")), mun, ciclo, mode);
  await fs.writeFile(file, JSON.stringify(next, null, 2) + "\n");
  console.log(`Scuole seguite: ${next.combinazioni.map((c) => `municipio ${MUNICIPI[c.municipio]} ${CICLI[c.ciclo]}`).join(", ")}`);
}
