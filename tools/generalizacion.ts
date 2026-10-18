// ¿Predice mejor el año siguiente un ajuste de 1 año o uno que toma el periodo largo de
// varios años? Se prueba con Gijón, que tiene 2021-2026, porque Avilés solo tiene un año.
// Uso: node tools/generalizacion.ts      → escribe data/generalizacion.json
//
// Para cada año Y (2022-2026): se ajusta con datos ANTERIORES a Y y se evalúa en Y.
//   uno      ajuste solo con el año Y-1 (como el ajuste de Avilés)
//   hibrido  constituyentes rápidos del año Y-1 + periodo largo (SA, SSA, MM...) de todos los años < Y
//   todos    ajuste con todos los años < Y

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ajustar } from './lib/armonico.ts';
import { crearMotor } from '../src/tide/motor.ts';

const RAIZ = join(import.meta.dirname, '..');
const LARGO = ['SA', 'SSA', 'MM', 'MF', 'MSF', 'MTM', 'MSQM'];
const T: number[] = [], H: number[] = [];
for (const l of readFileSync(join(RAIZ, 'data', 'obs_gijon_10min.csv'), 'utf8').trim().split('\n').slice(1)) {
  const [, s, h] = l.split(',');
  T.push(Number(s) * 1000); H.push(Number(h));
}
const sub = (a: number, b: number) => {
  const t: number[] = [], h: number[] = [];
  T.forEach((x, i) => { if (x >= a && x < b) { t.push(x); h.push(H[i]); } });
  return { T: t, H: h };
};
const rms = (v: number[]) => Math.sqrt(v.reduce((s, x) => s + x * x, 0) / v.length);
const ano = (y: number) => Date.UTC(y, 0, 1);

const filas: Record<string, Record<string, number>> = {};
for (let Y = 2022; Y <= 2026; Y++) {
  const prueba = sub(ano(Y), Y === 2026 ? Infinity : ano(Y + 1));
  const uno = sub(ano(Y - 1), ano(Y));
  const todos = sub(ano(2021), ano(Y));

  const aUno = ajustar(uno.T, uno.H);
  const aTodos = ajustar(todos.T, todos.H);
  const largos = aTodos.constituyentes.filter((c) => LARGO.includes(c.name));
  const mL = crearMotor({ z0: 0, constituyentes: largos });
  const aH = ajustar(uno.T, uno.H.map((h, i) => h - mL.altura(uno.T[i])), { excluir: LARGO });

  const motores = {
    uno: crearMotor({ z0: aUno.z0, constituyentes: aUno.constituyentes }),
    hibrido: crearMotor({ z0: aH.z0, constituyentes: [...aH.constituyentes, ...largos] }),
    todos: crearMotor({ z0: aTodos.z0, constituyentes: aTodos.constituyentes }),
  };
  filas[Y] = {};
  for (const [n, m] of Object.entries(motores)) {
    const r = prueba.T.map((t, i) => prueba.H[i] - m.altura(t));
    const media = r.reduce((s, x) => s + x, 0) / r.length;
    filas[Y][n] = +(100 * rms(r)).toFixed(2);
    filas[Y][`${n}_sinSesgo`] = +(100 * rms(r.map((x) => x - media))).toFixed(2);
  }
  console.log(Y, JSON.stringify(filas[Y]));
}
const medias = Object.fromEntries(['uno', 'hibrido', 'todos', 'uno_sinSesgo', 'hibrido_sinSesgo', 'todos_sinSesgo'].map((k) => [k, +(Object.values(filas).reduce((s, f) => s + f[k], 0) / Object.keys(filas).length).toFixed(2)]));
console.log('media', JSON.stringify(medias));
writeFileSync(join(RAIZ, 'data', 'generalizacion.json'), JSON.stringify({ metodo: 'Ver cabecera de tools/generalizacion.ts. RMS en cm del residuo en el año siguiente; *_sinSesgo descuenta la media del residuo de ese año (nivel medio anual, no predecible).', anos: filas, medias }, null, 1));
