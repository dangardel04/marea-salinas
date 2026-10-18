// ¿Qué juego de constantes se acerca más a la marea medida en Avilés?
// Uso: node tools/comparar-realidad.ts      → escribe data/comparacion_realidad.json
//
// Validación cruzada dejando un mes fuera: para cada mes de observaciones de Avilés
// (01/10/2025-17/10/2026) se ajusta cada candidato SIN ese mes y se evalúa en ese mes.
// Así todos los errores son fuera de muestra. Candidatos:
//   A  ajuste propio con el radar de Avilés
//   B  TICON-4 «Aviles» (constantes publicadas; solo se ajusta Z0)
//   G  ajuste con 5,8 años del radar de Gijón aplicado tal cual en Avilés (Z0 de Avilés)
//   E  híbrido (activo): periodo largo (SA, SSA, MM, MF, MSF, MTM, MSQM) de Gijón y el resto ajustado en Avilés
// Métricas: residuo (observado − predicho), pleamares/bajamares observadas y backtest de la
// corrección en vivo (τ = 72 h, la misma que usa la aplicación).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stationsById } from '@neaps/tide-database';
import { ajustar, type Constituyente } from './lib/armonico.ts';
import { crearMotor } from '../src/tide/motor.ts';

const RAIZ = join(import.meta.dirname, '..');
const MIN = 60_000, HORA = 3_600_000;
const TAU = 72 * HORA;
const LARGO = ['SA', 'SSA', 'MM', 'MF', 'MSF', 'MTM', 'MSQM'];

function leer(est: string) {
  const T: number[] = [], H: number[] = [];
  for (const l of readFileSync(join(RAIZ, 'data', `obs_${est}_10min.csv`), 'utf8').trim().split('\n').slice(1)) {
    const [, s, h] = l.split(',');
    T.push(Number(s) * 1000); H.push(Number(h));
  }
  return { T, H };
}
const avi = leer('aviles');
const gij = leer('gijon');
const ticon: Constituyente[] = stationsById.get('ticon/avilestg-avi-esp-cmems')!.harmonic_constituents
  .map((c: Constituyente) => ({ name: c.name, amplitude: c.amplitude, phase: c.phase }));

// Meses (UTC) con datos en Avilés.
const meses: [number, number][] = [];
for (let a = new Date(Date.UTC(2025, 9, 1)); a.getTime() < avi.T[avi.T.length - 1]; ) {
  const b = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 1));
  meses.push([a.getTime(), b.getTime()]);
  a = b;
}

const sub = (s: { T: number[]; H: number[] }, f: (t: number) => boolean) => {
  const T: number[] = [], H: number[] = [];
  s.T.forEach((t, i) => { if (f(t)) { T.push(t); H.push(s.H[i]); } });
  return { T, H };
};
const sinZ0 = (c: Constituyente[]) => crearMotor({ z0: 0, constituyentes: c });
const media = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;

type Nombre = 'A' | 'B' | 'G' | 'E';
const pred: Record<Nombre, Map<number, number>> = { A: new Map(), B: new Map(), G: new Map(), E: new Map() };

for (const [ini, fin] of meses) {
  const fuera = (t: number) => t < ini || t >= fin;
  const entAvi = sub(avi, fuera);
  const prueba = sub(avi, (t) => !fuera(t));
  if (!prueba.T.length) continue;
  const durAvi = (entAvi.T[entAvi.T.length - 1] - entAvi.T[0]) / HORA;

  // A: ajuste propio en Avilés.
  const a = ajustar(entAvi.T, entAvi.H, { duracionH: durAvi });
  const mA = crearMotor({ z0: a.z0, constituyentes: a.constituyentes });

  // B: TICON, con el Z0 medio de los meses de entrenamiento.
  const mB0 = sinZ0(ticon);
  const z0B = media(entAvi.T.map((t, i) => entAvi.H[i] - mB0.altura(t)));

  // G y E: ajuste en Gijón (sin el mes de prueba).
  const entGij = sub(gij, fuera);
  const g = ajustar(entGij.T, entGij.H);
  const mC0 = sinZ0(g.constituyentes);
  const z0C = media(entAvi.T.map((t, i) => entAvi.H[i] - mC0.altura(t)));

  const largos = g.constituyentes.filter((c) => LARGO.includes(c.name));
  const mL = sinZ0(largos);
  const d = ajustar(entAvi.T, entAvi.H.map((h, i) => h - mL.altura(entAvi.T[i])), { duracionH: durAvi, excluir: LARGO });
  const mD = crearMotor({ z0: d.z0, constituyentes: [...d.constituyentes, ...largos] });

  prueba.T.forEach((t) => {
    pred.A.set(t, mA.altura(t));
    pred.B.set(t, z0B + mB0.altura(t));
    pred.G.set(t, z0C + mC0.altura(t));
    pred.E.set(t, mD.altura(t));
  });
  process.stdout.write(`\rmes ${new Date(ini).toISOString().slice(0, 7)} listo   `);
}
process.stdout.write('\n');

