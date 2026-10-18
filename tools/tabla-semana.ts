// Tabla markdown extremo a extremo de la semana 18-25/10/2026 para VALIDACION.md.
// Uso: node tools/tabla-semana.ts <juego>   (juego: A_ajuste_aviles | B_ticon_aviles | ...)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { horaMadrid, zonaMadrid, partesMadrid } from '../src/tiempo.ts';

const v = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'data', 'validacion.json'), 'utf8'));
const juego = process.argv[2] ?? 'A_ajuste_aviles';
const det = v.juegos[juego].ihm.semana_18_25_oct_2026.detalle as {
  ihm: { t: number; altura: number; tipo: string }; pred: { t: number; altura: number }; dtMin: number; dhCm: number;
}[];
const fecha = (t: number) => { const p = partesMadrid(t); return `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')}`; };
console.log('| Día | Tipo | IHM oficial | Predicción | Δ tiempo (min) | IHM (m) | Predicción (m) | Δ altura (cm) |');
console.log('|---|---|---|---|---:|---:|---:|---:|');
for (const d of det) {
  const fuera = Math.abs(d.dtMin) > 10 || Math.abs(d.dhCm) > 15 ? ' **fuera**' : '';
  console.log(`| ${fecha(d.ihm.t)} | ${d.ihm.tipo} | ${horaMadrid(d.ihm.t)} ${zonaMadrid(d.ihm.t)} | ${horaMadrid(d.pred.t)} | ${d.dtMin.toFixed(1)} | ${d.ihm.altura.toFixed(2)} | ${d.pred.altura.toFixed(2)} | ${d.dhCm.toFixed(1)}${fuera} |`);
}
