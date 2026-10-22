// Zona mejorada: todo el muro del paseo y la franja de playa y paseo que tiene alrededor. Aquí se
// aplican las mejoras de modelado y de calidad gráfica: muro recto, escaleras apoyadas en él,
// terreno de delante a la altura de la playa, más detalle de la piedra y filtrado de texturas.
// (El Club Náutico es el primer sitio con edificios mejorados: ver EDIFICIOS_MEJORADOS.)
//
// MEDIDO: la línea y la altura del muro y de su pie (LiDAR 2024, tools/paseo-muro.py); donde esa
// línea se aparta del muro real (ver corregir), el borde del escalón de altura del propio relieve LiDAR.
// ELEGIDO: el ancho de la franja (120 m) y de su transición (40 m).
// DECORATIVO: que el muro sea vertical (el LiDAR da un talud de ~42° en el muro).

import paseo from '../bahia-paseo.json';
import type { PuntoMuro } from './paseo';

// Edificios mejorados (sombreado.ts, EDIFICIOS_FRAG): los del Club Náutico, para ver qué tal.
// MEDIDO: la posición del Club Náutico (OpenStreetMap, bahia-paseo.json). ELEGIDO: el radio (90 m) y la transición (30 m).
const club = paseo.lugares.find((l) => l.nombre === 'Club Náutico')!;
export const EDIFICIOS_MEJORADOS = { x: club.x, z: club.z, radio: 90, suave: 30 };

/** Hasta dónde llega la zona desde el muro (m) y ancho de la transición hacia fuera (m). */
export const ZONA = { radio: 120, suave: 40 };

const suave = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

type Altura = (x: number, z: number) => number;

/**
 * La línea del muro sale del eje del «Paseo del Cantábrico» de OpenStreetMap, y en unos tramos
 * (ensanches del paseo, rampas, entradas) se aparta del muro real hasta ~10 m hacia tierra: ahí el
 * pie queda detrás del borde y el muro dibujado quedaba lejos del escalón que se ve en el relieve
 * (que se veía como un manchón borroso). En esos tramos se recoloca el borde donde el relieve LiDAR
 * sube de la arena al paseo, buscándolo a lo largo de la perpendicular a la línea general del muro.
 */
function corregir(tr: PuntoMuro[], altura: Altura): PuntoMuro[] {
  const n = tr.length;
  const normal = (i: number) => {
    const a = tr[Math.max(0, i - 6)].arriba, b = tr[Math.min(n - 1, i + 6)].arriba;
    const x = b[0] - a[0], z = b[2] - a[2], l = Math.hypot(x, z) || 1;
    return [-z / l, x / l];   // a la derecha de la marcha de oeste a este: hacia tierra
  };
  const malo = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    const [nx, nz] = normal(i);
    if ((tr[i].arriba[0] - tr[i].pie[0]) * nx + (tr[i].arriba[2] - tr[i].pie[2]) * nz < 0.3) malo[i] = true;
    if (i + 1 < n && Math.hypot(tr[i + 1].arriba[0] - tr[i].arriba[0], tr[i + 1].arriba[2] - tr[i].arriba[2]) > 2.6) { malo[i] = true; malo[i + 1] = true; }
  }
  // un par de puntos más a cada lado de lo malo (las esquinas)
  const ext = malo.map((m, i) => m || malo[i - 1] || malo[i - 2] || malo[i + 1] || malo[i + 2]);
  // desplazamiento hacia tierra (m) de cada punto, buscado en el relieve
  const t = new Array<number | null>(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (!ext[i]) continue;
    const [nx, nz] = normal(i), a = tr[i].arriba, umbral = tr[i].pie[1] + 2.2;
    let prev = altura(a[0] - nx * 14, a[2] - nz * 14);
    for (let s = -13.75; s <= 6; s += 0.25) {
      const h = altura(a[0] + nx * s, a[2] + nz * s);
      if (h > umbral && prev <= umbral) { t[i] = s - 0.25 + ((umbral - prev) / (h - prev)) * 0.25 - 0.15; break; }
      prev = h;
    }
  }
  // mediana de 5 para no seguir las muescas del relieve
  const fino = t.map((v, i) => {
    if (v == null) return null;
    const w = [-2, -1, 0, 1, 2].map((d) => t[i + d]).filter((x): x is number => x != null).sort((p, q) => p - q);
    return w[Math.floor(w.length / 2)];
  });
  // distancia a lo largo de la línea original, para los accesos
  const sOrig: number[] = [0];
  for (let i = 1; i < n; i++) sOrig.push(sOrig[i - 1] + Math.hypot(tr[i].arriba[0] - tr[i - 1].arriba[0], tr[i].arriba[2] - tr[i - 1].arriba[2]));
  return tr.map((p, i) => {
    const [nx, nz] = normal(i);
    if (!ext[i]) return { ...p, s: sOrig[i] };
    const d = fino[i] ?? 0;
    const ax = p.arriba[0] + nx * d, az = p.arriba[2] + nz * d;
    return {
      arriba: [ax, p.arriba[1], az] as [number, number, number],
      // el pie, 3 m hacia el mar: con el muro vertical solo importa su altura y de qué lado cae el mar
      pie: [ax - nx * 3, p.pie[1], az - nz * 3] as [number, number, number],
      eje: p.eje,
      s: sOrig[i],
    };
  });
}

