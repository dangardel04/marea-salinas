// Escaleras y rampas que bajan del paseo a la arena (src/scene/bahia-accesos.json, de
// tools/accesos-playa.py): identificadas en el LiDAR 2024 y en la ortofoto PNOA, y medidas en el
// LiDAR: dónde está cada tramo a lo largo del muro, hacia qué lado baja, su largo, su ancho, cuánto
// sale del muro y la altura del paseo y de la arena. Los peldaños (contrahuella ~17 cm), el pretil y
// la barandilla son el dibujo, DECORATIVOS.
//
// Cada pieza va de `a` a `b` a lo largo del borde del paseo (con la dirección hacia el mar en cada
// extremo) y ocupa de t0 a t1 hacia el mar (t negativo: metida en el paseo).

import * as THREE from 'three';
import datos from '../bahia-accesos.json';
import { piezas, type Huecos } from './paseo';

interface Pieza {
  clase: 'escalera' | 'rampa' | 'rellano';
  a: [number, number, number]; b: [number, number, number];
  na: [number, number]; nb: [number, number];
  t0: number; t1: number; s: [number, number];
}
export interface Acceso {
  id: string; tipo: 'escalera' | 'rampa'; nombre: string | null;
  centro: [number, number]; paseo: number; arena: number; doble: boolean; piezas: Pieza[];
}
export const accesos = datos.accesos as unknown as Acceso[];

const CONTRAHUELLA = 0.17;   // m, la habitual (DECORATIVO: el LiDAR no distingue peldaños)
const BARANDA = 0.95;        // m sobre la huella
/** Borde interior de la albardilla, en t: ahí empieza el suelo del paseo. Donde hay un acceso se
 *  quita el muro y su albardilla, y el hueco se cierra con piedra (DECORATIVO: el LiDAR no ve el
 *  interior del muro) en vez de dejar ver el terreno por detrás. */
const T_PASEO = -0.6;

/** Pieza que va delante del muro (t0 > 0): como el muro es recto (paseo.ts), la escalera o la rampa se
 *  apoya en él (empieza en t = 0) y no hace falta cortar el muro ni cerrar un hueco por detrás. */
const adosada = (p: Pieza) => p.clase !== 'rellano' && p.t0 > 0;
/** Dónde empieza la pieza hacia tierra (t): el rellano, llano y a la altura del paseo, llega hasta
 *  el suelo del paseo. */
// (el rellano entra 15 cm bajo el suelo del paseo para que no quede raya entre los dos)
const inicio = (p: Pieza) => (p.clase === 'rellano' ? Math.min(p.t0, T_PASEO - 0.15) : adosada(p) ? 0 : p.t0);

/** Huecos en el muro y en la barandilla del paseo: donde un acceso está metido en el muro y en
 *  la entrada desde el paseo (los rellanos). */
export function huecosAccesos(): Huecos {
  const muro: [number, number][] = [], baranda: [number, number][] = [];
  for (const a of accesos) for (const p of a.piezas) {
    // Todo acceso recorta el muro (también los de delante del muro: el talud del muro cruzaba los
    // peldaños bajos y los enterraba) y la barandilla del paseo, que sustituye la suya. Solo las
    // escaleras apoyadas en un muro recto lo dejan entero.
    if (!adosada(p)) muro.push([p.s[0] - 0.3, p.s[1] + 0.3]);
    // la barandilla del paseo sigue sobre las escaleras apoyadas en el muro (protege el hueco); se
    // quita en la entrada (el rellano) y donde la escalera está metida en el muro (lleva la suya)
    if (p.clase === 'rellano' || !adosada(p)) baranda.push([p.s[0] - 0.3, p.s[1] + 0.3]);
  }
  return { muro, baranda };
}

