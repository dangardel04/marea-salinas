// Genera src/tide/constantes.json, el juego de constantes que usa la aplicación.
// Uso: node tools/generar-constantes.ts [ticon|ajuste]   (por defecto: ticon)
//
//   ticon  → TICON-4 «Aviles» (publicado; coincide con la tabla oficial del IHM)
//   ajuste → mínimos cuadrados con 1 año del radar REDMAR Avilés (coincide mejor con lo medido hoy)
//
// En ambos casos:
//   z0Ch        = media de la curva oficial del IHM en 2026 = nivel medio sobre el cero hidrográfico
//   z0CeroPuerto = Z0 del ajuste a las observaciones = nivel medio sobre el cero del puerto (REDMAR)
// La diferencia entre ambos es la estimación (no oficial) del desnivel entre los dos ceros.
// Ver VALIDACION.md para los números que justifican cada opción.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stationsById } from '@neaps/tide-database';

const RAIZ = join(import.meta.dirname, '..');
const opcion = (process.argv[2] ?? 'ticon') as 'ticon' | 'ajuste';
const validacion = JSON.parse(readFileSync(join(RAIZ, 'data', 'validacion.json'), 'utf8'));
const ajuste = JSON.parse(readFileSync(join(RAIZ, 'data', 'constantes_aviles_ajuste.json'), 'utf8'));

const z0Ch = +validacion.z0SobreCh.aviles.z0.toFixed(4);
const z0CeroPuerto = ajuste.z0;

let constituyentes: { name: string; amplitude: number; phase: number }[];
let fuente: string;
if (opcion === 'ticon') {
  const s = stationsById.get('ticon/avilestg-avi-esp-cmems');
  if (!s) throw new Error('No encuentro TICON-4 Aviles en @neaps/tide-database');
  constituyentes = s.harmonic_constituents.map((c: { name: string; amplitude: number; phase: number }) => ({
    name: c.name, amplitude: +c.amplitude.toFixed(5), phase: +c.phase.toFixed(3),
  }));
  fuente = `${s.attribution} Periodo de datos: ${s.epoch.start} a ${s.epoch.end}.`;
} else {
  constituyentes = ajuste.constituyentes.map(({ name, amplitude, phase }: { name: string; amplitude: number; phase: number }) => ({ name, amplitude, phase }));
  fuente = `${ajuste.fuenteDatos}. ${ajuste.metodo}. Periodo ${ajuste.periodo.desde} a ${ajuste.periodo.hasta}.`;
}

const salida = {
  opcion,
  fuente,
  z0Ch,
  z0ChOrigen: 'Media de la curva oficial del IHM (Avilés, cada 5 min) en el año natural 2026',
  z0CeroPuerto,
  z0CeroPuertoOrigen: 'Z0 del ajuste por mínimos cuadrados a REDMAR Avilés 2 (01/10/2025-17/10/2026), sobre el cero del puerto',
  constituyentes,
};
writeFileSync(join(RAIZ, 'src', 'tide', 'constantes.json'), JSON.stringify(salida, null, 1));
console.log(`src/tide/constantes.json ← ${opcion}: ${constituyentes.length} constituyentes, Z0 CH ${z0Ch} m, Z0 cero puerto ${z0CeroPuerto} m`);
