// Análisis armónico por mínimos cuadrados de una serie observada.
// Uso: node tools/ajuste.ts <estacion> [desde AAAA-MM-DD] [hasta AAAA-MM-DD]
//   estacion: aviles | gijon (lee data/obs_<estacion>_10min.csv)
// Escribe data/constantes_<estacion>_ajuste.json
//
// Método (ver VALIDACION.md):
//   h(t) = Z0 + Σ fᵢ(t)·[aᵢ·cos θᵢ(t) + bᵢ·sin θᵢ(t)],   θᵢ = V0ᵢ + ωᵢ·Δt + uᵢ
//   con V0, ω, f, u de @neaps/tide-predictor (los mismos que usa src/tide/armonicos.ts).
//   Amplitud A = √(a²+b²), desfase de Greenwich g = atan2(b, a).
//   Selección de constituyentes: lista candidata en orden de importancia; se acepta
//   cada uno si su frecuencia se separa de todas las ya aceptadas al menos 1/T
//   (criterio de Rayleigh con R = 1, T = duración de la serie).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { astro, constituents as MODELOS } from '@neaps/tide-predictor';

const RAIZ = join(import.meta.dirname, '..');
const [estacion = 'aviles', desdeArg, hastaArg] = process.argv.slice(2);

// Orden de importancia habitual en el Atlántico NE (semidiurnas y diurnas principales,
// aguas someras, de largo periodo y menores). Solo decide qué entra antes si dos
// constituyentes no se pueden separar.
const CANDIDATOS = [
  'M2', 'S2', 'N2', 'K2', 'K1', 'O1', 'P1', 'Q1', 'M4', 'MS4', 'MN4', 'SA', 'SSA',
  '2N2', 'MU2', 'NU2', 'L2', 'T2', 'LAMBDA2', 'MKS2', '2SM2', 'J1', 'OO1', 'M1', '2Q1', 'RHO1', 'S1',
  'M3', 'MK3', '2MK3', 'S4', 'N4', 'MK4', 'SN4', 'M6', '2MS6', '2MN6', 'MSN6', 'M8',
  'MM', 'MF', 'MSF', 'MSM', 'MTM', 'MSQM', 'EP2', 'R2', 'MA2', 'MB2', 'SGM', '3N2', '3L2',
  'S3', 'T3', 'R3', '2MK5', '2MO5', 'MO3', 'SO3', 'SK3',
];

const D2R = Math.PI / 180;
const DIA_MS = 86_400_000;
const HORA_MS = 3_600_000;

// ---------- Lectura ----------
const lineas = readFileSync(join(RAIZ, 'data', `obs_${estacion}_10min.csv`), 'utf8').trim().split('\n').slice(1);
const desde = desdeArg ? Date.parse(desdeArg + 'T00:00:00Z') : -Infinity;
const hasta = hastaArg ? Date.parse(hastaArg + 'T00:00:00Z') : Infinity;
const T: number[] = [];
const H: number[] = [];
for (const l of lineas) {
  const [, seg, nivel] = l.split(',');
  const t = Number(seg) * 1000;
  if (t >= desde && t < hasta) { T.push(t); H.push(Number(nivel)); }
}
const n = T.length;
const duracionH = (T[n - 1] - T[0]) / HORA_MS;
console.log(`${estacion}: ${n} valores de 10 min, ${new Date(T[0]).toISOString()} → ${new Date(T[n - 1]).toISOString()} (${(duracionH / 24).toFixed(1)} días)`);

// ---------- Selección por criterio de Rayleigh ----------
const elegidos: string[] = [];
const descartados: string[] = [];
for (const nombre of CANDIDATOS) {
  const m = MODELOS[nombre];
  if (!m) { descartados.push(`${nombre} (sin definición)`); continue; }
  const sep = Math.min(Infinity, Math.abs(m.speed) * duracionH / 360, ...elegidos.map((e) => Math.abs(MODELOS[e].speed - m.speed) * duracionH / 360));
  if (sep >= 1) elegidos.push(nombre);
  else descartados.push(nombre);
}
console.log(`constituyentes: ${elegidos.length} (${elegidos.join(' ')})`);
console.log(`no separables con esta duración: ${descartados.join(' ') || 'ninguno'}`);