export function crearAccesos(comunes: Record<string, THREE.IUniform>) {
  const { quad, barra, poste, malla } = piezas();
  for (const acc of accesos) {
    const base = acc.arena - 1.2;   // las piezas se hunden en la arena
    for (const p of acc.piezas) {
      // punto a lo largo (u de 0 en a a 1 en b) y hacia el mar (t), a la altura y
      const en = (u: number, t: number, y: number) => {
        const nx = p.na[0] * (1 - u) + p.nb[0] * u, nz = p.na[1] * (1 - u) + p.nb[1] * u, l = Math.hypot(nx, nz) || 1;
        return [p.a[0] + (p.b[0] - p.a[0]) * u + (nx / l) * t, y, p.a[2] + (p.b[2] - p.a[2]) * u + (nz / l) * t];
      };
      const largo = Math.hypot(p.b[0] - p.a[0], p.b[2] - p.a[2]);
      // el rellano llega tan lejos hacia el mar como su escalera (si no, quedaba un escalón hueco)
      const t1 = p.clase === 'rellano' ? Math.max(p.t1, ...acc.piezas.map((q) => q.t1)) : p.t1;
      // El rellano es llano y a la altura del paseo: se prolonga hasta el suelo del paseo.
      const t0 = inicio(p);
      if (p.clase === 'rellano') {
        const y = p.a[1] + 0.01;   // 1 cm bajo el suelo del paseo (~2 cm sobre la cota medida): lo tapa donde se solapan
        quad(en(0, t0, y), en(0, t1, y), en(1, t1, y), en(1, t0, y), [en(0, t0, y)[0], en(0, t0, y)[2]], [en(0, t1, y)[0], en(0, t1, y)[2]], [en(1, t1, y)[0], en(1, t1, y)[2]], [en(1, t0, y)[0], en(1, t0, y)[2]], 2);
        // frente y costados de piedra, hasta la arena
        quad(en(0, t1, base), en(1, t1, base), en(1, t1, y), en(0, t1, y), [0, 0], [largo, 0], [largo, y - base], [0, y - base], 0);
        quad(en(0, t0, base), en(0, t1, base), en(0, t1, y), en(0, t0, y), [0, 0], [t1 - t0, 0], [t1 - t0, y - base], [0, y - base], 0);
        quad(en(1, t1, base), en(1, t0, base), en(1, t0, y), en(1, t1, y), [0, 0], [t1 - t0, 0], [t1 - t0, y - base], [0, y - base], 0);
        // barandilla en el frente
        const n = Math.max(1, Math.round(largo / 1.6));
        for (let i = 0; i <= n; i++) poste(en(i / n, t1 - 0.06, y), 1.0);
        barra(en(0, t1 - 0.06, y + BARANDA), en(1, t1 - 0.06, y + BARANDA), 0.07, 0.07);
        barra(en(0, t1 - 0.06, y + 0.48), en(1, t1 - 0.06, y + 0.48), 0.04, 0.04);
        continue;
      }
      // Escalera o rampa: de abajo (u = 0) a arriba (u = 1), sea cual sea el orden de a y b.
      const bajoEnA = p.a[1] <= p.b[1];
      const uAB = (u: number) => (bajoEnA ? u : 1 - u);
      const yBajo = Math.min(p.a[1], p.b[1]), yAlto = Math.max(p.a[1], p.b[1]);
      const en2 = (u: number, t: number, y: number) => en(uAB(u), t, y);
      const des = yAlto - yBajo;
      const yPaseo = yAlto + 0.02;   // el suelo del paseo va ~2 cm por encima de la cota medida
      // Metida en el muro: jamba del corte en el extremo de abajo (donde acaba la cara del muro, 0,3 m
      // antes del primer peldaño), de la cara del muro (t = 0) al fondo (t0), de la arena al paseo
      if (t0 < 0) {
        const u = -0.3 / largo;
        quad(en2(u, t0, base), en2(u, 0, base), en2(u, 0, yPaseo), en2(u, t0, yPaseo), [t0, base], [0, base], [0, yPaseo], [t0, yPaseo], 0);
      }
      if (p.clase === 'escalera') {
        const n = Math.max(3, Math.round(des / CONTRAHUELLA)), r = des / n;
        for (let i = 0; i < n; i++) {
          const u0 = i / n, u1 = (i + 1) / n, y = yBajo + (i + 1) * r;
          const ui = [0, i + 0.0], uf = [0, i + 0.999];
          // huella (v: número de peldaño + fracción desde la arista) y contrahuella
          quad(en2(u0, t0, y), en2(u0, t1, y), en2(u1, t1, y), en2(u1, t0, y), [t0, ui[1]], [t1, ui[1]], [t1, uf[1]], [t0, uf[1]], 4);
          quad(en2(u0, t0, y - r), en2(u0, t1, y - r), en2(u0, t1, y), en2(u0, t0, y), [t0, i + 0.5], [t1, i + 0.5], [t1, i + 0.5], [t0, i + 0.5], 4);
          // costado exterior de piedra (a la medida de cada peldaño) y, si está metida en el paseo,
          // el corte del paseo por dentro
          quad(en2(u0, t1, base), en2(u1, t1, base), en2(u1, t1, y), en2(u0, t1, y), [u0 * largo, 0], [u1 * largo, 0], [u1 * largo, y - base], [u0 * largo, y - base], 0);
          // corte del paseo por dentro: muro de piedra detrás de los peldaños, hasta el suelo del paseo
          if (t0 < 0) quad(en2(u1, t0, y), en2(u0, t0, y), en2(u0, t0, yPaseo), en2(u1, t0, yPaseo), [u1 * largo, y - base], [u0 * largo, y - base], [u0 * largo, yPaseo - base], [u1 * largo, yPaseo - base], 0);
        }
      } else {
        // rampa: losa inclinada en 8 trozos, costado de piedra
        const n = 8;
        for (let i = 0; i < n; i++) {
          const u0 = i / n, u1 = (i + 1) / n, y0 = yBajo + des * u0, y1 = yBajo + des * u1;
          const A = en2(u0, t0, y0), B = en2(u0, t1, y0), C = en2(u1, t1, y1), D = en2(u1, t0, y1);
          quad(A, B, C, D, [A[0], A[2]], [B[0], B[2]], [C[0], C[2]], [D[0], D[2]], 2);
          quad(en2(u0, t1, base), en2(u1, t1, base), C, B, [u0 * largo, 0], [u1 * largo, 0], [u1 * largo, y1 - base], [u0 * largo, y0 - base], 0);
          if (t0 < 0) quad(D, A, en2(u0, t0, yPaseo), en2(u1, t0, yPaseo), [u1 * largo, y1 - base], [u0 * largo, y0 - base], [u0 * largo, yPaseo - base], [u1 * largo, yPaseo - base], 0);
        }
      }
      // barandilla por el lado del mar, siguiendo la pendiente; y por el lado del paseo (protege
      // el hueco: sustituye a la barandilla del paseo, que se quita en el acceso)
      for (const tb of t0 < 0 ? [t1 - 0.06, t0 + 0.06] : [t1 - 0.06]) {
        const enPaseo = tb < t1 - 0.1;
        const yb = (u: number) => (enPaseo ? yAlto : yBajo + des * u + (p.clase === 'escalera' ? des / Math.max(3, Math.round(des / CONTRAHUELLA)) : 0));
        const n = Math.max(2, Math.round(largo / 1.6));
        for (let i = 0; i <= n; i++) poste(en2(i / n, tb, yb(i / n)), 1.0);
        barra(en2(0, tb, yb(0) + BARANDA), en2(1, tb, yb(1) + BARANDA), 0.06, 0.06);
        barra(en2(0, tb, yb(0) + 0.48), en2(1, tb, yb(1) + 0.48), 0.04, 0.04);
      }
    }
  }
  const m = malla('accesos', comunes);
  return m;
}

