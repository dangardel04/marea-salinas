// Zona de la escena: la playa de Salinas y lo cercano al paseo.
//
// Solo se dibuja con detalle lo que está a menos de `detalle` m del muro o del arranque de los
// perfiles de la playa que quedan delante del paseo (src/scene/bahia-zona.json; El Espartal, no). Hasta `fin`, la tierra se funde en bruma; más
// allá el relieve se aplana (sin montes ni casas de campo en el horizonte), no se piden ortofotos
// ni se subdivide el terreno, y los edificios ya vienen recortados (tools/recortar-zona.py).
// El mar no se toca: sigue hasta el horizonte.

import * as THREE from 'three';
import metaZona from '../bahia-zona.json';
import metaPaseo from '../bahia-paseo.json';
import { perfiles } from './arena';

const PASO = 10;   // m, rejilla de distancias

/** GLSL: brumaZona(xz) → 0 dentro de la zona, 1 fuera (tierra fundida en la bruma). */
export const ZONA_GLSL = /* glsl */ `
uniform sampler2D uZona;
uniform vec4 uZonaCaja;     // x0, z0 (centro del primer nodo), nodos en x, nodos en z
uniform vec2 uZonaRadios;   // detalle, fin (m)
uniform vec3 uZonaCosta;     // recta de la playa: normal hacia tierra (x, z) y distancia
float brumaZona(vec2 xz) {
  vec2 uv = clamp(((xz - uZonaCaja.xy) / ${PASO.toFixed(1)} + 0.5) / uZonaCaja.zw, 0.0, 1.0);
  return smoothstep(uZonaRadios.x, uZonaRadios.y, texture2D(uZona, uv).r);
}
/** Para el agua: solo la que queda tierra adentro de la playa (la ría, el puerto); el mar abierto
 *  sigue hasta el horizonte. */
float brumaZonaAgua(vec2 xz) {
  return brumaZona(xz) * smoothstep(0.0, 300.0, dot(xz, uZonaCosta.xy) - uZonaCosta.z);
}
`;

/** Puntos desde los que se mide la zona (los mismos que usa tools/recortar-zona.py). */
export function semillasZona(): [number, number][] {
  const pies = (metaPaseo.tramos as { pie: number[] }[][]).flat();
  const s: [number, number][] = pies.filter((_, i) => i % metaZona.cadaPie === 0).map((p) => [p.pie[0], p.pie[2]]);
  for (const p of perfiles) {
    const cerca = pies.some((q) => Math.hypot(q.pie[0] - p[0], q.pie[2] - p[1]) < metaZona.perfilesHasta);
    if (cerca) s.push([p[0], p[1]]);
  }
  return s;
}

export function crearZona() {
  const { detalle, fin } = metaZona;
  const semillas = semillasZona();
  let sx0 = Infinity, sz0 = Infinity, sx1 = -Infinity, sz1 = -Infinity;
  for (const [x, z] of semillas) { sx0 = Math.min(sx0, x); sx1 = Math.max(sx1, x); sz0 = Math.min(sz0, z); sz1 = Math.max(sz1, z); }
  const margen = fin + 3 * PASO;
  const x0 = Math.floor((sx0 - margen) / PASO) * PASO, z0 = Math.floor((sz0 - margen) / PASO) * PASO;
  const nx = Math.ceil((sx1 + margen - x0) / PASO) + 1, nz = Math.ceil((sz1 + margen - z0) / PASO) + 1;
  const dist = new Float32Array(nx * nz);
  for (let f = 0; f < nz; f++) for (let c = 0; c < nx; c++) {
    const x = x0 + c * PASO, z = z0 + f * PASO;
    let m = Infinity;
    for (const [px, pz] of semillas) {
      const dx = px - x, dz = pz - z, d2 = dx * dx + dz * dz;
      if (d2 < m) m = d2;
    }
    dist[f * nx + c] = Math.sqrt(m);
  }
  // Recta de la playa, del primer al último perfil (de Salinas a la ría), con su normal hacia tierra.
  const [ax, az] = perfiles[0], [bx, bz] = perfiles[perfiles.length - 1];
  const largo = Math.hypot(bx - ax, bz - az);
  let cx = -(bz - az) / largo, cz = (bx - ax) / largo;
  if (cx * perfiles[0][2] + cz * perfiles[0][3] > 0) { cx = -cx; cz = -cz; }   // contraria al mar
  const costa = new THREE.Vector3(cx, cz, cx * ax + cz * az);
  const textura = new THREE.DataTexture(dist, nx, nz, THREE.RedFormat, THREE.FloatType);
  textura.magFilter = textura.minFilter = THREE.LinearFilter;
  textura.wrapS = textura.wrapT = THREE.ClampToEdgeWrapping;
  textura.needsUpdate = true;

  /** Distancia (m) a la playa o al paseo; fuera de la rejilla, como su borde (más que `fin`). */
  function distancia(x: number, z: number): number {
    const c = THREE.MathUtils.clamp((x - x0) / PASO, 0, nx - 1.001), f = THREE.MathUtils.clamp((z - z0) / PASO, 0, nz - 1.001);
    const c0 = Math.floor(c), f0 = Math.floor(f), fx = c - c0, fy = f - f0, k = f0 * nx + c0;
    return (dist[k] * (1 - fx) + dist[k + 1] * fx) * (1 - fy) + (dist[k + nx] * (1 - fx) + dist[k + nx + 1] * fx) * fy;
  }
  const bruma = (x: number, z: number) => THREE.MathUtils.smoothstep(distancia(x, z), detalle, fin);

  return {
    uniformes: {
      uZona: { value: textura as THREE.Texture },
      uZonaCaja: { value: new THREE.Vector4(x0, z0, nx, nz) },
      uZonaRadios: { value: new THREE.Vector2(detalle, fin) },
      uZonaCosta: { value: costa },
    },
    distancia,
    /** 0 dentro, 1 fuera (en bruma). */
    bruma,
    /** Cuánto se aplana el relieve en (x, z): solo donde ya casi todo es bruma. */
    aplanado: (x: number, z: number) => THREE.MathUtils.smoothstep(bruma(x, z), 0.85, 1),
    /** ¿Queda todo el recuadro fuera de la zona (más allá de `fin`)? */
    fuera(xa: number, za: number, xb: number, zb: number): boolean {
      const c0 = Math.max(0, Math.floor((xa - x0) / PASO)), c1 = Math.min(nx - 1, Math.ceil((xb - x0) / PASO));
      const f0 = Math.max(0, Math.floor((za - z0) / PASO)), f1 = Math.min(nz - 1, Math.ceil((zb - z0) / PASO));
      for (let f = f0; f <= f1; f++) for (let c = c0; c <= c1; c++) if (dist[f * nx + c] < fin) return false;
      return true;
    },
    /** Recuadro de lo que se puede mirar (la playa y el paseo, con algo de margen). */
    limites: { x0: sx0 - detalle * 0.5, z0: sz0 - detalle * 0.5, x1: sx1 + detalle * 0.5, z1: sz1 + detalle * 0.5 },
    detalle, fin,
  };
}

export type Zona = ReturnType<typeof crearZona>;
