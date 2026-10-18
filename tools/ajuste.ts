// Análisis armónico por mínimos cuadrados de una serie observada.
// Uso: node tools/ajuste.ts <estacion> [desde AAAA-MM-DD] [hasta AAAA-MM-DD]
//   estacion: aviles | gijon (lee data/obs_<estacion>_10min.csv)
//   aviles-hibrido: Avilés, pero con los constituyentes de periodo largo (SA, SSA, MM, MF,
//     MSF, MTM, MSQM) tomados del ajuste largo de Gijón (data/constantes_gijon_ajuste.json):
//     se restan de la serie de Avilés y se ajusta el resto. Ver VALIDACION.md §8.
// Escribe data/constantes_<estacion>_ajuste.json (o data/constantes_aviles_hibrido.json).
// El método está en tools/lib/armonico.ts.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ajustar, type Constituyente } from './lib/armonico.ts';
import { crearMotor } from '../src/tide/motor.ts';

const RAIZ = join(import.meta.dirname, '..');
const [modo = 'aviles', desdeArg, hastaArg] = process.argv.slice(2);
const hibrido = modo === 'aviles-hibrido';
const estacion = hibrido ? 'aviles' : modo;
const LARGO = ['SA', 'SSA', 'MM', 'MF', 'MSF', 'MTM', 'MSQM'];

const desde = desdeArg ? Date.parse(desdeArg + 'T00:00:00Z') : -Infinity;
const hasta = hastaArg ? Date.parse(hastaArg + 'T00:00:00Z') : Infinity;
const T: number[] = [];
const H: number[] = [];
for (const l of readFileSync(join(RAIZ, 'data', `obs_${estacion}_10min.csv`), 'utf8').trim().split('\n').slice(1)) {
  const [, seg, nivel] = l.split(',');
  const t = Number(seg) * 1000;
  if (t >= desde && t < hasta) { T.push(t); H.push(Number(nivel)); }
}
const n = T.length;
console.log(`${estacion}: ${n} valores de 10 min, ${new Date(T[0]).toISOString()} → ${new Date(T[n - 1]).toISOString()} (${((T[n - 1] - T[0]) / 86_400_000).toFixed(1)} días)`);

let largos: Constituyente[] = [];
if (hibrido) {
  const gij = JSON.parse(readFileSync(join(RAIZ, 'data', 'constantes_gijon_ajuste.json'), 'utf8'));
  largos = (gij.constituyentes as Constituyente[]).filter((c) => LARGO.includes(c.name)).map(({ name, amplitude, phase }) => ({ name, amplitude, phase }));
  const mL = crearMotor({ z0: 0, constituyentes: largos });
  for (let i = 0; i < n; i++) H[i] -= mL.altura(T[i]);
  console.log(`periodo largo de Gijón (${gij.periodo.desde.slice(0, 10)} a ${gij.periodo.hasta.slice(0, 10)}): ${largos.map((c) => `${c.name} ${c.amplitude.toFixed(3)} m ${c.phase.toFixed(1)}°`).join(', ')}`);
}
const r = ajustar(T, H, { errores: true, excluir: hibrido ? LARGO : [] });
r.constituyentes = [...r.constituyentes, ...largos].sort((u, v) => v.amplitude - u.amplitude);
console.log(`constituyentes: ${r.constituyentes.length}; no separables con esta duración: ${r.noSeparables.join(' ') || 'ninguno'}`);

const salida = {
  estacion: modo,
  fuenteDatos: hibrido
    ? 'Puertos del Estado, REDMAR, Avilés 2 (3107) para los constituyentes rápidos y Gijón 2 (3108, 2021-2026) para los de periodo largo; StationData minutal, QC=1, medias de 10 min'
    : estacion === 'aviles'
    ? 'Puertos del Estado, REDMAR, mareógrafo Avilés 2 (3107), StationData minutal, QC=1, medias de 10 min'
    : 'Puertos del Estado, REDMAR, mareógrafo Gijón 2 (3108), StationData minutal, QC=1, medias de 10 min',
  referenciaAlturas: 'cero REDMAR de la estación («Cero del Puerto»)',
  metodo: 'Mínimos cuadrados (ecuaciones normales + Cholesky), astronomía y correcciones nodales IHO de @neaps/tide-predictor 0.11.0, selección por Rayleigh R=1. Ver tools/lib/armonico.ts',
  periodo: { desde: new Date(T[0]).toISOString(), hasta: new Date(T[n - 1]).toISOString(), valores: n },
  z0: +r.z0.toFixed(4),
  residuo: { rms_m: +r.rms.toFixed(4), max_abs_m: +r.maxAbs.toFixed(3) },
  noSeparables: r.noSeparables,
  constituyentes: r.constituyentes,
};
const destino = join(RAIZ, 'data', hibrido ? 'constantes_aviles_hibrido.json' : `constantes_${estacion}_ajuste.json`);
writeFileSync(destino, JSON.stringify(salida, null, 1));
console.log(`Z0 = ${salida.z0} m, residuo RMS = ${(r.rms * 100).toFixed(1)} cm, máx = ${(r.maxAbs * 100).toFixed(0)} cm`);
console.log(r.constituyentes.slice(0, 12).map((c) => `${c.name} ${c.amplitude.toFixed(3)} m ${c.phase.toFixed(1)}°`).join(' | '));
console.log(`→ ${destino}`);
