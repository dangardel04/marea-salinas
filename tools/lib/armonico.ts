// Análisis armónico por mínimos cuadrados (función reutilizable por tools/ajuste.ts y
// tools/comparar-realidad.ts).
//
//   h(t) = Z0 + Σ fᵢ(t)·[aᵢ·cos θᵢ(t) + bᵢ·sin θᵢ(t)],   θᵢ = V0ᵢ + ωᵢ·Δt + uᵢ
//   con V0, ω, f, u de @neaps/tide-predictor (los mismos que usa src/tide/armonicos.ts).
//   Amplitud A = √(a²+b²), desfase de Greenwich g = atan2(b, a).
//   Selección: lista candidata en orden de importancia; se acepta cada constituyente si su
//   frecuencia se separa de todas las ya aceptadas al menos 1/T (Rayleigh, R = 1).

import { astro, constituents as MODELOS } from '@neaps/tide-predictor';

// Orden de importancia habitual en el Atlántico NE. Solo decide qué entra antes si dos
// constituyentes no se pueden separar.
export const CANDIDATOS = [
  'M2', 'S2', 'N2', 'K2', 'K1', 'O1', 'P1', 'Q1', 'M4', 'MS4', 'MN4', 'SA', 'SSA',
  '2N2', 'MU2', 'NU2', 'L2', 'T2', 'LAMBDA2', 'MKS2', '2SM2', 'J1', 'OO1', 'M1', '2Q1', 'RHO1', 'S1',
  'M3', 'MK3', '2MK3', 'S4', 'N4', 'MK4', 'SN4', 'M6', '2MS6', '2MN6', 'MSN6', 'M8',
  'MM', 'MF', 'MSF', 'MSM', 'MTM', 'MSQM', 'EP2', 'R2', 'MA2', 'MB2', 'SGM', '3N2', '3L2',
  'S3', 'T3', 'R3', '2MK5', '2MO5', 'MO3', 'SO3', 'SK3',
];

const D2R = Math.PI / 180;
const DIA_MS = 86_400_000;
const HORA_MS = 3_600_000;

export interface Constituyente { name: string; amplitude: number; phase: number; errorAmplitudBlanco?: number }
export interface ResultadoAjuste {
  z0: number;
  constituyentes: Constituyente[];
  noSeparables: string[];
  rms: number;
  maxAbs: number;
  n: number;
}

/** Selección por Rayleigh para una serie de duración `duracionH` horas. */
export function seleccionar(duracionH: number, excluir: string[] = []) {
  const elegidos: string[] = [];
  const descartados: string[] = [];
  for (const nombre of CANDIDATOS) {
    if (excluir.includes(nombre)) continue;
    const m = MODELOS[nombre];
    if (!m) { descartados.push(`${nombre} (sin definición)`); continue; }
    const sep = Math.min(Math.abs(m.speed) * duracionH / 360, ...elegidos.map((e) => Math.abs(MODELOS[e].speed - m.speed) * duracionH / 360));
    if (sep >= 1) elegidos.push(nombre);
    else descartados.push(nombre);
  }
  return { elegidos, descartados };
}

function cholesky(M: Float64Array, d: number): Float64Array {
  const L = new Float64Array(d * d);
  for (let i = 0; i < d; i++) {
    for (let j = 0; j <= i; j++) {
      let s = M[i * d + j];
      for (let q = 0; q < j; q++) s -= L[i * d + q] * L[j * d + q];
      if (i === j) {
        if (s <= 0) throw new Error('Matriz no definida positiva: constituyentes no separables');
        L[i * d + i] = Math.sqrt(s);
      } else L[i * d + j] = s / L[j * d + j];
    }
  }
  return L;
}
function resolver(L: Float64Array, b: Float64Array, d: number): Float64Array {
  const y = new Float64Array(d);
  for (let i = 0; i < d; i++) { let s = b[i]; for (let q = 0; q < i; q++) s -= L[i * d + q] * y[q]; y[i] = s / L[i * d + i]; }
  const x = new Float64Array(d);
  for (let i = d - 1; i >= 0; i--) { let s = y[i]; for (let q = i + 1; q < d; q++) s -= L[q * d + i] * x[q]; x[i] = s / L[i * d + i]; }
  return x;
}