/**
 * Cómo está el pie de un acceso a una hora: con la arena que queda delante del muro ahí (la misma
 * medida que la del panel, «Arena hasta el agua», con su margen típico). Menos de 3 m: el agua (con
 * las olas) llega al pie; menos que el margen: puede llegar; si no, los metros de arena, de 5 en 5
 * (el margen no da para más).
 */
export function estadoPie(metros: number | null, margen: number): { texto: string; estado: 'agua' | 'cerca' | 'seco' } | null {
  if (metros == null) return null;
  if (metros < 3) return { texto: 'agua al pie', estado: 'agua' };
  if (metros < margen) return { texto: 'agua cerca', estado: 'cerca' };
  return { texto: `${Math.round(metros / 5) * 5} m de arena`, estado: 'seco' };
}

/** Texto del rótulo de cada acceso. */
export const rotuloAcceso = (a: Acceso) => a.nombre ?? (a.tipo === 'rampa' ? 'Rampa' : 'Escalera');

/** Huella de cada acceso: el terreno (que en el LiDAR tiene estas escaleras como bultos lisos)
 *  se rebaja ahí a la altura de la arena, para que se vean las piezas dibujadas. Devuelve la
 *  altura máxima del terreno en (x, z), o null si no cae en ningún acceso. */
const huellas = accesos.flatMap((acc) => acc.piezas.map((p) => {
  const dx = p.b[0] - p.a[0], dz = p.b[2] - p.a[2], L = Math.hypot(dx, dz) || 1;
  const xs = [p.a[0], p.b[0]], zs = [p.a[2], p.b[2]];
  const r = Math.max(Math.abs(p.t0), ...acc.piezas.map((q) => Math.abs(q.t1))) + 2;
  return { p, t0: inicio(p), t1: p.clase === 'rellano' ? Math.max(p.t1, ...acc.piezas.map((q) => q.t1)) : p.t1, dx: dx / L, dz: dz / L, L, arena: acc.arena, caja: [Math.min(...xs) - r, Math.min(...zs) - r, Math.max(...xs) + r, Math.max(...zs) + r] };
}));
export function rebajeAccesos(x: number, z: number): number | null {
  for (const h of huellas) {
    if (x < h.caja[0] || x > h.caja[2] || z < h.caja[1] || z > h.caja[3]) continue;
    const s = (x - h.p.a[0]) * h.dx + (z - h.p.a[2]) * h.dz;
    if (s < -0.4 || s > h.L + 0.4) continue;
    const u = Math.min(1, Math.max(0, s / h.L));
    const nx = h.p.na[0] * (1 - u) + h.p.nb[0] * u, nz = h.p.na[1] * (1 - u) + h.p.nb[1] * u, l = Math.hypot(nx, nz) || 1;
    const t = (x - h.p.a[0] - h.dx * s) * (nx / l) + (z - h.p.a[2] - h.dz * s) * (nz / l);
    // por dentro llega 0,3 m más allá del muro de piedra de detrás de los peldaños: el corte del terreno queda tapado
    if (t >= h.t0 - 0.3 && t <= h.t1 + 0.8) return h.arena;
  }
  return null;
}