// ---------- Métricas ----------
const obs = new Map(avi.T.map((t, i) => [t, avi.H[i]]));
const rms = (v: number[]) => Math.sqrt(media(v.map((x) => x * x)));

/** Pleamares/bajamares de una serie de 10 min: extremos de la media móvil de 50 min en ±3 h. */
function extremos(serie: Map<number, number>) {
  const ts = [...serie.keys()].sort((x, y) => x - y);
  const suave = new Map<number, number>();
  for (const t of ts) {
    const v = [-2, -1, 0, 1, 2].map((k) => serie.get(t + k * 10 * MIN));
    if (v.every((x) => x !== undefined)) suave.set(t, media(v as number[]));
  }
  const out: { t: number; h: number; tipo: string }[] = [];
  for (const t of ts) {
    const c = suave.get(t);
    if (c === undefined) continue;
    let max = true, min = true, completo = true;
    for (let k = -18; k <= 18 && completo; k++) {
      const v = suave.get(t + k * 10 * MIN);
      if (v === undefined) { completo = false; break; }
      if (v > c) max = false;
      if (v < c) min = false;
    }
    if (!completo) continue;
    if (max) out.push({ t, h: serie.get(t)!, tipo: 'pleamar' });
    if (min) out.push({ t, h: serie.get(t)!, tipo: 'bajamar' });
  }
  return out;
}
const exObs = extremos(obs);

const resultado: Record<string, unknown> = {
  metodo: 'Validación cruzada dejando un mes fuera sobre REDMAR Avilés (data/obs_aviles_10min.csv). Ver cabecera de tools/comparar-realidad.ts.',
  meses: meses.length,
  candidatos: {},
};
const PLAZOS = [1, 3, 6, 12, 24];

for (const nombre of ['E', 'A', 'G', 'B'] as Nombre[]) {
  const p = pred[nombre];
  const res = new Map<number, number>();
  for (const [t, h] of p) res.set(t, obs.get(t)! - h);
  const r = [...res.values()];

  // Extremos: compara cada extremo observado con el del mismo tipo en la serie predicha.
  const exPred = extremos(p);
  const dt: number[] = [], dh: number[] = [];
  for (const e of exObs) {
    const c = exPred.filter((x) => x.tipo === e.tipo && Math.abs(x.t - e.t) < 3 * HORA);
    if (!c.length) continue;
    const m = c.reduce((u, v) => (Math.abs(v.t - e.t) < Math.abs(u.t - e.t) ? v : u));
    dt.push((m.t - e.t) / MIN); dh.push((m.h - e.h) * 100);
  }

  // Backtest de la corrección en vivo con las predicciones fuera de muestra.
  const errCon: Record<number, number[]> = {}, errSin: Record<number, number[]> = {};
  const ts = [...res.keys()].sort((x, y) => x - y);
  for (let t0 = Math.ceil(ts[0] / HORA) * HORA + HORA; t0 < ts[ts.length - 1]; t0 += HORA) {
    const ult = [0, 1, 2, 3, 4, 5].map((k) => res.get(t0 - k * 10 * MIN)).filter((x): x is number => x !== undefined).sort((x, y) => x - y);
    if (ult.length < 4) continue;
    const r0 = ult[Math.floor(ult.length / 2)];
    for (const L of PLAZOS) {
      const real = res.get(t0 + L * HORA);
      if (real === undefined) continue;
      (errSin[L] ??= []).push(real);
      (errCon[L] ??= []).push(real - r0 * Math.exp(-(L * HORA) / TAU));
    }
  }

  const fila = {
    residuoRmsCm: +(100 * rms(r)).toFixed(2),
    residuoSesgoCm: +(100 * media(r)).toFixed(2),
    extremos: dt.length,
    tiempoRmsMin: +rms(dt).toFixed(2),
    tiempoMediaMin: +media(dt).toFixed(2),
    alturaRmsCm: +rms(dh).toFixed(2),
    corregidoRmsCm: Object.fromEntries(PLAZOS.map((L) => [L, +(100 * rms(errCon[L])).toFixed(2)])),
  };
  (resultado.candidatos as Record<string, unknown>)[nombre] = fila;
  console.log(`${nombre}: residuo ${fila.residuoRmsCm} cm (sesgo ${fila.residuoSesgoCm}), extremos ${fila.extremos}: ${fila.tiempoRmsMin} min / ${fila.alturaRmsCm} cm, con corrección ${JSON.stringify(fila.corregidoRmsCm)}`);
}
writeFileSync(join(RAIZ, 'data', 'comparacion_realidad.json'), JSON.stringify(resultado, null, 1));
