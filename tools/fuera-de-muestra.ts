// Prueba fuera de muestra: constantes ajustadas con REDMAR Avilés hasta el 01/07/2026
// frente a TICON-4 Avilés, evaluadas con las observaciones del 01/07 al 18/10/2026.
// Uso: node tools/ajuste.ts aviles 2025-10-01 2026-07-01 && cp data/constantes_aviles_ajuste.json data/raw/aviles_hasta_julio.json
//      node tools/ajuste.ts aviles && node tools/fuera-de-muestra.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stationsById } from '@neaps/tide-database';
import { crearMotor } from '../src/tide/motor.ts';

const RAIZ = join(import.meta.dirname, '..');
const parcial = JSON.parse(readFileSync(join(RAIZ, 'data', 'raw', 'aviles_hasta_julio.json'), 'utf8'));
const ticon = stationsById.get('ticon/avilestg-avi-esp-cmems')!.harmonic_constituents;
const obs = readFileSync(join(RAIZ, 'data', 'obs_aviles_10min.csv'), 'utf8').trim().split('\n').slice(1)
  .map((l) => { const [, s, h] = l.split(','); return { t: +s * 1000, h: +h }; })
  .filter((p) => p.t >= Date.UTC(2026, 6, 1));
for (const [nombre, c] of [['ajuste hasta julio', parcial.constituyentes], ['TICON-4 Avilés', ticon]] as const) {
  const m = crearMotor({ z0: 0, constituyentes: c });
  const r = obs.map((p) => p.h - m.altura(p.t));
  const media = r.reduce((s, x) => s + x, 0) / r.length;
  const rms = Math.sqrt(r.reduce((s, x) => s + (x - media) ** 2, 0) / r.length);
  console.log(`${nombre}: ${r.length} valores jul-oct 2026, residuo RMS (sin sesgo) ${(rms * 100).toFixed(1)} cm`);
}