// ---------- Matriz de diseño (ecuaciones normales) ----------
const k = elegidos.length;
const p = 1 + 2 * k;
const AtA = new Float64Array(p * p);
const Atb = new Float64Array(p);
const fila = new Float64Array(p);
const modelos = elegidos.map((e) => MODELOS[e]);
let diaCache = NaN;
let V0 = new Float64Array(k), F = new Float64Array(k), U = new Float64Array(k);
const W = Float64Array.from(modelos, (m) => m.speed * D2R);

function prepararDia(dia: number) {
  if (dia === diaCache) return;
  diaCache = dia;
  const aBase = astro(new Date(dia * DIA_MS));
  const aCorr = astro(new Date(dia * DIA_MS + DIA_MS / 2));
  modelos.forEach((m, i) => {
    const c = m.correction(aCorr);
    V0[i] = m.value(aBase) * D2R;
    F[i] = c.f;
    U[i] = c.u * D2R;
  });
}

function rellenarFila(t: number) {
  const dia = Math.floor(t / DIA_MS);
  prepararDia(dia);
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

// ---------- Cholesky ----------
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
const L = cholesky(AtA, p);
const x = resolver(L, Atb, p);

// ---------- Residuo ----------
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
function diagInversa(i: number): number {
  const e = new Float64Array(p); e[i] = 1;
  return resolver(L, e, p)[i];
}

const constituyentes = elegidos.map((nombre, i) => {
  const a = x[1 + 2 * i], b = x[2 + 2 * i];
  const A = Math.hypot(a, b);
  const g = ((Math.atan2(b, a) / D2R) % 360 + 360) % 360;
  const errA = rms * Math.sqrt((diagInversa(1 + 2 * i) + diagInversa(2 + 2 * i)) / 2);
  return { name: nombre, amplitude: +A.toFixed(5), phase: +g.toFixed(3), errorAmplitudBlanco: +errA.toFixed(5) };
}).sort((u, v) => v.amplitude - u.amplitude);

const salida = {
  estacion,
  fuenteDatos: estacion === 'aviles'
    ? 'Puertos del Estado, REDMAR, mareógrafo Avilés 2 (3107), StationData minutal, QC=1, medias de 10 min'
    : 'Puertos del Estado, REDMAR, mareógrafo Gijón 2 (3108), StationData minutal, QC=1, medias de 10 min',
  referenciaAlturas: 'cero REDMAR de la estación («Cero del Puerto»)',
  metodo: 'Mínimos cuadrados (ecuaciones normales + Cholesky), astronomía y correcciones nodales IHO de @neaps/tide-predictor 0.11.0, selección por Rayleigh R=1. Ver tools/ajuste.ts',
  periodo: { desde: new Date(T[0]).toISOString(), hasta: new Date(T[n - 1]).toISOString(), valores: n },
  z0: +x[0].toFixed(4),
  residuo: { rms_m: +rms.toFixed(4), max_abs_m: +maxAbs.toFixed(3) },
  noSeparables: descartados,
  constituyentes,
};
const destino = join(RAIZ, 'data', `constantes_${estacion}_ajuste.json`);
writeFileSync(destino, JSON.stringify(salida, null, 1));
console.log(`Z0 = ${salida.z0} m, residuo RMS = ${(rms * 100).toFixed(1)} cm, máx = ${(maxAbs * 100).toFixed(0)} cm`);
console.log(constituyentes.slice(0, 12).map((c) => `${c.name} ${c.amplitude.toFixed(3)} m ${c.phase.toFixed(1)}°`).join(' | '));
console.log(`→ ${destino}`);