/**
 * Ajusta las constantes a la serie (T en ms UTC, H en m).
 * `duracionH` fija la duración para el criterio de Rayleigh (por defecto, la de la serie);
 * `excluir` deja fuera constituyentes que se van a tomar de otra fuente.
 */
export function ajustar(T: number[], H: number[], opciones: { duracionH?: number; excluir?: string[]; errores?: boolean } = {}): ResultadoAjuste {
  const n = T.length;
  const duracionH = opciones.duracionH ?? (T[n - 1] - T[0]) / HORA_MS;
  const { elegidos, descartados } = seleccionar(duracionH, opciones.excluir);
  const k = elegidos.length;
  const p = 1 + 2 * k;
  const AtA = new Float64Array(p * p);
  const Atb = new Float64Array(p);
  const fila = new Float64Array(p);
  const modelos = elegidos.map((e) => MODELOS[e]);
  const W = Float64Array.from(modelos, (m) => m.speed * D2R);
  const V0 = new Float64Array(k), F = new Float64Array(k), U = new Float64Array(k);
  let diaCache = NaN;

  function rellenarFila(t: number) {
    const dia = Math.floor(t / DIA_MS);
    if (dia !== diaCache) {
      diaCache = dia;
      const aBase = astro(new Date(dia * DIA_MS));
      const aCorr = astro(new Date(dia * DIA_MS + DIA_MS / 2));
      modelos.forEach((m, i) => {
        const c = m.correction(aCorr);
        V0[i] = m.value(aBase) * D2R; F[i] = c.f; U[i] = c.u * D2R;
      });
    }
    const h = (t - dia * DIA_MS) / HORA_MS;
    fila[0] = 1;
    for (let i = 0; i < k; i++) {
      const th = V0[i] + W[i] * h + U[i];
      fila[1 + 2 * i] = F[i] * Math.cos(th);
      fila[2 + 2 * i] = F[i] * Math.sin(th);
    }
  }

  for (let r = 0; r < n; r++) {
    rellenarFila(T[r]);
    for (let i = 0; i < p; i++) {
      const fi = fila[i];
      Atb[i] += fi * H[r];
      for (let j = i; j < p; j++) AtA[i * p + j] += fi * fila[j];
    }
  }
  for (let i = 0; i < p; i++) for (let j = 0; j < i; j++) AtA[i * p + j] = AtA[j * p + i];
  const L = cholesky(AtA, p);
  const x = resolver(L, Atb, p);

  let ss = 0, maxAbs = 0;
  for (let r = 0; r < n; r++) {
    rellenarFila(T[r]);
    let pred = 0;
    for (let i = 0; i < p; i++) pred += fila[i] * x[i];
    const e = H[r] - pred;
    ss += e * e;
    maxAbs = Math.max(maxAbs, Math.abs(e));
  }
  const rms = Math.sqrt(ss / (n - p));
  // Error típico aproximado (supone ruido blanco: lo subestima, el residuo real tiene memoria).
  const diagInversa = (i: number) => { const e = new Float64Array(p); e[i] = 1; return resolver(L, e, p)[i]; };

  const constituyentes = elegidos.map((nombre, i) => {
    const a = x[1 + 2 * i], b = x[2 + 2 * i];
    const c: Constituyente = { name: nombre, amplitude: +Math.hypot(a, b).toFixed(5), phase: +((((Math.atan2(b, a) / D2R) % 360) + 360) % 360).toFixed(3) };
    if (opciones.errores) c.errorAmplitudBlanco = +(rms * Math.sqrt((diagInversa(1 + 2 * i) + diagInversa(2 + 2 * i)) / 2)).toFixed(5);
    return c;
  }).sort((u, v) => v.amplitude - u.amplitude);

  return { z0: x[0], constituyentes, noSeparables: descartados, rms, maxAbs, n };
}
