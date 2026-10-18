// Fase 5: corrección en vivo con el mareógrafo REDMAR de Avilés.
//
// residuo = observado − predicho (ambos sobre el cero del puerto). Se toma la mediana del
// residuo de la última hora disponible (r0, en t0) y se aplica a la predicción como
//   corrección(t) = r0 · exp(−|t − t0| / τ),   τ = 72 h
// τ sale del backtest de tools/residuo.ts (VALIDACION.md §5), no de un valor supuesto.
// También hacia atrás: el residuo cambia despacio y su autocorrelación es simétrica en el
// tiempo, así que la misma atenuación vale antes de t0 (y la curva no da un salto en t0).

import constantes from './constantes.json';
import { MAREOGRAFO_AVILES } from '../config.ts';
import type { Motor } from './motor.ts';

export const TAU_HORAS = 72;
/** Si la última observación tiene más de 3 h, no se corrige (dato viejo). */
const ANTIGUEDAD_MAX_MS = 3 * 3_600_000;
/** Mínimo de valores minutales en la última hora para fiarse de la mediana. */
const MIN_VALORES = 20;

export interface Correccion {
  /** Residuo (m) en t0. */
  r0: number;
  /** Instante (ms UTC) de la última observación usada. */
  t0: number;
  /** Último nivel observado, m sobre el CH (convertido con el desnivel estimado). */
  ultimoObservadoCh: number;
  valores: number;
}

/** Desnivel estimado cero del puerto − CH (VALIDACION.md §7: estimación, no dato oficial). */
export const DESNIVEL_CERO_PUERTO_SOBRE_CH = constantes.z0CeroPuerto - constantes.z0Ch;

const aaaammddhhmm = (t: number) => {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}@${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
};

/** Pide a Portus las observaciones de las últimas 3 h. Devuelve pares [ms UTC, m sobre el cero del puerto]. */
export async function leerObservaciones(ahora: number, señal?: AbortSignal): Promise<[number, number][]> {
  const url = `https://poem.puertos.es/portus/StationData?code=${MAREOGRAFO_AVILES.id}&params=SeaLevel`
    + `&from=${aaaammddhhmm(ahora - 3 * 3_600_000)}&to=${aaaammddhhmm(ahora + 600_000)}`;
  const r = await fetch(url, { signal: señal });
  if (!r.ok) throw new Error(`Portus respondió ${r.status}`);
  const json = await r.json() as [unknown, [number, [number, number]][]];
  return json[1].filter(([, [v, qc]]) => qc === 1 && Number.isFinite(v)).map(([s, [v]]) => [s * 1000, v]);
}

/** Calcula la corrección a partir de observaciones ya descargadas. */
export function calcularCorreccion(obs: [number, number][], motorCh: Motor, ahora: number): Correccion | null {
  if (!obs.length) return null;
  const t0 = obs[obs.length - 1][0];
  if (ahora - t0 > ANTIGUEDAD_MAX_MS) return null;
  const ultimaHora = obs.filter(([t]) => t > t0 - 3_600_000);
  if (ultimaHora.length < MIN_VALORES) return null;
  // Predicción sobre el cero del puerto = predicción sobre el CH + desnivel.
  const residuos = ultimaHora.map(([t, v]) => v - (motorCh.altura(t) + DESNIVEL_CERO_PUERTO_SOBRE_CH)).sort((a, b) => a - b);
  const r0 = residuos[Math.floor(residuos.length / 2)];
  return { r0, t0, ultimoObservadoCh: obs[obs.length - 1][1] - DESNIVEL_CERO_PUERTO_SOBRE_CH, valores: ultimaHora.length };
}

/** Corrección (m) a sumar a la predicción en el instante t. */
export function correccionEn(c: Correccion | null, t: number): number {
  if (!c) return 0;
  return c.r0 * Math.exp(-Math.abs(t - c.t0) / (TAU_HORAS * 3_600_000));
}