// Puntos del muro, con la dirección hacia tierra y el ancho del talud, en una rejilla de 80 m para
// buscar el más cercano sin recorrerlos todos (se pregunta por cada vértice del terreno).
type PuntoZona = { x: number; z: number; tx: number; tz: number; ancho: number; piey: number };
let tramos = paseo.tramos as unknown as PuntoMuro[][];
let muro: PuntoZona[] = [];
const CELDA = 80;
let rejilla = new Map<string, number[]>();
const clave = (i: number, j: number) => `${i},${j}`;
const ALCANCE = Math.ceil((ZONA.radio + 4) / CELDA);

function indexar() {
  muro = tramos.flat().map((p) => {
    const x = p.arriba[0] - p.pie[0], z = p.arriba[2] - p.pie[2], l = Math.hypot(x, z) || 1;
    return { x: p.arriba[0], z: p.arriba[2], tx: x / l, tz: z / l, ancho: l, piey: p.pie[1] };
  });
  rejilla = new Map();
  muro.forEach((m, k) => {
    const c = clave(Math.floor(m.x / CELDA), Math.floor(m.z / CELDA));
    (rejilla.get(c) ?? rejilla.set(c, []).get(c)!).push(k);
  });
}
indexar();

/** Recoloca el muro con el relieve (ver corregir). Hay que llamarla otra vez cuando llega el relieve fino. */
export function prepararMuro(altura: Altura) {
  tramos = (paseo.tramos as unknown as PuntoMuro[][]).map((tr) => corregir(tr, altura));
  indexar();
}
/** El muro, con la línea corregida. */
export const tramosMuro = () => tramos;

/** Punto del muro más cercano a (x, z) y su distancia (m), o null si está fuera de la zona. */
function cercano(x: number, z: number): { m: PuntoZona; d: number } | null {
  const ci = Math.floor(x / CELDA), cj = Math.floor(z / CELDA);
  let mejor = -1, dm = Infinity;
  for (let i = ci - ALCANCE; i <= ci + ALCANCE; i++) for (let j = cj - ALCANCE; j <= cj + ALCANCE; j++) {
    const l = rejilla.get(clave(i, j));
    if (!l) continue;
    for (const k of l) {
      const d = Math.hypot(muro[k].x - x, muro[k].z - z);
      if (d < dm) { dm = d; mejor = k; }
    }
  }
  return mejor < 0 ? null : { m: muro[mejor], d: dm };
}

/** Distancia (m) al punto del muro más cercano (∞ si está a más de ~120 m). */
export function distanciaMuro(x: number, z: number): number {
  return cercano(x, z)?.d ?? Infinity;
}

/** 1 dentro de la zona, 0 fuera, con transición suave en la franja de fuera. */
export function pesoZona(x: number, z: number): number {
  const c = cercano(x, z);
  return c ? 1 - suave(ZONA.radio - ZONA.suave, ZONA.radio, c.d) : 0;
}
export const enZona = (x: number, z: number) => pesoZona(x, z) > 0.999;

/** ¿Toca la zona el rectángulo (x0, z0)–(x1, z1)? Para las texturas de las teselas. */
export function tocaZona(x0: number, z0: number, x1: number, z1: number): boolean {
  return muro.some((m) => m.x > x0 - ZONA.radio && m.x < x1 + ZONA.radio && m.z > z0 - ZONA.radio && m.z < z1 + ZONA.radio);
}

/**
 * Altura del terreno dibujado en (x, z) con el muro recto: el talud de LiDAR que quedaba delante
 * del muro (entre su borde y su pie) se baja a la altura de la playa en el pie, para que el muro
 * vertical llegue hasta la arena sin que asome el terreno por delante. Empieza 3,2 m metida en el
 * paseo (la cubre el suelo del paseo, que llega a ~3,6 m) para que el corte del terreno, que las
 * mallas de menos detalle estiran en una rampa de una celda, quede por detrás del muro.
 */
export function terrenoConMuroRecto(x: number, z: number, h: number): number {
  const c = cercano(x, z);
  if (!c || c.d > 4) return h;
  const m = c.m;
  const mar = -((x - m.x) * m.tx + (z - m.z) * m.tz);   // m hacia el mar desde el borde del paseo
  // más allá del pie la playa baja sola: el ajuste se desvanece en 4 m para no dejar un escalón
  if (mar < -3.2 || mar > m.ancho + 6) return h;
  const f = 1 - suave(m.ancho + 2, m.ancho + 6, mar);
  return h + (Math.min(h, m.piey) - h) * f;
}
