// Zona de prueba: el Club Náutico y el paseo que tiene delante. Las mejoras de modelado y de calidad
// gráfica (muro recto, escalera apoyada en él, terreno de delante a la altura de la playa) se
// aplican solo aquí; el resto del paseo queda como estaba hasta que se dé el visto bueno.
//
// MEDIDO: la posición del Club Náutico (OpenStreetMap, src/scene/bahia-paseo.json), la línea y la
// altura del muro y su pie (LiDAR 2024). ELEGIDO: el radio de la zona y el ancho de la transición.
// DECORATIVO: que el muro sea vertical (el LiDAR da un talud de ~42° en el muro).

import paseo from '../bahia-paseo.json';

interface Punto { arriba: number[]; pie: number[]; eje: number[] }
const club = paseo.lugares.find((l) => l.nombre === 'Club Náutico')!;

/** Centro y radio de la zona (m), y ancho de la franja de transición hacia fuera (m). */
export const ZONA = { x: club.x, z: club.z, radio: 140, suave: 40 };

const suave = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** 1 dentro de la zona, 0 fuera, con transición suave en la franja de fuera. */
export function pesoZona(x: number, z: number): number {
  return 1 - suave(ZONA.radio - ZONA.suave, ZONA.radio, Math.hypot(x - ZONA.x, z - ZONA.z));
}
export const enZona = (x: number, z: number) => pesoZona(x, z) > 0.999;

// Puntos del muro que caen en la zona, con la dirección hacia tierra y el ancho del talud.
const muro = (paseo.tramos as Punto[][]).flat()
  .filter((p) => Math.hypot(p.arriba[0] - ZONA.x, p.arriba[2] - ZONA.z) < ZONA.radio + 20)
  .map((p) => {
    const x = p.arriba[0] - p.pie[0], z = p.arriba[2] - p.pie[2], l = Math.hypot(x, z) || 1;
    return { x: p.arriba[0], z: p.arriba[2], tx: x / l, tz: z / l, ancho: l, piey: p.pie[1] };
  });

/**
 * Altura del terreno dibujado en (x, z) con el muro recto: el talud de LiDAR que quedaba delante
 * del muro (entre su borde y su pie) se baja a la altura de la playa en el pie, para que el muro
 * vertical llegue hasta la arena sin que asome el terreno por delante. Empieza 3,2 m metida en el
 * paseo (la cubre el suelo del paseo, que llega a ~3,6 m) para que el corte del terreno, que las
 * mallas de menos detalle estiran en una rampa de una celda, quede por detrás del muro.
 */
export function terrenoConMuroRecto(x: number, z: number, h: number): number {
  const w = pesoZona(x, z);
  if (w <= 0) return h;
  let mejor = -1, dm = Infinity;
  for (let i = 0; i < muro.length; i++) {
    const d = Math.hypot(muro[i].x - x, muro[i].z - z);
    if (d < dm) { dm = d; mejor = i; }
  }
  if (mejor < 0 || dm > 4) return h;
  const m = muro[mejor];
  const mar = -((x - m.x) * m.tx + (z - m.z) * m.tz);   // m hacia el mar desde el borde del paseo
  // más allá del pie la playa baja sola: el ajuste se desvanece en 4 m para no dejar un escalón
  if (mar < -3.2 || mar > m.ancho + 6) return h;
  const f = w * (1 - suave(m.ancho + 2, m.ancho + 6, mar));
  return h + (Math.min(h, m.piey) - h) * f;
}
