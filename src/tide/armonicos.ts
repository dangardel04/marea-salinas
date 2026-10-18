// Evaluación armónica de la marea astronómica.
//
//   h(t) = Z0 + Σ fᵢ·Aᵢ·cos(V0ᵢ + ωᵢ·(t − t0) + uᵢ − gᵢ)
//
// Aᵢ y gᵢ son la amplitud y el desfase de Greenwich (grados, referido a UTC) de cada
// constituyente; V0, ω, f y u salen de las definiciones astronómicas de
// @neaps/tide-predictor (IHO TWCWG, correcciones nodales IHO por defecto), que es
// también lo que usa el ajuste por mínimos cuadrados de tools/ajuste.ts: así las
// constantes se calculan y se usan con exactamente la misma astronomía.

import { astro, constituents as MODELOS } from '@neaps/tide-predictor';

export interface Constituyente {
  /** Nombre IHO/NOAA en mayúsculas (M2, S2, K1…). */
  name: string;
  /** Amplitud en metros. */
  amplitude: number;
  /** Desfase de Greenwich g en grados (UTC). */
  phase: number;
}

export interface ConjuntoArmonico {
  /** Nivel medio sobre la referencia de alturas, en metros. */
  z0: number;
  constituyentes: Constituyente[];
}

/** Parámetros ya listos para un día: término i = A·cos(w·horas + phi). */
interface ParametrosDia {
  t0: number; // ms UTC del inicio del día
  A: Float64Array;
  w: Float64Array; // rad/hora
  phi: Float64Array; // rad
}

const D2R = Math.PI / 180;
const DIA_MS = 86_400_000;
const HORA_MS = 3_600_000;

export function nombresDesconocidos(c: Constituyente[]): string[] {
  return c.filter((k) => !(k.name in MODELOS)).map((k) => k.name);
}

/**
 * Crea un evaluador rápido de h(t). Precalcula los parámetros por día UTC
 * (V0 al inicio del día, f y u a mediodía) y los guarda en caché.
 */
export function crearEvaluador(conjunto: ConjuntoArmonico) {
  const desconocidos = nombresDesconocidos(conjunto.constituyentes);
  if (desconocidos.length) throw new Error(`Constituyentes sin definición astronómica: ${desconocidos.join(', ')}`);
  const lista = conjunto.constituyentes.filter((c) => c.amplitude > 0);
  const cache = new Map<number, ParametrosDia>();

  function parametros(dia: number): ParametrosDia {
    let p = cache.get(dia);
    if (p) return p;
    const t0 = dia * DIA_MS;
    const aBase = astro(new Date(t0));
    const aCorr = astro(new Date(t0 + DIA_MS / 2));
    const n = lista.length;
    p = { t0, A: new Float64Array(n), w: new Float64Array(n), phi: new Float64Array(n) };
    for (let i = 0; i < n; i++) {
      const c = lista[i];
      const m = MODELOS[c.name];
      const { f, u } = m.correction(aCorr);
      p.A[i] = c.amplitude * f;
      p.w[i] = m.speed * D2R;
      p.phi[i] = (m.value(aBase) + u - c.phase) * D2R;
    }
    if (cache.size > 64) cache.clear(); // evita crecer sin límite al recorrer años
    cache.set(dia, p);
    return p;
  }

  /** Altura (m) en el instante t (ms UTC). */
  function altura(t: number): number {
    const p = parametros(Math.floor(t / DIA_MS));
    const h = (t - p.t0) / HORA_MS;
    let s = conjunto.z0;
    for (let i = 0; i < p.A.length; i++) s += p.A[i] * Math.cos(p.w[i] * h + p.phi[i]);
    return s;
  }

  /** Derivada dh/dt en m/hora. */
  function derivada(t: number): number {
    const p = parametros(Math.floor(t / DIA_MS));
    const h = (t - p.t0) / HORA_MS;
    let s = 0;
    for (let i = 0; i < p.A.length; i++) s -= p.A[i] * p.w[i] * Math.sin(p.w[i] * h + p.phi[i]);
    return s;
  }

  return { altura, derivada };
}
