// Relieve de la bahía cargado en memoria (ver tools/bahia-relieve.ts para el formato) y, encima,
// el relieve fino de 1 m de la playa (LiDAR PNOA 2024, ver tools/lidar-fino.py) cuando llega.

import * as THREE from 'three';
import { LADO, N_RELIEVE, PASO_RELIEVE } from '../../bahia';

export interface MetaFino { bloque: number; paso: number; sinDato: number; bloques: number[][] }

export interface Relieve {
  n: number;
  /** Alturas en m sobre el CH, filas de norte a sur. */
  alto: Float32Array;
  /** 1 si la altura la midió el LiDAR; 0 si es estimada (franja intermareal o fondo). */
  medido: Uint8Array;
  altura(x: number, z: number): number;
  medidoEn(x: number, z: number): number;
  /** Separación de la rejilla que manda en (x, z): 1 m donde hay relieve fino, 5 m fuera. */
  pasoEn(x: number, z: number): number;
  /** ¿Hay relieve fino en algún punto del recuadro? */
  hayFino(x0: number, z0: number, x1: number, z1: number): boolean;
  /** Añade el relieve fino (bloques de tools/lidar-fino.py). */
  ponerFino(meta: MetaFino, datos: Int16Array): void;
  /** Textura (float, un canal) submuestreada cada `paso` nodos, para el agua. */
  textura(paso: number): THREE.DataTexture;
}

