// Fase 5: ¿cuánto dura el residuo meteorológico? Backtest con un año de observaciones.
// Uso: node tools/residuo.ts [constantes.json] [desde AAAA-MM-DD] [salida.json]
//   Sin argumentos: src/tide/constantes.json, todo el periodo y data/residuo.json.
//
// residuo(t) = observado(t) − predicho(t), ambos sobre el cero del puerto de Avilés.
// Para cada instante de arranque t0 (cada hora) se toma r0 = mediana del residuo de la
// última hora y se "pronostica" el residuo a L horas como r0·exp(−L/τ). Se compara el
// error con no corregir (predicción astronómica sola) para varios τ y se elige el τ que
// minimiza el error medio en 0–12 h. Escribe data/residuo.json.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crearMotor } from '../src/tide/motor.ts';

const RAIZ = join(import.meta.dirname, '..');
const HORA = 3_600_000;
const [ficheroConst = join(RAIZ, 'src', 'tide', 'constantes.json'), desdeArg, salidaArg] = process.argv.slice(2);
const constantes = JSON.parse(readFileSync(ficheroConst, 'utf8'));
const desde = desdeArg ? Date.parse(desdeArg + 'T00:00:00Z') : -Infinity;
// Predicción sobre el cero de las observaciones (cero del puerto de Avilés). Admite el
// formato de src/tide/constantes.json (z0CeroPuerto) y el de tools/ajuste.ts (z0).
const motor = crearMotor({ z0: constantes.z0CeroPuerto ?? constantes.z0, constituyentes: constantes.constituyentes });

const obs = new Map<number, number>();
for (const l of readFileSync(join(RAIZ, 'data', 'obs_aviles_10min.csv'), 'utf8').trim().split('\n').slice(1)) {
  const [, s, h] = l.split(',');
  if (Number(s) * 1000 >= desde) obs.set(Number(s) * 1000, Number(h));
}
const res = new Map<number, number>();
for (const [t, h] of obs) res.set(t, h - motor.altura(t));

const mediana = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const tiempos = [...res.keys()].sort((a, b) => a - b);
const PLAZOS = [1, 2, 3, 6, 9, 12, 24];
const TAUS = [1, 2, 3, 4, 6, 8, 12, 18, 24, 36, 48, 72, 96, 168, 336];

// Autocorrelación del residuo (medias horarias) como dato complementario.
const horaria: number[] = [];
for (let t = Math.ceil(tiempos[0] / HORA) * HORA; t < tiempos[tiempos.length - 1]; t += HORA) {
  const v = res.get(t);
  horaria.push(v === undefined ? NaN : v);
}
function autocorr(lag: number) {
  let sxy = 0, sxx = 0, n = 0;
  const val = horaria.filter(Number.isFinite);
  const m = val.reduce((s, x) => s + x, 0) / val.length;
  for (let i = 0; i + lag < horaria.length; i++) {
    const a = horaria[i], b = horaria[i + lag];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    sxy += (a - m) * (b - m); sxx += (a - m) ** 2; n++;
  }
  return n ? sxy / sxx : NaN;
}
const acf = Object.fromEntries([1, 2, 3, 6, 12, 24, 48].map((l) => [l, +autocorr(l).toFixed(3)]));

// Backtest.
const sumaSin: Record<number, number> = {}, n: Record<number, number> = {};
const sumaCon: Record<number, Record<number, number>> = {};
for (const tau of TAUS) sumaCon[tau] = {};
for (let t0 = Math.ceil(tiempos[0] / HORA) * HORA + HORA; t0 < tiempos[tiempos.length - 1]; t0 += HORA) {
  const ultimos: number[] = [];
  for (let k = 0; k < 6; k++) { const v = res.get(t0 - k * 600_000); if (v !== undefined) ultimos.push(v); }
  if (ultimos.length < 4) continue;
  const r0 = mediana(ultimos);
  for (const L of PLAZOS) {
    const real = res.get(t0 + L * HORA);
    if (real === undefined) continue;
    sumaSin[L] = (sumaSin[L] ?? 0) + real ** 2;
    n[L] = (n[L] ?? 0) + 1;
    for (const tau of TAUS) sumaCon[tau][L] = (sumaCon[tau][L] ?? 0) + (real - r0 * Math.exp(-L / tau)) ** 2;
  }
}
const rmsSin = Object.fromEntries(PLAZOS.map((L) => [L, +(100 * Math.sqrt(sumaSin[L] / n[L])).toFixed(1)]));
const rmsCon = Object.fromEntries(TAUS.map((tau) => [tau, Object.fromEntries(PLAZOS.map((L) => [L, +(100 * Math.sqrt(sumaCon[tau][L] / n[L])).toFixed(1)]))]));
// Criterio: menor RMS medio en los plazos de 1 a 12 h.
const PLAZOS_CRITERIO = [1, 2, 3, 6, 9, 12];
const puntuar = (tau: number) => PLAZOS_CRITERIO.reduce((s, L) => s + rmsCon[tau][L], 0) / PLAZOS_CRITERIO.length;
const mejorTau = TAUS.reduce((a, b) => (puntuar(b) < puntuar(a) ? b : a));

const salida = {
  metodo: 'Backtest horario sobre data/obs_aviles_10min.csv con las constantes de ' + ficheroConst.replace(RAIZ, '.') + '; r0 = mediana del residuo de la última hora; pronóstico r0·exp(−L/τ).',
  periodo: { desde: new Date(tiempos[0]).toISOString(), hasta: new Date(tiempos[tiempos.length - 1]).toISOString() },
  arranques: n[1],
  residuoRmsCm: rmsSin[1],
  autocorrelacionResiduoHoraria: acf,
  rmsSinCorreccionCm: rmsSin,
  rmsConCorreccionCm: rmsCon,
  tauElegidoHoras: mejorTau,
};
writeFileSync(salidaArg ?? join(RAIZ, 'data', 'residuo.json'), JSON.stringify(salida, null, 1));
console.log('autocorrelación del residuo:', acf);
console.log('RMS sin corrección (cm) por plazo:', rmsSin);
console.log(`τ elegido = ${mejorTau} h →`, rmsCon[mejorTau]);