export function crearRelieve(cm: Int16Array): Relieve {
  const n = N_RELIEVE;
  const alto = new Float32Array(n * n);
  const medido = new Uint8Array(n * n);
  for (let k = 0; k < n * n; k++) {
    alto[k] = cm[k] / 100;
    medido[k] = Math.abs(cm[k]) % 2;
  }
  function muestra(arr: ArrayLike<number>, x: number, z: number): number {
    const c = Math.min(n - 1.001, Math.max(0, (x + LADO / 2) / PASO_RELIEVE));
    const f = Math.min(n - 1.001, Math.max(0, (z + LADO / 2) / PASO_RELIEVE));
    const c0 = Math.floor(c), f0 = Math.floor(f), fx = c - c0, fy = f - f0;
    const k = f0 * n + c0;
    return (arr[k] * (1 - fx) + arr[k + 1] * fx) * (1 - fy) + (arr[k + n] * (1 - fx) + arr[k + n + 1] * fx) * fy;
  }

  // ---------- Relieve fino: bloques de (L+1)×(L+1) nodos cada L metros ----------
  let L = 100, sinDato = -32768;
  /** Fusión con el relieve de 5 m: en los últimos FUSION metros antes de un hueco del LiDAR, el
   *  fino pasa gradualmente al grueso (su borde es irregular y no casa al centímetro). */
  const FUSION = 8;
  const bloques = new Map<string, { h: Int16Array; peso: Uint8Array }>();
  let pesoFino = 0;
  /** Altura fina en (x, z), o NaN si no hay bloque o falta alguno de los 4 nodos. Deja en
   *  `pesoFino` cuánto manda (0–1). */
  function fina(x: number, z: number): number {
    if (!bloques.size) return NaN;
    const bi = Math.floor(x / L), bj = Math.floor(z / L);
    const b = bloques.get(`${bi},${bj}`);
    if (!b) return NaN;
    const V = L + 1;
    const u = Math.min(L - 1e-6, x - bi * L), v = Math.min(L - 1e-6, z - bj * L);
    const c0 = Math.floor(u), f0 = Math.floor(v), fx = u - c0, fy = v - f0;
    const k = f0 * V + c0;
    const h = b.h, a = h[k], bb = h[k + 1], c = h[k + V], d = h[k + V + 1];
    if (a === sinDato || bb === sinDato || c === sinDato || d === sinDato) return NaN;
    const p = b.peso;
    pesoFino = ((p[k] * (1 - fx) + p[k + 1] * fx) * (1 - fy) + (p[k + V] * (1 - fx) + p[k + V + 1] * fx) * fy) / 255;
    return ((a * (1 - fx) + bb * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy) / 100;
  }

  return {
    n, alto, medido,
    altura(x, z) {
      const h = fina(x, z);
      if (Number.isNaN(h)) return muestra(alto, x, z);
      return pesoFino >= 1 ? h : muestra(alto, x, z) + (h - muestra(alto, x, z)) * pesoFino;
    },
    medidoEn(x, z) {
      return Number.isNaN(fina(x, z)) ? muestra(medido, x, z) : 1;
    },
    pasoEn(x, z) {
      return Number.isNaN(fina(x, z)) ? PASO_RELIEVE : 1;
    },
    hayFino(x0, z0, x1, z1) {
      if (!bloques.size) return false;
      for (let bj = Math.floor(z0 / L); bj * L < z1; bj++) for (let bi = Math.floor(x0 / L); bi * L < x1; bi++) {
        if (bloques.has(`${bi},${bj}`)) return true;
      }
      return false;
    },
    ponerFino(meta, datos) {
      L = meta.bloque; sinDato = meta.sinDato;
      const V = L + 1;
      const presentes = new Set(meta.bloques.map(([bi, bj]) => `${bi},${bj}`));
      meta.bloques.forEach(([bi, bj], q) => {
        const h = datos.subarray(q * V * V, (q + 1) * V * V);
        // Distancia (chaflán 3‑4, en tercios de metro) al hueco más cercano. Un borde de bloque
        // sin bloque vecino cuenta como hueco.
        const INF = 1e6, dist = new Float32Array(V * V);
        for (let f = 0; f < V; f++) for (let c = 0; c < V; c++) {
          const k = f * V + c;
          const sinVecino = (c === 0 && !presentes.has(`${bi - 1},${bj}`)) || (c === L && !presentes.has(`${bi + 1},${bj}`))
            || (f === 0 && !presentes.has(`${bi},${bj - 1}`)) || (f === L && !presentes.has(`${bi},${bj + 1}`));
          dist[k] = h[k] === sinDato || sinVecino ? 0 : INF;
        }
        for (const [paso, ini] of [[1, 0], [-1, V - 1]] as const) {
          for (let f = ini; f >= 0 && f < V; f += paso) for (let c = ini; c >= 0 && c < V; c += paso) {
            const k = f * V + c;
            for (const [df, dc, w] of [[-paso, 0, 3], [0, -paso, 3], [-paso, -paso, 4], [-paso, paso, 4]]) {
              const ff = f + df, cc = c + dc;
              if (ff < 0 || ff >= V || cc < 0 || cc >= V) continue;
              if (dist[ff * V + cc] + w < dist[k]) dist[k] = dist[ff * V + cc] + w;
            }
          }
        }
        const peso = new Uint8Array(V * V);
        for (let k = 0; k < V * V; k++) {
          const t = Math.min(1, dist[k] / 3 / FUSION);
          peso[k] = Math.round(255 * t * t * (3 - 2 * t));
        }
        bloques.set(`${bi},${bj}`, { h, peso });
      });
    },
    textura(paso) {
      const m = Math.floor((n - 1) / paso) + 1;
      const datos = new Float32Array(m * m);
      for (let f = 0; f < m; f++) for (let c = 0; c < m; c++) datos[f * m + c] = alto[f * paso * n + c * paso];
      const t = new THREE.DataTexture(datos, m, m, THREE.RedFormat, THREE.FloatType);
      t.magFilter = t.minFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      return t;
    },
  };
}

export async function cargarRelieve(url: string): Promise<Relieve> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudo cargar el relieve (${r.status})`);
  return crearRelieve(new Int16Array(await r.arrayBuffer()));
}

/** Descarga el relieve fino; si falla, la escena sigue con el de 5 m. */
export async function cargarFino(url: string): Promise<Int16Array | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return new Int16Array(await r.arrayBuffer());
  } catch {
    return null;
  }
}
